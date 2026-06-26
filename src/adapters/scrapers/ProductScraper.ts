import axios from 'axios'

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

export interface ProductData {
  name: string
  price: string
  originalPrice?: string
  imageUrl: string
  originalUrl: string
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

    const rawName = decodeHtmlEntities(
      extractOgTag(html, 'og:title') ||
      html.match(/<title[^>]*>([^<|]+)/i)?.[1]?.trim() ||
      ''
    )

    const imageUrl =
      extractOgTag(html, 'og:image') ||
      html.match(/"hiRes"\s*:\s*"(https:[^"]+)"/)?.[1] ||
      html.match(/data-old-hires="(https:[^"]+)"/)?.[1] ||
      ''

    if (!rawName) return null

    const name = rawName.length > 60 ? rawName.slice(0, 57) + '...' : rawName

    const displayPrice = html.match(/"displayPrice"\s*:\s*"([^"]+)"/)?.[1]?.trim()
    const priceAmount = html.match(/"priceAmount"\s*:\s*"?([\d.,]+)"?/)?.[1]
    const price = displayPrice ?? (priceAmount ? formatRawPrice(priceAmount) : '')

    return { name, price, imageUrl, originalUrl: url }
  } catch {
    return null
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
