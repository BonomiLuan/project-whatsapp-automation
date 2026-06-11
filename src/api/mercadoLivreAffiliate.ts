import axios from 'axios'

const PUBLISHER_ID = process.env.ML_PUBLISHER_ID ?? '64897511'
const MATT_WORD = process.env.ML_MATT_WORD ?? 'mamaeeconomica'

const ML_API = 'https://api.mercadolibre.com'

// ── OAuth app token (client_credentials) ─────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null

async function getAppToken(): Promise<string | null> {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  // Reuse cached token if still valid (with 5 min buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 300_000) {
    return cachedToken.token
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  })

  const { data } = await axios.post(`${ML_API}/oauth/token`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  })

  cachedToken = {
    token: data.access_token as string,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
  }
  console.log('[ml] token OAuth renovado')
  return cachedToken.token
}

async function mlHeaders(): Promise<Record<string, string>> {
  const base: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  }
  try {
    const token = await getAppToken()
    if (token) base['Authorization'] = `Bearer ${token}`
  } catch (e) {
    console.log('[ml] falha ao obter token:', (e as Error).message)
  }
  return base
}

const ML_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9',
}

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
  const { data } = await axios.get(`${ML_API}/items/${itemId}`, { headers: await mlHeaders(), timeout: 10000 })
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
  console.log(`[ml] catalog API → ${ML_API}/catalog/products/${catalogId}`)
  const { data } = await axios.get(`${ML_API}/catalog/products/${catalogId}`, { headers: await mlHeaders(), timeout: 10000 })
  console.log(`[ml] catalog keys:`, Object.keys(data).join(', '))

  const winner = data.buy_box_winner as { price?: number; original_price?: number; item_id?: string } | undefined
  const price = winner?.price ?? 0
  const originalPrice = winner?.original_price

  const pictures = data.pictures as { url?: string }[] | undefined
  const imageUrl = pictures?.[0]?.url?.replace('http://', 'https://') ?? ''
  console.log(`[ml] catalog imageUrl: ${imageUrl}, price: ${price}`)

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

// Fallback para MLBU: extrai keywords do slug da URL e busca via search
async function fetchFromSlugSearch(url: string): Promise<MLProductInfo | null> {
  const slug = url.match(/mercadolivre\.com\.br\/([^/?#]+)/)?.[1] ?? ''
  if (!slug) return null

  const keywords = slug.replace(/-/g, ' ').split(' ').slice(0, 6).join(' ')
  console.log(`[ml] slug search → "${keywords}"`)

  let searchData: Record<string, unknown>
  try {
    const r = await axios.get(`${ML_API}/sites/MLB/search`, {
      params: { q: keywords, limit: 1 },
      headers: await mlHeaders(),
      timeout: 10000,
    })
    searchData = r.data
  } catch (e) {
    const axErr = e as import('axios').AxiosError
    console.log(`[ml] slug search falhou: ${axErr.message} | body: ${JSON.stringify(axErr.response?.data)}`)
    return null
  }

  const item = (searchData.results as MLSearchItem[] | undefined)?.[0]
  if (!item) return null

  const price = item.price
  const originalPrice = item.original_price ?? undefined
  const imageUrl = (item.thumbnail ?? '').replace('http://', 'https://').replace(/-I\.(jpg|webp)$/i, '-O.$1')
  console.log(`[ml] slug result: "${item.title}" | R$${price} | img: ${imageUrl}`)

  if (!imageUrl) return null

  const affiliateUrl = await injectMLTag(item.permalink)
  return {
    id: item.id,
    name: item.title.slice(0, 80),
    price: `R$${price.toFixed(2).replace('.', ',')}`,
    originalPrice: originalPrice ? `R$${originalPrice.toFixed(2).replace('.', ',')}` : undefined,
    imageUrl,
    permalink: affiliateUrl,
  }
}

export async function fetchMLProductInfo(url: string): Promise<MLProductInfo | null> {
  let resolved = url
  if (url.includes('meli.la') || url.includes('ml.bz')) {
    resolved = await expandShortLink(url)
  }

  const productId = extractMLProductId(resolved)
  console.log(`[ml] productId extraído: ${productId ?? 'NENHUM'} de ${resolved.slice(0, 80)}`)

  if (!productId) {
    // Sem ID extraível — tenta busca por slug diretamente
    try { return await fetchFromSlugSearch(resolved) } catch { return null }
  }

  if (isCatalogId(productId)) {
    // Tenta catalog API, depois slug search como fallback
    try {
      const result = await fetchFromCatalogApi(productId, resolved)
      if (result) return result
    } catch (e) {
      console.log(`[ml] catalog API falhou: ${(e as Error).message}`)
    }
    try { return await fetchFromSlugSearch(resolved) } catch { return null }
  }

  // Item regular MLB
  try {
    return await fetchFromItemsApi(productId)
  } catch (e) {
    const axErr = e as import('axios').AxiosError
    console.log(`[ml] items API falhou: ${axErr.message} | body: ${JSON.stringify(axErr.response?.data)}`)
    try { return await fetchFromSlugSearch(resolved) } catch { return null }
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

export function buildMLSearchUrl(title: string): string {
  return 'https://www.mercadolivre.com.br/jm/search?as_word=' + encodeURIComponent(title) + '&matt_tool=' + PUBLISHER_ID + '&matt_word=' + MATT_WORD
}

export async function fetchMLDealsByKeyword(keyword: string, limit = 10): Promise<MLDeal[]> {
  try {
    const { data } = await axios.get(`${ML_API}/sites/MLB/search`, {
      params: { q: keyword, sort: 'relevance', limit },
      headers: await mlHeaders(),
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
