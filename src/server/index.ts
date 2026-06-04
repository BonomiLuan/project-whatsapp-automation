import 'dotenv/config'
import express from 'express'
import axios from 'axios'
import cron from 'node-cron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHmac } from 'crypto'
import { scrapeProduct } from '../scraper/productScraper.js'
import { buildMessagePayload } from '../content/messageBuilder.js'
import { sendOfferMessage } from '../api/metaClient.js'
import { appendHistory, loadHistory } from './history.js'
import { fetchDeals as fetchPelandoDeals } from '../content/pelando.js'
import { fetchShopeeDeals, generateAffiliateLink, CATEGORY_META, type SubIds, type DealCategory } from '../api/shopeeAffiliate.js'
import { createBot, sendProductToChat, sendDealToChat } from '../telegram/bot.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

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
  if (req.path === '/login') return next()
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
  source: 'shopee' | 'pelando'
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

  // Fallback: Pelando (if Shopee returned nothing)
  if (results.length === 0) {
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
          source: 'pelando',
          category: 'geral',
          publishedAt: d.publishedAt,
        })
      }
      console.log(`[pelando] ✓ ${pelandoDeals.length} deals (fallback)`)
    } catch (err) {
      console.error('[pelando] Erro:', err instanceof Error ? err.message : err)
    }
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

// Reset sent list at midnight
cron.schedule('0 0 * * *', () => {
  sentToday.clear()
  sentTodayLog = []
  roundRobinIndex = 0
  console.log('[cron] Reset de ofertas enviadas')
})

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

  try {
    await sendDealToChat(deal)
    sentToday.add(deal.id)
    sentTodayLog.push({ ...deal, sentAt: new Date().toISOString() })
    dealsCache = dealsCache.filter(d => d.id !== deal!.id)
    console.log(`[suggest] ✓ ${deal.category} — ${deal.title.slice(0, 40)}`)
  } catch (err) {
    console.error('[suggest] Erro:', err instanceof Error ? err.message : err)
  }
}

app.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em http://localhost:${PORT}`)
  createBot()
  refreshDeals()
  cron.schedule('*/30 * * * *', refreshDeals)
  cron.schedule('*/15 7-22 * * *', sendNextSuggestion)
})
