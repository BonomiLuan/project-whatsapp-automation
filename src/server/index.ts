import 'dotenv/config'
import express from 'express'
import axios from 'axios'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { scrapeProduct } from '../scraper/productScraper.js'
import { buildMessagePayload } from '../content/messageBuilder.js'
import { sendOfferMessage } from '../api/metaClient.js'
import { appendHistory, loadHistory } from './history.js'
import { createBot } from '../telegram/bot.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(join(__dirname, '../../public')))

// POST /api/scrape — extract product data from URL
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

// POST /api/send — send formatted offer to WhatsApp
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

// GET /api/history — return last 20 sent offers
app.get('/api/history', (_req, res) => {
  res.json(loadHistory().slice(0, 20))
})

// GET /api/image-proxy — proxy product images to bypass CORS/referer restrictions
app.get('/api/image-proxy', async (req, res) => {
  const url = req.query.url as string
  if (!url) return res.status(400).send('URL required')

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://shopee.com.br/',
      },
    })
    const contentType = (response.headers['content-type'] as string) || 'image/jpeg'
    res.set('Content-Type', contentType)
    res.set('Cache-Control', 'public, max-age=3600')
    res.send(response.data)
  } catch {
    res.status(502).send('Erro ao buscar imagem')
  }
})

app.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em http://localhost:${PORT}`)
  createBot()
})
