import 'dotenv/config'
import express from 'express'
import axios from 'axios'
import rateLimit from 'express-rate-limit'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHmac, createHash } from 'crypto'
import { scrapeProduct } from '../adapters/scrapers/ProductScraper.js'
import { buildMessagePayload } from '../adapters/publishers/format.js'
import { sendOfferMessage } from '../adapters/publishers/WhatsAppPublisher.js'
import { appendHistory, loadHistory } from '../adapters/db/HistoryRepository.js'
import { fetchDeals as fetchPelandoDeals } from '../adapters/scrapers/PelandoScraper.js'
import { fetchShopeeDeals, generateAffiliateLink, CATEGORY_META, type SubIds, type DealCategory } from '../adapters/affiliates/ShopeeAffiliate.js'
import { fetchMLProductInfo, injectMLTag } from '../adapters/affiliates/MLAffiliate.js'
import { quickFetchProduct } from '../adapters/scrapers/ProductScraper.js'
import { createBot, sendProductToChat, sendDealToChat } from '../adapters/publishers/TelegramPublisher.js'
import { initLinksTable, getLink, getLinkImageData, incrementClick, getLinks, isSsrfAllowed, buildExpiredRedirectUrl, type LinkEntry } from '../adapters/db/PgLinkRepository.js'
import { withCronLock } from '../adapters/lock/PgAdvisoryLock.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
app.set('trust proxy', 1)
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
  const sourceName = link.source === 'ml' ? 'Mercado Livre' : link.source === 'amazon' ? 'Amazon' : 'Shopee'
  const description = esc(sourceName + ' — Clique para ver a oferta')
  // og:image: sempre via proxy para evitar bloqueio de hotlinking nas CDNs
  const ogImage = baseUrl + '/img/' + link.code
  const proxyImage = ogImage
  const ogUrl = baseUrl + '/r/' + link.code
  const sourceColor = link.source === 'amazon' ? '#FF9900' : link.source === 'ml' ? '#FFE600' : '#EE4D2D'
  const sourceBg = link.source === 'amazon' ? '#232F3E' : link.source === 'ml' ? '#3483FA' : '#fff'
  const sourceText = link.source === 'amazon' ? '#fff' : link.source === 'ml' ? '#fff' : '#EE4D2D'
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:secure_url" content="${ogImage}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1200">
<meta property="og:url" content="${ogUrl}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${ogImage}">
<meta http-equiv="refresh" content="0;url=${link.affiliate_url}">
<title>${title}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
  .card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.10);max-width:400px;width:100%;overflow:hidden;animation:fadeUp .4s ease}
  .img-wrap{width:100%;aspect-ratio:1;background:#f0f0f0;overflow:hidden}
  .img-wrap img{width:100%;height:100%;object-fit:contain;padding:12px}
  .body{padding:20px}
  .badge{display:inline-flex;align-items:center;gap:6px;background:${sourceBg};color:${sourceText};border:1.5px solid ${sourceColor};border-radius:20px;font-size:12px;font-weight:600;padding:4px 10px;margin-bottom:12px}
  .badge-dot{width:8px;height:8px;border-radius:50%;background:${sourceColor}}
  h1{font-size:15px;font-weight:600;color:#1a1a1a;line-height:1.4;margin-bottom:20px}
  .redirect{display:flex;align-items:center;gap:10px;color:#888;font-size:13px}
  .spinner{width:18px;height:18px;border:2px solid #e0e0e0;border-top-color:${sourceColor};border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
  .footer{text-align:center;padding:12px;font-size:11px;color:#bbb;border-top:1px solid #f0f0f0}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>
<div class="card">
  <div class="img-wrap"><img src="${proxyImage}" alt="${title}" onerror="this.style.display='none'"></div>
  <div class="body">
    <div class="badge"><span class="badge-dot"></span>${sourceName}</div>
    <h1>${title}</h1>
    <div class="redirect"><div class="spinner"></div>Redirecionando para a oferta…</div>
  </div>
  <div class="footer">Mamãe Econômica 🛍️</div>
</div>
<script>setTimeout(()=>{window.location.href=${JSON.stringify(link.affiliate_url)}},300)</script>
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

// Tracks Pelando deal IDs already processed — prevents sending the same coupon twice
const seenPelandoIds = new Set<string>()

export async function refreshDeals() {
  const now = new Date().toISOString()
  const shopeeResults: UnifiedDeal[] = []

  // Shopee Affiliate API only — Pelando is handled by monitorPelando()
  if (process.env.SHOPEE_APP_ID && process.env.SHOPEE_SECRET) {
    try {
      const shopeeProducts = await fetchShopeeDeals(12)
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

  // Rebuild cache: keep Pelando deals, replace Shopee
  const pelandoDeals = dealsCache.filter(d => d.source === 'amazon' || d.source === 'mercado-livre')
  dealsCache = [...pelandoDeals, ...shopeeResults]
}

export async function monitorPelando(): Promise<void> {
  const ran = await withCronLock(111222333, _monitorPelando)
  if (ran === null) console.log('[pelando:monitor] Outra instância já está rodando, pulando ciclo')
}

async function _monitorPelando(): Promise<void> {
  console.log('[pelando:monitor] Verificando novos deals e cupons...')
  try {
    const pelandoDeals = await fetchPelandoDeals()
    const now = new Date().toISOString()

    const freshDeals: UnifiedDeal[] = []
    const newCoupons: import('../adapters/scrapers/PelandoScraper.js').PelandoDeal[] = []
    let amazonCount = 0, mlCount = 0

    for (const d of pelandoDeals) {
      const isNew = !seenPelandoIds.has(d.id)
      seenPelandoIds.add(d.id)

      if (d.couponCode) {
        if (isNew) newCoupons.push(d)
        continue  // coupons don't go into dealsCache
      }

      // Regular deal → add to cache
      const storeLower = d.store.toLowerCase()
      const isShopee = storeLower.includes('shopee')
      const isML = !isShopee && (storeLower.includes('mercado') || storeLower.includes('mercadolivre') || storeLower === 'ml')
      const source: UnifiedDeal['source'] = isShopee ? 'shopee' : isML ? 'mercado-livre' : 'amazon'
      if (isML) mlCount++; else if (!isShopee) amazonCount++

      freshDeals.push({
        id: createHash('sha1').update(d.id).digest('hex').slice(0, 12),
        title: d.title,
        price: d.price,
        discountPercent: d.temperature,
        store: d.store,
        imageUrl: d.imageUrl,
        affiliateUrl: d.dealUrl,
        source,
        category: 'geral',
        publishedAt: now,
      })
    }

    // Replace Pelando portion of cache; preserve Shopee and ML API deals
    const shopeeDeals = dealsCache.filter(d => d.source === 'shopee')
    const mlApiDeals = dealsCache.filter(d => d.source === 'mercado-livre' && !freshDeals.find(f => f.id === d.id))
    dealsCache = [...shopeeDeals, ...mlApiDeals, ...freshDeals]
    console.log(`[pelando:monitor] ✓ ${amazonCount} Amazon + ${mlCount} ML | ${newCoupons.length} cupons novos`)

    // Send new coupons immediately
    if (newCoupons.length > 0) {
      const { sendPelandoCouponToChat } = await import('../adapters/publishers/TelegramPublisher.js')
      for (const coupon of newCoupons) {
        try {
          await sendPelandoCouponToChat(coupon)
          console.log(`[pelando:monitor] ✓ Cupom enviado: ${coupon.couponCode} — ${coupon.store}`)
        } catch (err) {
          console.error(`[pelando:monitor] Erro ao enviar cupom:`, err instanceof Error ? err.message : err)
        }
      }
    }
  } catch (err) {
    console.error('[pelando:monitor] Erro:', err instanceof Error ? err.message : err)
  }
}

export async function monitorML(): Promise<void> {
  console.log('[ml:monitor] Buscando deals ML por categoria...')
  try {
    const { fetchMLCategoryDeals } = await import('../adapters/scrapers/MercadoLivreScraper.js')
    const mlDeals = await fetchMLCategoryDeals(50)
    const now = new Date().toISOString()

    const freshDeals: UnifiedDeal[] = mlDeals.map(d => ({
      id: d.id,
      title: d.title,
      price: d.price,
      originalPrice: d.originalPrice,
      discountPercent: d.discountPercent,
      store: 'Mercado Livre',
      imageUrl: d.imageUrl,
      affiliateUrl: d.affiliateUrl,
      source: 'mercado-livre' as const,
      category: d.category,
      publishedAt: now,
    }))

    // Replace ML API deals, preserve Shopee + Amazon/Pelando deals
    const nonMLDeals = dealsCache.filter(d => d.source !== 'mercado-livre')
    dealsCache = [...nonMLDeals, ...freshDeals]
    console.log(`[ml:monitor] ✓ ${freshDeals.length} deals ML no cache`)
  } catch (err) {
    console.error('[ml:monitor] Erro:', err instanceof Error ? err.message : err)
  }
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

// GET /img/:code — serve stored image bytes first, fall back to proxy
app.get('/img/:code', async (req, res) => {
  try {
    const code = String(req.params.code)
    const cached = imageCache.get(code)
    if (cached) {
      return res.set('Content-Type', cached.contentType).set('Cache-Control', 'public, max-age=86400').send(cached.buffer)
    }
    const link = await getLink(code)
    if (!link) return res.status(404).json({ error: 'Link não encontrado' })

    // Serve from stored bytes (pre-fetched at link creation time — avoids CDN hotlink blocks)
    const stored = await getLinkImageData(code)
    if (stored) {
      lruSet(code, { buffer: stored.buffer, contentType: stored.mime, cachedAt: Date.now() })
      return res.set('Content-Type', stored.mime).set('Cache-Control', 'public, max-age=86400').send(stored.buffer)
    }

    // Fallback: proxy the CDN URL (covers old links without stored bytes)
    if (!isSsrfAllowed(link.image_url)) return res.status(403).json({ error: 'Image domain not allowed' })
    try {
      const imageHost = new URL(link.image_url).hostname
      const referer = imageHost.includes('amazon') ? 'https://www.amazon.com.br/'
        : imageHost.includes('pelando') ? 'https://www.pelando.com.br/'
        : imageHost.includes('mercadolivre') || imageHost.includes('mlstatic') ? 'https://www.mercadolivre.com.br/'
        : 'https://shopee.com.br/'
      const response = await axios.get(link.image_url, {
        responseType: 'arraybuffer',
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer: referer,
        },
      })
      const buffer = Buffer.from(response.data as ArrayBuffer)
      if (buffer.length < 5000) return res.status(502).json({ error: 'Imagem bloqueada pelo CDN' })
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

app.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em http://localhost:${PORT}`)
  createBot()
  refreshDeals()
  const baseUrl = process.env.BASE_URL || ''
  if (!baseUrl || baseUrl.includes('localhost')) {
    console.warn('[links] ⚠️  BASE_URL não configurado ou é localhost — links curtos não vão funcionar em produção')
  }
  initLinksTable().catch(console.error)
})
