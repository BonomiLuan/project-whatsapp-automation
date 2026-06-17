import type { ProductData } from '../../scraper/productScraper.js'

export interface MessagePayload {
  name: string
  price: string
  coupon: string
  affiliateUrl: string
  groupUrl: string
  imageUrl: string
}

export function buildMessagePayload(
  product: ProductData,
  coupon: string,
  groupUrl: string
): MessagePayload {
  const name = product.name.trim().slice(0, 60)
  const imageUrl = ensureHttps(product.imageUrl)

  const promo = fmt(product.price)
  const orig = fmt(product.originalPrice)

  // WhatsApp strikethrough: ~R$180,00~ R$115,00
  const price = orig && promo ? `~${orig}~ ${promo}` : promo || 'Consulte o site'

  // When coupon exists: full line including emoji (goes into {{3}})
  // When no coupon: single space (renders as invisible blank line in WhatsApp)
  const couponLine = coupon.trim() ? `🎟️ Cupom: ${coupon.trim()}` : ' '

  return {
    name,
    price,
    coupon: couponLine,
    affiliateUrl: product.originalUrl,
    groupUrl: groupUrl.trim(),
    imageUrl,
  }
}

/** Format a raw price string to R$X,XX — exported for reuse in bot */
export function fmt(raw?: string): string {
  if (!raw) return ''
  const cleaned = raw.trim()
  if (!cleaned) return ''
  if (/^R\$/.test(cleaned)) return cleaned
  // Strip any R$ prefix variants and non-numeric chars except comma/dot
  const digits = cleaned.replace(/[^\d.,]/g, '').replace(',', '.')
  const num = parseFloat(digits)
  if (isNaN(num)) return cleaned
  return `R$${num.toFixed(2).replace('.', ',')}`
}

function ensureHttps(url: string): string {
  if (url.startsWith('http://')) return url.replace('http://', 'https://')
  return url
}
