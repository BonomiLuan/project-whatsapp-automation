import 'dotenv/config'
import express from 'express'
import axios from 'axios'
import cron from 'node-cron'
import rateLimit from 'express-rate-limit'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHmac } from 'crypto'
import { scrapeProduct } from '../scraper/productScraper.js'
import { buildMessagePayload } from '../content/messageBuilder.js'
import { sendOfferMessage } from '../api/metaClient.js'
import { appendHistory, loadHistory } from './history.js'
import { fetchDeals as fetchPelandoDeals } from '../content/pelando.js'
import { fetchShopeeDeals, generateAffiliateLink, CATEGORY_META, type SubIds, type DealCategory } from '../api/shopeeAffiliate.js'
import { fetchMLDealsByKeyword, fetchMLProductInfo, injectMLTag } from '../api/mercadoLivreAffiliate.js'
import { quickFetchProduct } from '../scraper/productScraper.js'
import { createBot, sendProductToChat, sendDealToChat } from '../telegram/bot.js'
import { initLinksTable, getLink, incrementClick, getLinks, isSsrfAllowed, buildExpiredRedirectUrl, type LinkEntry } from './links.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

// ── Links: image LRU cache ────────────────────────────────────────────────────
interface ImageCacheEntry { buffer: Buffer; contentType: string; cachedAt: number }
const imageCache = new Map<string, ImageCacheEntry>()
const IMAGE_CACHE_MAX = 200

function lruSet(code: string, entry: ImageCacheEntry): void {
  if (imageCache.size >= IMAGE_CACHE_MAX) {
    const firstKey = imageCache.keys().next().value
    if (firstKey !== undefined) imageCache.delete(firstKey)
  }
  imageCache.set(code, entry)
}

// ── Links: rate limiter ───────────────────────────────────────────────────────
const redirectLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
})

// ── Links: helpers ────────────────────────────────────────────────────────────
function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function getBaseUrl(req: express.Request): string {
  if (req.protocol === 'http' && req.headers['x-forwarded-proto'] === 'https') {
    return 'https://' + req.get('host')
  }
  const host = req.get('host')
  if (!host) return process.env.BASE_URL || 'http://localhost:3000'
  return req.protocol + '://' + host
}

function buildOGPage(link: LinkEntry, baseUrl: string): string {
  const title = esc(link.title)
  const sourceName = link.source === 'ml' ? 'Mercado Livre' : link.source.charAt(0).toUpperCase() + link.source.slice(1)
  const description = esc(sourceName + ' — Clique para ver a oferta')
  const ogImage = baseUrl + '/img/' + link.code
  const ogUrl = baseUrl + '/r/' + link.code
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${ogUrl}">
<meta property="og:type" content="website">
<meta http-equiv="refresh" content="0;url=${link.affiliate_url}">
<title>${title}</title>
</head>
<body>
<p>Redirecionando para a oferta...</p>
<script>window.location.href = ${JSON.stringify(link.affiliate_url)};</script>
</body>
</html>`
}

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
  source: 'shopee' | 'amazon' | 'mercado-livre'
  category: DealCategory
  publishedAt: string
}

let dealsCache: UnifiedDeal[] = []
let sentTodayLog: (UnifiedDeal & { sentAt: string })[] = []

export async function refreshDeals() {
  const results: UnifiedDeal[] = []
  const now = new Date().toISOString()

  // Primary: Shopee Affiliate API
  if (process.env.SHOPEE_APP_ID && process.env.SHOPEE_SECRET) {
    try {
      const shopeeProducts = await fetchShopeeDeals(12)
      for (const p of shopeeProducts) {
        const priceNum = parseFloat(p.price)
        const originalNum = p.priceDiscountRate > 0
          ? priceNum / (1 - p.priceDiscountRate / 100)
          : undefined
        results.push({
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
          source: 'shopee',
          category: p.category,
          publishedAt: now,
        })
      }
      console.log(`[shopee] ✓ ${results.length} produtos encontrados`)
    } catch (err) {
      console.error('[shopee] Erro:', err instanceof Error ? err.message : err)
    }
  }

  // Amazon via Pelando (always runs in parallel with Shopee)
  try {
    const pelandoDeals = await fetchPelandoDeals()
    for (const d of pelandoDeals) {
      results.push({
        id: d.id,
        title: d.title,
        price: d.price,
        discountPercent: d.temperature,
        store: d.store,
        imageUrl: d.imageUrl,
        affiliateUrl: d.dealUrl,
        source: 'amazon',
        category: 'geral',
        publishedAt: d.publishedAt,
      })
    }
    console.log(`[amazon] ✓ ${pelandoDeals.length} deals via Pelando`)
  } catch (err) {
    console.error('[amazon] Erro:', err instanceof Error ? err.message : err)
  }

  // Mercado Livre via API pública
  try {
    const ML_KEYWORDS = [
      'fralda pampers', 'fralda huggies', 'carrinho bebe', 'berco bebe',
      'bebe conforto', 'mamadeira', 'chupeta', 'monitor bebe',
      'tapete atividades bebe', 'termometro bebe',
    ]
    const mlResults = await Promise.allSettled(
      ML_KEYWORDS.map(k => fetchMLDealsByKeyword(k, 5))
    )
    const seenML = new Set<string>()
    for (const r of mlResults) {
      if (r.status !== 'fulfilled') continue
      for (const d of r.value) {
        if (seenML.has(d.id)) continue
        seenML.add(d.id)
        results.push({
          id: d.id,
          title: d.title,
          price: d.price,
          originalPrice: d.originalPrice,
          discountPercent: d.discountPercent,
          store: d.store,
          imageUrl: d.imageUrl,
          affiliateUrl: d.affiliateUrl,
          source: 'mercado-livre',
          category: 'geral',
          publishedAt: now,
        })
      }
    }
    const mlCount = [...seenML].length
    console.log(`[mercadolivre] ✓ ${mlCount} produtos encontrados`)
  } catch (err) {
    console.error('[mercadolivre] Erro:', err instanceof Error ? err.message : err)
  }

  dealsCache = results
}

export function getCachedDeals() {
  return dealsCache
}

export function getSentToday() {
  return sentTodayLog
}

// POST /api/scrape
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body as { url?: string }
  if (!url) return res.status(400).json({ error: 'URL é obrigatória' })
  try {
    const product = await scrapeProduct(url)
    res.json(product)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao extrair produto'
    console.error('[scrape]', message)
    res.status(500).json({ error: message })
  }
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

// GET /r/:code — OG tag HTML + meta refresh, rate-limited, click increment
app.get('/r/:code', redirectLimiter, async (req, res) => {
  try {
    const code = String(req.params.code)
    const link = await getLink(code)
    if (!link) return res.status(404).json({ error: 'Link não encontrado' })
    if (new Date() > link.expires_at) {
      const searchUrl = buildExpiredRedirectUrl(link.source, link.title)
      return res.redirect(302, searchUrl)
    }
    incrementClick(code).catch(err => console.warn('[links] incrementClick error:', err))
    const baseUrl = getBaseUrl(req)
    return res.status(200).type('html').send(buildOGPage(link, baseUrl))
  } catch (err) {
    console.error('[/r/:code]', err)
    return res.status(500).json({ error: 'Erro interno' })
  }
})

// GET /img/:code — SSRF-safe image proxy with LRU cache + 24h Cache-Control
app.get('/img/:code', async (req, res) => {
  try {
    const code = String(req.params.code)
    const cached = imageCache.get(code)
    if (cached) {
      return res.set('Content-Type', cached.contentType).set('Cache-Control', 'public, max-age=86400').send(cached.buffer)
    }
    const link = await getLink(code)
    if (!link) return res.status(404).json({ error: 'Link não encontrado' })
    if (!isSsrfAllowed(link.image_url)) return res.status(403).json({ error: 'Image domain not allowed' })
    try {
      const response = await axios.get(link.image_url, {
        responseType: 'arraybuffer',
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WhatsApp/2.0)',
          Referer: 'https://shopee.com.br/',
        },
      })
      const buffer = Buffer.from(response.data as ArrayBuffer)
      const contentType = (response.headers['content-type'] as string) || 'image/jpeg'
      lruSet(code, { buffer, contentType, cachedAt: Date.now() })
      return res.set('Content-Type', contentType).set('Cache-Control', 'public, max-age=86400').send(buffer)
    } catch {
      return res.status(502).json({ error: 'Erro ao buscar imagem' })
    }
  } catch (err) {
    console.error('[/img/:code]', err)
    return res.status(502).json({ error: 'Erro ao buscar imagem' })
  }
})

// GET /api/links — analytics list (protected by /api auth middleware above)
app.get('/api/links', async (_req, res) => {
  try {
    const links = await getLinks(100)
    return res.json(links)
  } catch (err) {
    console.error('[/api/links]', err)
    return res.status(500).json({ error: 'Erro interno' })
  }
})

// GET /api/image-proxy
app.get('/api/image-proxy', async (req, res) => {
  const url = req.query.url as string
  if (!url) return res.status(400).send('URL required')
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

// ── Deal suggestion rotation ──────────────────────────────────────────────────

const sentToday = new Set<string>()
let roundRobinIndex = 0
let lastSentSource: string | null = null

// Reset sent list at midnight Brasília time
cron.schedule('0 0 * * *', () => {
  sentToday.clear()
  sentTodayLog = []
  roundRobinIndex = 0
  lastSentSource = null
  console.log('[cron] Reset de ofertas enviadas')
}, { timezone: 'America/Sao_Paulo' })

// Fixed rotation list — always cycles through ALL categories in order
const ALL_CATEGORIES = Object.keys(CATEGORY_META) as DealCategory[]

async function sendNextSuggestion() {
  const available = dealsCache.filter(d => !sentToday.has(d.id))
  if (!available.length) {
    console.log('[suggest] Todos os produtos já enviados hoje')
    return
  }

  // Walk the fixed category list until we find one with available deals
  let deal: UnifiedDeal | undefined
  let attempts = 0
  while (!deal && attempts < ALL_CATEGORIES.length) {
    const cat = ALL_CATEGORIES[roundRobinIndex % ALL_CATEGORIES.length]
    roundRobinIndex++
    attempts++
    const pool = available.filter(d => d.category === cat)
    if (pool.length > 0) {
      // Pick randomly within the category for variety
      deal = pool[Math.floor(Math.random() * pool.length)]
    }
  }

  // Fallback: pick any random available deal
  if (!deal) deal = available[Math.floor(Math.random() * available.length)]

  // Variedade de fonte: se o candidato é da mesma fonte que o último enviado,
  // prefere uma fonte diferente (shopee → amazon → shopee etc.)
  if (deal && lastSentSource && deal.source === lastSentSource) {
    const altPool = available.filter(d => d.source !== lastSentSource)
    if (altPool.length > 0) {
      deal = altPool[Math.floor(Math.random() * altPool.length)]
    }
  }

  try {
    await sendDealToChat(deal)
    sentToday.add(deal.id)
    lastSentSource = deal.source
    sentTodayLog.push({ ...deal, sentAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) })
    dealsCache = dealsCache.filter(d => d.id !== deal!.id)
    console.log(`[suggest] ✓ [${deal.source}] ${deal.category} — ${deal.title.slice(0, 40)}`)
  } catch (err) {
    console.error('[suggest] Erro:', err instanceof Error ? err.message : err)
  }
}

app.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em http://localhost:${PORT}`)
  createBot()
  refreshDeals()
  const baseUrl = process.env.BASE_URL || ''
  if (!baseUrl || baseUrl.includes('localhost')) {
    console.warn('[links] ⚠️  BASE_URL não configurado ou é localhost — links curtos não vão funcionar em produção')
  }
  initLinksTable().catch(console.error)
  cron.schedule('*/30 * * * *', refreshDeals, { timezone: 'America/Sao_Paulo' })
  cron.schedule('*/15 7-22 * * *', sendNextSuggestion, { timezone: 'America/Sao_Paulo' })
})
