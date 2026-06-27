import 'dotenv/config'
import express from 'express'
import axios from 'axios'
import rateLimit from 'express-rate-limit'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHmac, createHash } from 'crypto'
import type { TenantRepository } from '../core/ports/TenantRepository.js'
import type { Tenant } from '../core/domain/Tenant.js'
import { buildMessagePayload } from '../adapters/publishers/format.js'
import { sendOfferMessage } from '../adapters/publishers/WhatsAppPublisher.js'
import { appendHistory, loadHistory } from '../adapters/db/HistoryRepository.js'
import { fetchShopeeDeals, generateAffiliateLink, fetchShopeeProductByUrl, CATEGORY_META, CATEGORY_KEYWORDS, type SubIds, type DealCategory } from '../adapters/affiliates/ShopeeAffiliate.js'
import { fetchMLProductInfo, injectMLTag, isMercadoLivreUrl } from '../adapters/affiliates/MLAffiliate.js'
import { quickFetchProduct } from '../adapters/scrapers/ProductScraper.js'
import { createBot, sendProductToChat, sendDealToChat } from '../adapters/publishers/TelegramPublisher.js'

// ── Tenant repository injection ───────────────────────────────────────────────
let _tenantRepo: TenantRepository | null = null
export function setTenantRepo(repo: TenantRepository): void { _tenantRepo = repo }

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
app.set('trust proxy', 1)
const PORT = process.env.PORT || 3000

// ── Image proxy: SSRF allowlist ───────────────────────────────────────────────
const ALLOWED_IMAGE_HOSTS = [
  /\.shopee\.com\.br$/,
  /\.susercontent\.com$/,
  /\.szcdn\.com$/,
  /\.ssl-images-amazon\.com$/,
  /\.media-amazon\.com$/,
  /\.cloudfront\.net$/,
  /\.mlstatic\.com$/,
]

function isImageHostAllowed(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return ALLOWED_IMAGE_HOSTS.some(re => re.test(hostname))
  } catch { return false }
}

// ── Rate limiter for image proxy ──────────────────────────────────────────────
const proxyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
})

// ── Auth helpers ──────────────────────────────────────────────────────────────
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin'

function authToken(): string {
  return createHmac('sha256', DASHBOARD_PASSWORD).update('auth').digest('hex')
}

function parseCookies(header: string = ''): Record<string, string> {
  return Object.fromEntries(
    header.split(';').map(c => { const [k, ...v] = c.trim().split('='); return [k, v.join('=')] })
  )
}

function isAuthenticated(req: express.Request): boolean {
  return parseCookies(req.headers.cookie)['auth'] === authToken()
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json())

// Serve static files but NOT index.html automatically (protected below)
app.use(express.static(join(__dirname, '../../public'), { index: false }))

// Protected: main dashboard
app.get(['/', '/index.html'], (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/login.html')
  res.sendFile(join(__dirname, '../../public/index.html'))
})

// Protect all /api/* except /api/login
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/test-ml') return next()
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Não autorizado' })
  next()
})

// Login
app.post('/api/login', (req, res) => {
  const { password } = req.body as { password?: string }
  if (!password || password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta' })
  }
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `auth=${authToken()}; HttpOnly; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Strict${secure}`)
  res.json({ ok: true })
})

// Logout
app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'auth=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict')
  res.json({ ok: true })
})

export interface UnifiedDeal {
  id: string
  title: string
  price: string
  originalPrice?: string
  discountPercent: number
  commissionRate?: string
  ratingStar?: string
  store: string
  imageUrl: string
  affiliateUrl: string   // ready-to-use affiliate link
  productLink?: string   // canonical Shopee URL — use as originUrl when generating links with subIds
  shopId?: number        // Shopee shop ID for voucher matching
  source: 'shopee' | 'amazon' | 'mercado-livre'
  category: DealCategory
  publishedAt: string
}

let dealsCache: UnifiedDeal[] = []
let sentTodayLog: (UnifiedDeal & { sentAt: string })[] = []


function inferCategory(title: string): DealCategory {
  const lower = title.toLowerCase()
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [DealCategory, string[]][]) {
    if (keywords.some(kw => lower.includes(kw.toLowerCase()))) return cat
  }
  return 'geral'
}

export async function refreshDeals() {
  const now = new Date().toISOString()
  const shopeeResults: UnifiedDeal[] = []

  // Shopee Affiliate API only — Pelando is handled by monitorPelando()
  if (process.env.SHOPEE_APP_ID && process.env.SHOPEE_SECRET) {
    try {
      const shopeeProducts = await fetchShopeeDeals(8)
      for (const p of shopeeProducts) {
        const priceNum = parseFloat(p.price)
        const originalNum = p.priceDiscountRate > 0
          ? priceNum / (1 - p.priceDiscountRate / 100)
          : undefined
        shopeeResults.push({
          id: String(p.itemId),
          title: p.productName.slice(0, 80),
          price: `R$${priceNum.toFixed(2).replace('.', ',')}`,
          originalPrice: originalNum ? `R$${originalNum.toFixed(2).replace('.', ',')}` : undefined,
          discountPercent: p.priceDiscountRate,
          commissionRate: `${(parseFloat(p.commissionRate) * 100).toFixed(0)}%`,
          ratingStar: p.ratingStar,
          store: p.shopName,
          imageUrl: p.imageUrl,
          affiliateUrl: p.offerLink,
          productLink: p.productLink,
          shopId: p.shopId,
          source: 'shopee',
          category: p.category,
          publishedAt: now,
        })
      }
      console.log(`[shopee] ✓ ${shopeeResults.length} produtos encontrados`)
    } catch (err) {
      console.error('[shopee] Erro:', err instanceof Error ? err.message : err)
    }
  }

  dealsCache = [...shopeeResults]
}

export function getCachedDeals() {
  return dealsCache
}

export function getSentToday() {
  return sentTodayLog
}

// POST /api/scrape — returns partial: false only when all key fields are present
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body as { url?: string }
  if (!url) return res.status(400).json({ error: 'URL é obrigatória' })

  // Shopee: API gives price + image + generates affiliate short link
  if (/shopee\.com\.br|s\.shopee\.com\.br|shp\.ee/.test(url)) {
    try {
      const [info, affiliateUrl] = await Promise.all([
        fetchShopeeProductByUrl(url),
        generateAffiliateLink(url),
      ])
      if (info) {
        const priceNum = parseFloat(info.price)
        const price = isNaN(priceNum) ? info.price : `R$${priceNum.toFixed(2).replace('.', ',')}`
        const origNum = info.originalPrice ? parseFloat(info.originalPrice) : NaN
        const originalPrice = !isNaN(origNum) ? `R$${origNum.toFixed(2).replace('.', ',')}` : undefined
        return res.json({ name: info.name, price, originalPrice, imageUrl: info.imageUrl, originalUrl: affiliateUrl, affiliateUrl, partial: false })
      }
    } catch (err) {
      console.warn('[scrape:shopee]', err instanceof Error ? err.message : err)
    }
    return res.json({ partial: true, name: '', price: '', imageUrl: '', originalUrl: url })
  }

  // Mercado Livre: public API for price + image + affiliate tag injection
  if (isMercadoLivreUrl(url)) {
    try {
      const info = await fetchMLProductInfo(url)
      if (info) {
        const affiliateUrl = await injectMLTag(info.permalink)
        return res.json({ name: info.name, price: info.price, originalPrice: info.originalPrice, imageUrl: info.imageUrl, originalUrl: affiliateUrl, affiliateUrl, partial: !info.price })
      }
    } catch (err) {
      console.warn('[scrape:ml]', err instanceof Error ? err.message : err)
    }
    return res.json({ partial: true, name: '', price: '', imageUrl: '', originalUrl: url })
  }

  // Amazon: OG scraping — user supplies their own affiliate URL, price likely empty
  const product = await quickFetchProduct(url)
  if (product) {
    return res.json({ ...product, partial: !product.price })
  }
  return res.json({ partial: true, name: '', price: '', imageUrl: '', originalUrl: url })
})

// POST /api/affiliate-link — generate Shopee affiliate link from any URL
app.post('/api/affiliate-link', async (req, res) => {
  const { url, subIds } = req.body as { url?: string; subIds?: SubIds }
  if (!url) return res.status(400).json({ error: 'URL é obrigatória' })
  try {
    const affiliateUrl = await generateAffiliateLink(url, subIds)
    res.json({ affiliateUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao gerar link'
    console.error('[affiliate-link]', message)
    res.status(500).json({ error: message })
  }
})

// POST /api/send
app.post('/api/send', async (req, res) => {
  const { productData, coupon, groupUrl } = req.body as {
    productData?: { name: string; price: string; originalPrice?: string; imageUrl: string; originalUrl: string }
    coupon?: string
    groupUrl?: string
  }
  if (!productData) return res.status(400).json({ error: 'Dados do produto são obrigatórios' })
  const resolvedGroupUrl = groupUrl || process.env.WHATSAPP_GROUP_URL || ''
  try {
    const payload = buildMessagePayload(productData, coupon || '', resolvedGroupUrl)
    const messageId = await sendOfferMessage(payload)
    const entry = appendHistory({
      productName: payload.name,
      price: payload.price,
      imageUrl: payload.imageUrl,
      affiliateUrl: payload.affiliateUrl,
    })
    console.log(`[send] ✓ ${payload.name} | ${payload.price} | msg: ${messageId}`)
    res.json({ success: true, messageId, entry })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao enviar mensagem'
    console.error('[send]', message)
    res.status(500).json({ error: message })
  }
})

// POST /api/send-telegram
app.post('/api/send-telegram', async (req, res) => {
  const { productData, coupon } = req.body as {
    productData?: { name: string; price: string; originalPrice?: string; imageUrl: string; originalUrl: string }
    coupon?: string
  }
  if (!productData) return res.status(400).json({ error: 'Dados do produto são obrigatórios' })
  try {
    await sendProductToChat(productData, coupon || '')
    appendHistory({
      productName: productData.name,
      price: productData.price,
      imageUrl: productData.imageUrl,
      affiliateUrl: productData.originalUrl,
    })
    console.log(`[telegram-send] ✓ ${productData.name}`)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao enviar'
    console.error('[telegram-send]', message)
    res.status(500).json({ error: message })
  }
})

// GET /api/test-ml?url=... — diagnóstico da integração ML (sem auth necessária)
app.get('/api/test-ml', async (req, res) => {
  const url = req.query.url as string
  if (!url) return res.status(400).json({ error: 'Passe ?url=...' })
  try {
    const affiliateUrl = await injectMLTag(url)
    const [apiInfo, ogInfo] = await Promise.allSettled([
      fetchMLProductInfo(url),
      quickFetchProduct(url),
    ])
    res.json({
      affiliateUrl,
      apiInfo: apiInfo.status === 'fulfilled' ? apiInfo.value : null,
      ogInfo: ogInfo.status === 'fulfilled' ? ogInfo.value : null,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// GET /api/history
app.get('/api/history', (_req, res) => {
  res.json(loadHistory().slice(0, 20))
})

// GET /api/deals
app.get('/api/deals', (_req, res) => {
  console.log(`[api/deals] retornando ${dealsCache.length} deals`)
  res.json(dealsCache)
})

// POST /api/deals/refresh
app.post('/api/deals/refresh', async (_req, res) => {
  await refreshDeals()
  res.json({ count: dealsCache.length })
})

// GET /api/categories
app.get('/api/categories', (_req, res) => {
  res.json(CATEGORY_META)
})

// GET /api/sent-today
app.get('/api/sent-today', (_req, res) => {
  res.json(sentTodayLog)
})

// GET /hoje
app.get('/hoje', (_req, res) => {
  res.sendFile(join(__dirname, '../../public/hoje.html'))
})


// GET /api/tenants — list all tenants (protected by /api auth middleware)
app.get('/api/tenants', async (_req, res) => {
  if (!_tenantRepo) return res.status(503).json({ error: 'Not initialized' })
  try {
    const tenants = await _tenantRepo.findAll()
    return res.json(tenants)
  } catch (err) {
    console.error('[/api/tenants]', err)
    return res.status(500).json({ error: 'Erro interno' })
  }
})

// GET /api/config — get default tenant config (protected by /api auth middleware)
app.get('/api/config', async (_req, res) => {
  if (!_tenantRepo) return res.status(503).json({ error: 'Not initialized' })
  try {
    const tenant = await _tenantRepo.findById('default')
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' })
    return res.json(tenant)
  } catch (err) {
    console.error('[/api/config]', err)
    return res.status(500).json({ error: 'Erro interno' })
  }
})

// PATCH /api/config — update default tenant config (protected by /api auth middleware)
// T-04-09: only allow patching filters, affiliates, channels — never id or active
app.patch('/api/config', async (req, res) => {
  if (!_tenantRepo) return res.status(503).json({ error: 'Not initialized' })
  try {
    const current = await _tenantRepo.findById('default')
    if (!current) return res.status(404).json({ error: 'Tenant not found' })
    const body = req.body as Partial<Tenant>
    const updated: Tenant = {
      ...current,
      filters: body.filters ?? current.filters,
      affiliates: body.affiliates ?? current.affiliates,
      channels: body.channels ?? current.channels,
      id: 'default',
      active: current.active,
    }
    await _tenantRepo.save(updated)
    return res.json(updated)
  } catch (err) {
    console.error('[/api/config PATCH]', err)
    return res.status(500).json({ error: 'Erro interno' })
  }
})

// GET /api/image-proxy
app.get('/api/image-proxy', proxyLimiter, async (req, res) => {
  const url = req.query.url as string
  if (!url) return res.status(400).send('URL required')
  if (!isImageHostAllowed(url)) return res.status(403).send('Domain not allowed')
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: 'https://shopee.com.br/',
      },
    })
    res.set('Content-Type', (response.headers['content-type'] as string) || 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=3600')
    res.send(response.data)
  } catch {
    res.status(502).send('Erro ao buscar imagem')
  }
})

app.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em http://localhost:${PORT}`)
  createBot()
  setTimeout(() => refreshDeals(), 5000)
})
