import axios from 'axios'

const PUBLISHER_ID = process.env.ML_PUBLISHER_ID
const MATT_WORD = process.env.ML_MATT_WORD
if (!PUBLISHER_ID || !MATT_WORD) {
  console.warn('[ml] ML_PUBLISHER_ID or ML_MATT_WORD not set — affiliate tags will be omitted')
}

const ML_API = 'https://api.mercadolibre.com'

// OAuth app token — necessário apenas para endpoints privados (ex: /items/{id}/prices)
let cachedToken: { token: string; expiresAt: number } | null = null
let tokenPromise: Promise<string | null> | null = null

async function fetchToken(): Promise<string | null> {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

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

async function getAppToken(): Promise<string | null> {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  if (cachedToken && Date.now() < cachedToken.expiresAt - 300_000) {
    return cachedToken.token
  }

  // In-flight promise lock: prevents thundering herd when token is expired
  // and multiple concurrent callers arrive simultaneously.
  if (!tokenPromise) {
    tokenPromise = fetchToken().finally(() => { tokenPromise = null })
  }
  return tokenPromise
}

// Endpoints públicos NÃO precisam de Authorization — injetar Bearer causa 403 PolicyAgent
// User-Agent é necessário — sem ele o search retorna 403
const ML_PUBLIC_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

export async function mlAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAppToken()
  if (!token) return ML_PUBLIC_HEADERS
  return { ...ML_PUBLIC_HEADERS, Authorization: `Bearer ${token}` }
}

export interface MLProductInfo {
  id: string
  name: string
  price: string
  originalPrice?: string
  imageUrl: string
  permalink: string
}

// Extrai ID do produto. Prioriza item_id explícito nos query params (presente em URLs de catálogo
// compartilhadas via app — pdp_filters=item_id:MLB...) sobre o ID do path.
function extractMLProductId(url: string): string | null {
  try {
    const parsed = new URL(url)

    // pdp_filters=item_id:MLB4680610597 — presente em links MLBU compartilhados
    const pdpFilters = parsed.searchParams.get('pdp_filters') ?? ''
    const filterMatch = pdpFilters.match(/item_id:(MLB\d+)/i)
    if (filterMatch) return filterMatch[1].toUpperCase()

    // wid=MLB... presente no fragment (#...&wid=MLB...)
    const fragment = parsed.hash.slice(1)
    const widMatch = new URLSearchParams(fragment).get('wid')
    if (widMatch && /^MLB\d+$/i.test(widMatch)) return widMatch.toUpperCase()
  } catch { /* URL inválida */ }

  // Fallback: primeiro ID MLB/MLBU no texto da URL
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

export async function resolveMLShortLink(url: string): Promise<string> {
  if (!url.includes('meli.la') && !url.includes('ml.bz')) return url
  const resolved = await expandShortLink(url)
  if (!isMLProductUrl(resolved)) {
    const productUrl = await resolveMLSocialToProduct(resolved)
    if (productUrl) return productUrl
  }
  return resolved
}

export async function injectMLTag(url: string): Promise<string> {
  if (!PUBLISHER_ID || !MATT_WORD) return url
  try {
    let resolved = url
    if (url.includes('meli.la') || url.includes('ml.bz')) {
      resolved = await expandShortLink(url)
    }
    const parsed = new URL(resolved)
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
  const pictures = data.pictures as { url?: string; secure_url?: string }[] | undefined
  if (pictures?.length) {
    const pic = pictures[0]
    const raw = (pic.secure_url ?? pic.url ?? '') as string
    return raw.replace('http://', 'https://')
  }
  const thumb = ((data.thumbnail as string) ?? '').replace('http://', 'https://')
  return thumb.replace(/-I\.(jpg|webp)$/i, '-O.$1')
}

async function fetchFromItemsApi(itemId: string): Promise<MLProductInfo | null> {
  const { data } = await axios.get(`${ML_API}/items/${itemId}`, {
    headers: ML_PUBLIC_HEADERS,
    timeout: 10000,
  })
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

async function fetchFromCatalogProduct(catalogId: string, originalUrl: string): Promise<MLProductInfo | null> {
  console.log(`[ml] catalog_products → ${catalogId}`)
  const { data } = await axios.get(`${ML_API}/catalog_products/${catalogId}`, {
    headers: ML_PUBLIC_HEADERS,
    timeout: 10000,
  })

  const name = (data.name as string ?? '').slice(0, 80)
  const pictures = data.pictures as { url?: string; secure_url?: string }[] | undefined
  const imageUrl = pictures?.[0]
    ? ((pictures[0].secure_url ?? pictures[0].url ?? '') as string).replace('http://', 'https://')
    : ''

  if (!name || !imageUrl) return null

  // Busca preço via search por keyword do nome do catálogo
  let price = ''
  let originalPrice: string | undefined
  try {
    const { data: sr } = await axios.get(`${ML_API}/sites/MLB/search`, {
      params: { q: name, limit: 1 },
      headers: ML_PUBLIC_HEADERS,
      timeout: 8000,
    })
    const first = (sr.results as MLSearchItem[] | undefined)?.[0]
    if (first) {
      price = `R$${first.price.toFixed(2).replace('.', ',')}`
      originalPrice = first.original_price ? `R$${first.original_price.toFixed(2).replace('.', ',')}` : undefined
      console.log(`[ml] catalog_products ok: "${name}" | ${price} | img: ${imageUrl.slice(0, 60)}`)
    }
  } catch (e) {
    console.log(`[ml] price search falhou: ${(e as Error).message}`)
  }

  return { id: catalogId, name, price: price || '—', originalPrice, imageUrl, permalink: originalUrl }
}

async function fetchFromCatalogSearch(catalogId: string, originalUrl: string): Promise<MLProductInfo | null> {
  console.log(`[ml] catalog search → catalog_product_id=${catalogId}`)
  const { data } = await axios.get(`${ML_API}/sites/MLB/search`, {
    params: { catalog_product_id: catalogId, limit: 1 },
    headers: ML_PUBLIC_HEADERS,
    timeout: 10000,
  })

  const item = (data.results as MLSearchItem[] | undefined)?.[0]
  if (!item) {
    console.log(`[ml] catalog search sem resultados para ${catalogId}`)
    return null
  }

  const imageUrl = (item.thumbnail ?? '').replace('http://', 'https://').replace(/-I\.(jpg|webp)$/i, '-O.$1')
  console.log(`[ml] catalog search result: "${item.title}" | R$${item.price} | img: ${imageUrl}`)

  return {
    id: item.id,
    name: item.title.slice(0, 80),
    price: `R$${item.price.toFixed(2).replace('.', ',')}`,
    originalPrice: item.original_price ? `R$${item.original_price.toFixed(2).replace('.', ',')}` : undefined,
    imageUrl,
    permalink: originalUrl,
  }
}

async function fetchFromSlugSearch(url: string): Promise<MLProductInfo | null> {
  const slug = url.match(/mercadolivre\.com\.br\/([^/?#]+)/)?.[1] ?? ''
  if (!slug) return null

  const keywords = slug.replace(/-/g, ' ').split(' ').slice(0, 6).join(' ')
  console.log(`[ml] slug search → "${keywords}"`)

  let data: Record<string, unknown>
  try {
    const r = await axios.get(`${ML_API}/sites/MLB/search`, {
      params: { q: keywords, limit: 1 },
      headers: ML_PUBLIC_HEADERS,
      timeout: 10000,
    })
    data = r.data
  } catch (e) {
    const axErr = e as import('axios').AxiosError
    console.log(`[ml] slug search falhou: ${axErr.response?.status} | body: ${JSON.stringify(axErr.response?.data)}`)
    return null
  }

  const item = (data.results as MLSearchItem[] | undefined)?.[0]
  if (!item) { console.log('[ml] slug search: sem resultados'); return null }

  const imageUrl = (item.thumbnail ?? '').replace('http://', 'https://').replace(/-I\.(jpg|webp)$/i, '-O.$1')
  if (!imageUrl) return null

  console.log(`[ml] slug result: "${item.title}" | R$${item.price} | img: ${imageUrl}`)

  const affiliateUrl = await injectMLTag(item.permalink)
  return {
    id: item.id,
    name: item.title.slice(0, 80),
    price: `R$${item.price.toFixed(2).replace('.', ',')}`,
    originalPrice: item.original_price ? `R$${item.original_price.toFixed(2).replace('.', ',')}` : undefined,
    imageUrl,
    permalink: affiliateUrl,
  }
}

const ML_NON_PRODUCT_PATHS = ['/social/', '/perfil/', '/vendedor/', '/loja/', '/ajuda/', '/noindex/']

function isMLProductUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return !ML_NON_PRODUCT_PATHS.some(p => path.startsWith(p))
  } catch { return false }
}

// Playwright removed — social links cannot be resolved without a headless browser
async function resolveMLSocialToProduct(_socialUrl: string): Promise<string | null> {
  console.log('[ml:social] resolução via navegador removida — retornando null')
  return null
}

export async function fetchMLProductInfo(url: string): Promise<MLProductInfo | null> {
  let resolved = url
  if (url.includes('meli.la') || url.includes('ml.bz')) {
    resolved = await expandShortLink(url)
  }

  if (!isMLProductUrl(resolved)) {
    if (url.includes('meli.la') || url.includes('ml.bz')) {
      console.log(`[ml] link curto resolveu para página não-produto, tentando extrair produto da página social: ${resolved.slice(0, 80)}`)
      const productUrl = await resolveMLSocialToProduct(resolved)
      if (productUrl) {
        resolved = productUrl
      } else {
        return null
      }
    } else {
      console.log(`[ml] URL não é de produto: ${resolved.slice(0, 80)}`)
      return null
    }
  }

  const productId = extractMLProductId(resolved)
  console.log(`[ml] productId extraído: ${productId ?? 'NENHUM'} de ${resolved.slice(0, 80)}`)

  if (!productId) {
    try { return await fetchFromSlugSearch(resolved) } catch { return null }
  }

  if (isCatalogId(productId)) {
    // MLBU: catalog_products endpoint → catalog search → slug search
    try {
      const result = await fetchFromCatalogProduct(productId, resolved)
      if (result) return result
    } catch (e) {
      const axErr = e as import('axios').AxiosError
      console.log(`[ml] catalog_products falhou: ${axErr.response?.status} | body: ${JSON.stringify(axErr.response?.data)}`)
    }
    try {
      const result = await fetchFromCatalogSearch(productId, resolved)
      if (result) return result
    } catch (e) {
      const axErr = e as import('axios').AxiosError
      console.log(`[ml] catalog search falhou: ${axErr.response?.status} | body: ${JSON.stringify(axErr.response?.data)}`)
    }
    return await fetchFromSlugSearch(resolved)
  }

  // Item regular MLB: items API → slug search
  try {
    return await fetchFromItemsApi(productId)
  } catch (e) {
    const axErr = e as import('axios').AxiosError
    console.log(`[ml] items API falhou: ${axErr.message} | body: ${JSON.stringify(axErr.response?.data)}`)
    try { return await fetchFromSlugSearch(resolved) } catch { return null }
  }
}

// ── Busca de deals por keyword ────────────────────────────────────────────────

interface MLSearchItem {
  id: string
  title: string
  price: number
  original_price: number | null
  thumbnail: string
  permalink: string
  seller: { nickname: string }
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
  const base = 'https://www.mercadolivre.com.br/jm/search?as_word=' + encodeURIComponent(title)
  if (!PUBLISHER_ID || !MATT_WORD) return base
  return base + '&matt_tool=' + PUBLISHER_ID + '&matt_word=' + MATT_WORD
}

import type { AffiliateLinkBuilder } from '../../core/ports/AffiliateLinkBuilder.js'
import type { Deal, Marketplace } from '../../core/domain/Deal.js'
import type { AffiliateConfig } from '../../core/domain/Tenant.js'

export class MLAffiliateLinkBuilder implements AffiliateLinkBuilder {
  supports(marketplace: Marketplace): boolean {
    return marketplace === 'mercadolivre'
  }

  async build(deal: Deal, _config: AffiliateConfig): Promise<Deal> {
    const url = await injectMLTag(deal.url)
    return { ...deal, url }
  }
}

export async function fetchMLDealsByKeyword(keyword: string, limit = 10): Promise<MLDeal[]> {
  console.log(`[ml:deals] buscando "${keyword}" (limit=${limit})`)
  try {
    const { data } = await axios.get(`${ML_API}/sites/MLB/search`, {
      params: { q: keyword, sort: 'relevance', limit },
      headers: ML_PUBLIC_HEADERS,
      timeout: 10000,
    })

    const total = (data.results as MLSearchItem[] | undefined)?.length ?? 0
    console.log(`[ml:deals] "${keyword}" → ${total} resultados brutos`)

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

    console.log(`[ml:deals] "${keyword}" → ${results.length} com desconto ≥10%`)
    return results
  } catch (e) {
    const axErr = e as import('axios').AxiosError
    console.log(`[ml:deals] "${keyword}" falhou: ${axErr.response?.status ?? axErr.message} | body: ${JSON.stringify(axErr.response?.data)}`)
    return []
  }
}
