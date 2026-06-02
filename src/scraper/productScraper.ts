import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

chromium.use(StealthPlugin())

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
        const imageMatch = t.match(/"image"\s*:\s*"(sg-[^"]+)"/)
        const discountMatch = t.match(/"show_discount"\s*:\s*(\d+)/)
        if (titleMatch) ssrName = titleMatch[1]
        if (imageMatch) ssrImage = `https://down-br.img.susercontent.com/file/${imageMatch[1]}`
        if (discountMatch) ssrDiscount = discountMatch[1]
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

      // 4. Generic DOM selectors (Amazon, Americanas, etc.)
      const genericTitle = document.querySelector('h1')?.textContent?.trim()
      const genericPrice =
        document.querySelector('[class*="price-current"]')?.textContent?.trim() ||
        document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content') || ''
      const genericOriginalPrice =
        document.querySelector('[class*="price-before"]')?.textContent?.trim() ||
        document.querySelector('[class*="origin-price"]')?.textContent?.trim() || ''

      return {
        name: ssrName || ldName || ogTitle || genericTitle || '',
        price: ldPrice || genericPrice || '',
        originalPrice: genericOriginalPrice || '',
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
