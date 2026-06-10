import axios from 'axios'

const PUBLISHER_ID = process.env.ML_PUBLISHER_ID ?? '64897511'
const MATT_WORD = process.env.ML_MATT_WORD ?? 'mamaeeconomica'

const ML_API = 'https://api.mercadolibre.com'

export interface MLProductInfo {
  id: string
  name: string
  price: string
  originalPrice?: string
  imageUrl: string
  permalink: string
}

// Matches both MLB123 (regular item) and MLBU123 (catalog/universal product)
function extractMLProductId(url: string): string | null {
  const match = url.match(/MLB[A-Z]?\d+/i)
  return match ? match[0].toUpperCase() : null
}

function isCatalogId(id: string): boolean {
  return /^MLBU/i.test(id)
}

async function expandShortLink(url: string): Promise<string> {
  try {
    const res = await axios.get(url, {
      maxRedirects: 5,
      timeout: 8000,
      validateStatus: () => true,
    })
    return (res.request as { res?: { responseUrl?: string } }).res?.responseUrl ?? url
  } catch {
    return url
  }
}

export async function injectMLTag(url: string): Promise<string> {
  try {
    let resolved = url
    if (url.includes('meli.la') || url.includes('ml.bz')) {
      resolved = await expandShortLink(url)
    }
    const parsed = new URL(resolved)
    // Remove any existing matt_ params before injecting fresh ones
    parsed.searchParams.delete('matt_tool')
    parsed.searchParams.delete('matt_word')
    parsed.searchParams.delete('ref')
    parsed.searchParams.delete('forceInApp')
    parsed.searchParams.set('matt_tool', PUBLISHER_ID)
    parsed.searchParams.set('matt_word', MATT_WORD)
    return parsed.toString()
  } catch {
    return url
  }
}

export function isMercadoLivreUrl(url: string): boolean {
  return (
    url.includes('mercadolivre.com.br') ||
    url.includes('mercadolibre.com') ||
    url.includes('mercadoshops.com.br') ||
    url.includes('meli.la') ||
    url.includes('ml.bz')
  )
}

function bestImageUrl(data: Record<string, unknown>): string {
  // Prefer full-size picture from the pictures array
  const pictures = data.pictures as { url?: string; secure_url?: string }[] | undefined
  if (pictures?.length) {
    const pic = pictures[0]
    const raw = (pic.secure_url ?? pic.url ?? '') as string
    return raw.replace('http://', 'https://')
  }
  // Fall back to thumbnail, upgrading from small (-I) to medium (-O)
  const thumb = ((data.thumbnail as string) ?? '').replace('http://', 'https://')
  return thumb.replace(/-I\.(jpg|webp)$/i, '-O.$1')
}

async function fetchFromItemsApi(itemId: string): Promise<MLProductInfo | null> {
  const { data } = await axios.get(`${ML_API}/items/${itemId}`, { timeout: 10000 })
  const price = parseFloat(data.price)
  const originalPrice = data.original_price ? parseFloat(data.original_price) : undefined
  return {
    id: itemId,
    name: (data.title as string).slice(0, 80),
    price: `R$${price.toFixed(2).replace('.', ',')}`,
    originalPrice: originalPrice ? `R$${originalPrice.toFixed(2).replace('.', ',')}` : undefined,
    imageUrl: bestImageUrl(data),
    permalink: data.permalink as string,
  }
}

async function fetchFromCatalogApi(catalogId: string, originalUrl: string): Promise<MLProductInfo | null> {
  const { data } = await axios.get(`${ML_API}/catalog/products/${catalogId}`, { timeout: 10000 })

  const winner = data.buy_box_winner as { price?: number; original_price?: number; item_id?: string } | undefined
  const price = winner?.price ?? 0
  const originalPrice = winner?.original_price

  const pictures = data.pictures as { url?: string }[] | undefined
  const imageUrl = pictures?.[0]?.url?.replace('http://', 'https://') ?? ''

  if (!imageUrl) return null

  return {
    id: catalogId,
    name: (data.name as string ?? '').slice(0, 80),
    price: price ? `R$${price.toFixed(2).replace('.', ',')}` : '',
    originalPrice: originalPrice ? `R$${originalPrice.toFixed(2).replace('.', ',')}` : undefined,
    imageUrl,
    permalink: originalUrl,
  }
}

export async function fetchMLProductInfo(url: string): Promise<MLProductInfo | null> {
  try {
    let resolved = url
    if (url.includes('meli.la') || url.includes('ml.bz')) {
      resolved = await expandShortLink(url)
    }

    const productId = extractMLProductId(resolved)
    if (!productId) return null

    if (isCatalogId(productId)) {
      return await fetchFromCatalogApi(productId, resolved)
    }
    return await fetchFromItemsApi(productId)
  } catch {
    return null
  }
}

// ── Busca de deals por keyword via API pública ────────────────────────────────

interface MLSearchItem {
  id: string
  title: string
  price: number
  original_price: number | null
  thumbnail: string
  permalink: string
  seller: { nickname: string }
  reviews?: { rating_average: number }
}

export interface MLDeal {
  id: string
  title: string
  price: string
  originalPrice?: string
  discountPercent: number
  imageUrl: string
  affiliateUrl: string
  permalink: string
  store: string
}

export async function fetchMLDealsByKeyword(keyword: string, limit = 10): Promise<MLDeal[]> {
  try {
    const { data } = await axios.get(`${ML_API}/sites/MLB/search`, {
      params: { q: keyword, sort: 'relevance', limit },
      timeout: 10000,
    })

    const results: MLDeal[] = []
    for (const item of (data.results ?? []) as MLSearchItem[]) {
      if (!item.original_price || item.original_price <= item.price) continue
      const discount = Math.round((1 - item.price / item.original_price) * 100)
      if (discount < 10) continue

      const affiliateUrl = await injectMLTag(item.permalink)
      const thumbnail = (item.thumbnail ?? '').replace('http://', 'https://').replace('-I.jpg', '-O.jpg')

      results.push({
        id: item.id,
        title: item.title.slice(0, 80),
        price: `R$${item.price.toFixed(2).replace('.', ',')}`,
        originalPrice: `R$${item.original_price.toFixed(2).replace('.', ',')}`,
        discountPercent: discount,
        imageUrl: thumbnail,
        affiliateUrl,
        permalink: item.permalink,
        store: item.seller?.nickname ?? 'Mercado Livre',
      })
    }
    return results
  } catch {
    return []
  }
}
