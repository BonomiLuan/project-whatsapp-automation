import axios from 'axios'
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

chromium.use(StealthPlugin())

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
}

function extractOgTag(html: string, property: string): string {
  const re1 = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i')
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i')
  return html.match(re1)?.[1] ?? html.match(re2)?.[1] ?? ''
}

export async function quickFetchProduct(url: string): Promise<ProductData | null> {
  try {
    const res = await axios.get<string>(url, {
      timeout: 12000,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      maxRedirects: 5,
    })

    const html = res.data as string

    // OG tags (Shopee, genérico) → fallback para <title> (Amazon não tem OG)
    const rawName = decodeHtmlEntities(
      extractOgTag(html, 'og:title') ||
      html.match(/<title[^>]*>([^<|]+)/i)?.[1]?.trim() ||
      ''
    )

    // OG image → Amazon hiRes/data-old-hires JSON embeds
    const imageUrl =
      extractOgTag(html, 'og:image') ||
      html.match(/"hiRes"\s*:\s*"(https:[^"]+)"/)?.[1] ||
      html.match(/data-old-hires="(https:[^"]+)"/)?.[1] ||
      ''

    if (!rawName || !imageUrl) return null

    const name = rawName.length > 60 ? rawName.slice(0, 57) + '...' : rawName

    // "displayPrice" já vem formatado "R$ 173,85"; fallback para "priceAmount"
    const displayPrice = html.match(/"displayPrice"\s*:\s*"([^"]+)"/)?.[1]?.trim()
    const priceAmount = html.match(/"priceAmount"\s*:\s*"?([\d.,]+)"?/)?.[1]
    const price = displayPrice ?? (priceAmount ? formatRawPrice(priceAmount) : '')

    return { name, price, imageUrl, originalUrl: url }
  } catch {
    return null
  }
}

export interface ProductData {
  name: string
  price: string
  originalPrice?: string
  imageUrl: string
  originalUrl: string
}

export async function scrapeProduct(url: string): Promise<ProductData> {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  await page.setViewportSize({ width: 1366, height: 768 })
  await page.setExtraHTTPHeaders({
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  })

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2500)

    const data = await page.evaluate(() => {
      // 1. Open Graph meta tags (most reliable, present even in SSR)
      const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
      const ogImage = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content

      // 2. Shopee initialState JSON (embedded in <script> tag — always present)
      let ssrName = ''
      let ssrImage = ''
      let ssrDiscount = ''
      for (const s of document.querySelectorAll('script:not([src])')) {
        const t = s.textContent || ''
        if (!t.includes('"title"') || !t.includes('"image"')) continue
        const titleMatch = t.match(/"title"\s*:\s*"([^"]{5,200})"/)
        const discountMatch = t.match(/"show_discount"\s*:\s*(\d+)/)
        if (titleMatch) ssrName = titleMatch[1]
        if (discountMatch) ssrDiscount = discountMatch[1]

        // Prefer "images" array (real product photos) over single "image" field
        // which may point to a video thumbnail
        if (!ssrImage) {
          const arrMatch = t.match(/"images"\s*:\s*\[([^\]]{10,})\]/)
          if (arrMatch) {
            const hashes = [...arrMatch[1].matchAll(/"([a-z]{2}-[^"]{10,})"/g)].map(m => m[1])
            if (hashes.length > 0) ssrImage = `https://down-br.img.susercontent.com/file/${hashes[0]}`
          }
        }
        // Fallback: first standalone "image" field
        if (!ssrImage) {
          const imageMatch = t.match(/"image"\s*:\s*"([a-z]{2}-[^"]{10,})"/)
          if (imageMatch) ssrImage = `https://down-br.img.susercontent.com/file/${imageMatch[1]}`
        }

        if (ssrName && ssrImage) break
      }

      // 3. JSON-LD structured data (fallback for non-Shopee sites)
      let ldName = ''
      let ldPrice = ''
      let ldImage = ''
      for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const json = JSON.parse(script.textContent || '{}')
          const product = json['@type'] === 'Product' ? json : json?.mainEntity
          if (product?.['@type'] === 'Product') {
            ldName = product.name || ''
            ldImage = Array.isArray(product.image) ? product.image[0] : product.image || ''
            const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers
            ldPrice = offers?.price || ''
          }
        } catch { /* skip */ }
      }

      // 4. ML price: <meta itemprop="price" content="20.90"> inside .ui-pdp-price__part
      const mlPriceEl = document.querySelector<HTMLMetaElement>('.ui-pdp-price__part meta[itemprop="price"]')
      const mlPrice = mlPriceEl?.getAttribute('content') || ''
      const mlOriginalPriceEl = document.querySelector<HTMLMetaElement>(
        '.ui-pdp-price__original-value meta[itemprop="price"], .andes-money-amount--previous meta[itemprop="price"]',
      )
      const mlOriginalPrice = mlOriginalPriceEl?.getAttribute('content') || ''

      // 5. Generic DOM selectors (Amazon, Americanas, etc.)
      const genericTitle = document.querySelector('h1')?.textContent?.trim()
      const genericPrice =
        document.querySelector('[class*="price-current"]')?.textContent?.trim() ||
        document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content') || ''
      const genericOriginalPrice =
        document.querySelector('[class*="price-before"]')?.textContent?.trim() ||
        document.querySelector('[class*="origin-price"]')?.textContent?.trim() || ''

      return {
        name: ssrName || ldName || ogTitle || genericTitle || '',
        price: mlPrice || ldPrice || genericPrice || '',
        originalPrice: mlOriginalPrice || genericOriginalPrice || '',
        imageUrl: ssrImage || ldImage || ogImage || '',
        discountPercent: ssrDiscount,
      }
    })

    if (!data.name) throw new Error('Não foi possível extrair o nome do produto.')
    if (!data.imageUrl) throw new Error('Não foi possível extrair a imagem do produto.')

    // Truncate name: 60 chars + ellipsis if cut
    const rawName = data.name.trim()
    const name = rawName.length > 60 ? rawName.slice(0, 57) + '...' : rawName

    return {
      name,
      price: formatRawPrice(data.price),
      originalPrice: formatRawPrice(data.originalPrice) || undefined,
      imageUrl: data.imageUrl,
      originalUrl: url,
    }
  } finally {
    await browser.close()
  }
}

function formatRawPrice(raw: string | undefined): string {
  if (!raw) return ''
  const cleaned = raw.trim()
  if (!cleaned) return ''
  if (cleaned.includes('R$')) return cleaned
  const num = parseFloat(cleaned.replace(',', '.'))
  if (isNaN(num)) return cleaned
  return `R$${num.toFixed(2).replace('.', ',')}`
}
