import axios from 'axios'
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { injectAmazonTag } from '../affiliates/AmazonAffiliate.js'
import { buildMLSearchUrl, injectMLTag, fetchMLProductInfo } from '../affiliates/MLAffiliate.js'
import { generateAffiliateLink, expandShortLink, fetchShopeeProductByUrl, type SubIds } from '../affiliates/ShopeeAffiliate.js'
import type { DealScraper } from '../../core/ports/DealScraper.js'
import type { Deal, Marketplace } from '../../core/domain/Deal.js'

chromium.use(StealthPlugin())

function upgradeAmazonImageSize(url: string): string {
  // Only upgrade clearly small/thumbnail modifiers (SS = square-small, SY/SX = fixed small dimensions)
  // Use _SL1500_ (long side 1500px) which is the standard Amazon CDN large size
  return url.replace(/\._(?:AC_)?(?:SS\d+|SY\d+_?(?:SX\d+_?)?(?:QL\d+_?)?(?:ML\d+_?)?)_\.(jpg|png|webp)$/i, '._SL1500_.$1')
}

async function fetchAmazonImage(amazonUrl: string): Promise<string | null> {
  try {
    const res = await axios.get<string>(amazonUrl, {
      timeout: 12000,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.google.com.br/',
      },
      maxRedirects: 5,
      validateStatus: () => true,
    })
    const html = res.data as string
    // Try hiRes image data embedded in page JSON (largest quality)
    const hiRes = html.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+m\.media-amazon\.com[^"]+)"/)?.[1]
    if (hiRes) return upgradeAmazonImageSize(hiRes)
    // Try landingImage (main product image)
    const landing = html.match(/"large"\s*:\s*"(https:\/\/[^"]+m\.media-amazon\.com[^"]+)"/)?.[1]
    if (landing) return upgradeAmazonImageSize(landing)
    // Try og:image meta tag
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
               html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
    if (og?.includes('m.media-amazon.com') || og?.includes('ssl-images-amazon.com')) return upgradeAmazonImageSize(og)
    // Fallback: any media-amazon CDN URL in the page
    const cdnMatch = html.match(/https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9%_+\-]+\._[^"'\s<>]+\.jpg/)
    return cdnMatch ? upgradeAmazonImageSize(cdnMatch[0]) : null
  } catch {
    return null
  }
}

interface PelandoAmazonResult {
  amazonUrl: string | null
  imageUrl: string | null
}

async function resolveAmazonFromPelandoPage(dealUrl: string): Promise<PelandoAmazonResult> {
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
  }

  let html = ''
  try {
    const res = await axios.get<string>(dealUrl, {
      timeout: 12000,
      responseType: 'text',
      headers: HEADERS,
      maxRedirects: 5,
      validateStatus: () => true,
    })
    html = res.data as string
  } catch (e) {
    console.log(`[pelando:amazon] axios falhou para ${dealUrl}: ${(e as Error).message}`)
    return { amazonUrl: null, imageUrl: null }
  }

  // Look for Amazon product CDN image URL embedded in the page HTML
  // These look like: https://m.media-amazon.com/images/I/XXXXX._AC_SL500_.jpg
  const amazonImageCandidates = [...html.matchAll(
    /https?:\/\/(?:m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)\/images\/I\/[^"'\s<>\\]+/g
  )]
  const amazonImage = amazonImageCandidates
    .map(m => m[0].split('\\')[0])  // trim JSON escape artifacts
    .find(u => /\.(jpg|jpeg|png|webp)/i.test(u) && !u.includes('sprite') && !u.includes('logo') && !u.includes('transparent'))
    ?? null
  console.log(`[pelando:amazon] imagem produto: ${amazonImage?.slice(0, 80) ?? 'null (buscará no Amazon)'}`)

  // Resolve Amazon store URL — try __NEXT_DATA__ first
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1])
      const json = JSON.stringify(nextData)
      const amazonMatches = [...json.matchAll(/https?:\/\/(?:www\.)?amazon\.com\.br\/[^"\\]{15,}/g)]
      const withDp = amazonMatches.find(m => /\/dp\/[A-Z0-9]{10}/i.test(m[0]))
      if (withDp) return { amazonUrl: withDp[0].split('"')[0], imageUrl: amazonImage }
      if (amazonMatches[0]) return { amazonUrl: amazonMatches[0][0].split('"')[0], imageUrl: amazonImage }
    } catch { /* fall through */ }
  }
  console.log(`[pelando:amazon] __NEXT_DATA__ não encontrou Amazon URL em ${dealUrl}`)

  const decoded = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&')

  // Direct Amazon URL in decoded HTML
  const directMatch = decoded.match(/https?:\/\/(?:www\.)?amazon\.com\.br\/[^"'\s<>]{15,}/)
  if (directMatch && /\/dp\/[A-Z0-9]{10}/i.test(directMatch[0])) {
    return { amazonUrl: directMatch[0], imageUrl: amazonImage }
  }

  // Follow Pelando redirect link (/r/...)
  const redirectMatch = decoded.match(/href="((?:https?:\/\/www\.pelando\.com\.br)?\/r\/[^"]{4,})"/)
  if (redirectMatch) {
    const redirectHref = redirectMatch[1].startsWith('http')
      ? redirectMatch[1]
      : `https://www.pelando.com.br${redirectMatch[1]}`
    console.log(`[pelando:amazon] seguindo redirect: ${redirectHref}`)
    try {
      const res2 = await axios.get<string>(redirectHref, {
        maxRedirects: 10,
        timeout: 10000,
        responseType: 'text',
        headers: { ...HEADERS, 'Referer': 'https://www.pelando.com.br/' },
        validateStatus: () => true,
      })
      const finalUrl: string = (res2.request as { res?: { responseUrl?: string } }).res?.responseUrl ?? redirectHref
      console.log(`[pelando:amazon] final após redirect: ${finalUrl.slice(0, 80)}`)
      if (finalUrl.includes('amazon.com.br') || finalUrl.includes('amzn.to')) {
        return { amazonUrl: finalUrl, imageUrl: amazonImage }
      }
    } catch (e2) {
      console.log(`[pelando:amazon] redirect falhou: ${(e2 as Error).message}`)
    }
  }

  return { amazonUrl: null, imageUrl: amazonImage }
}

async function resolveAmazonUrlFromPelando(pelUrl: string): Promise<string | null> {
  try {
    const res = await axios.get<string>(pelUrl, {
      maxRedirects: 5,
      timeout: 10000,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      validateStatus: () => true,
    })
    const finalUrl: string = (res.request as { res?: { responseUrl?: string } }).res?.responseUrl ?? pelUrl
    if (finalUrl.includes('amazon.com.br') || finalUrl.includes('amzn.to')) return finalUrl

    const html = res.data as string
    // Decode HTML entities so &quot; becomes " and the URL boundary is correct
    const decoded = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    // Only match Amazon URLs with a real product path (contains ASIN or /dp/ or amzn.to)
    const matches = decoded.match(/https?:\/\/(?:www\.amazon\.com\.br|amzn\.to)\/[^"'\s<>\\]{10,}/gi) ?? []
    const productUrl = matches.find(u => /\/dp\/[A-Z0-9]{10}|\/gp\/product\/[A-Z0-9]{10}|amzn\.to\//i.test(u))
    return productUrl ?? null
  } catch {
    return null
  }
}

async function resolveMLFromPelandoPage(dealUrl: string): Promise<string | null> {
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
  }

  let html = ''
  try {
    const res = await axios.get<string>(dealUrl, {
      timeout: 12000,
      responseType: 'text',
      headers: HEADERS,
      maxRedirects: 5,
      validateStatus: () => true,
    })
    html = res.data as string
  } catch (e) {
    console.log(`[pelando:ml] axios falhou para ${dealUrl}: ${(e as Error).message}`)
    return null
  }

  // Try __NEXT_DATA__ — most reliable source
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (nextDataMatch) {
    try {
      const json = JSON.stringify(JSON.parse(nextDataMatch[1]))
      const mlMatches = [...json.matchAll(/https?:\/\/(?:www\.)?mercadolivre\.com\.br\/[^"\\]{15,}/g)]
      const withProduct = mlMatches.find(m => /\/p\/MLB|MLB[A-Z]?\d{6,}|item_id.*MLB/i.test(m[0]))
      if (withProduct) return withProduct[0].split('"')[0]
      if (mlMatches[0]) return mlMatches[0][0].split('"')[0]
    } catch { /* fall through */ }
  }

  const decoded = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&')

  // Direct ML URL in decoded HTML
  const directMatch = decoded.match(/https?:\/\/(?:www\.)?mercadolivre\.com\.br\/[^"'\s<>]{15,}/)
  if (directMatch) return directMatch[0]

  // Follow Pelando redirect link (/r/...)
  const redirectMatch = decoded.match(/href="((?:https?:\/\/www\.pelando\.com\.br)?\/r\/[^"]{4,})"/)
  if (redirectMatch) {
    const redirectHref = redirectMatch[1].startsWith('http')
      ? redirectMatch[1]
      : `https://www.pelando.com.br${redirectMatch[1]}`
    try {
      const res2 = await axios.get<string>(redirectHref, {
        maxRedirects: 10,
        timeout: 10000,
        responseType: 'text',
        headers: { ...HEADERS, Referer: 'https://www.pelando.com.br/' },
        validateStatus: () => true,
      })
      const finalUrl: string = (res2.request as { res?: { responseUrl?: string } }).res?.responseUrl ?? redirectHref
      if (finalUrl.includes('mercadolivre.com.br') || finalUrl.includes('mercadolibre.com')) {
        console.log(`[pelando:ml] redirect resolveu: ${finalUrl.slice(0, 80)}`)
        return finalUrl
      }
    } catch (e2) {
      console.log(`[pelando:ml] redirect falhou: ${(e2 as Error).message}`)
    }
  }

  return null
}

async function resolveShopeeFromPelandoPage(dealUrl: string): Promise<string | null> {
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Cache-Control': 'no-cache',
  }

  let html = ''
  try {
    const res = await axios.get<string>(dealUrl, {
      timeout: 12000, responseType: 'text', headers: HEADERS,
      maxRedirects: 5, validateStatus: () => true,
    })
    html = res.data as string
  } catch (e) {
    console.log(`[pelando:shopee] axios falhou para ${dealUrl}: ${(e as Error).message}`)
    return null
  }

  // Try __NEXT_DATA__ first
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (nextDataMatch) {
    try {
      const json = JSON.stringify(JSON.parse(nextDataMatch[1]))
      const matches = [...json.matchAll(/https?:\/\/(?:shopee\.com\.br|s\.shopee\.com\.br|shp\.ee)[^"\\]{5,}/g)]
      if (matches[0]) return matches[0][0].split('"')[0]
    } catch { /* fall through */ }
  }

  const decoded = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  const direct = decoded.match(/https?:\/\/(?:shopee\.com\.br|s\.shopee\.com\.br|shp\.ee)[^"'\s<>]{5,}/)
  if (direct) return direct[0]

  // Follow Pelando redirect
  const redirectMatch = decoded.match(/href="((?:https?:\/\/www\.pelando\.com\.br)?\/r\/[^"]{4,})"/)
  if (redirectMatch) {
    const redirectHref = redirectMatch[1].startsWith('http')
      ? redirectMatch[1]
      : `https://www.pelando.com.br${redirectMatch[1]}`
    try {
      const res2 = await axios.get<string>(redirectHref, {
        maxRedirects: 10, timeout: 10000, responseType: 'text',
        headers: { ...HEADERS, Referer: 'https://www.pelando.com.br/' },
        validateStatus: () => true,
      })
      const finalUrl: string = (res2.request as { res?: { responseUrl?: string } }).res?.responseUrl ?? redirectHref
      if (finalUrl.includes('shopee.com.br') || finalUrl.includes('shp.ee')) {
        console.log(`[pelando:shopee] redirect resolveu: ${finalUrl.slice(0, 80)}`)
        return finalUrl
      }
    } catch (e2) {
      console.log(`[pelando:shopee] redirect falhou: ${(e2 as Error).message}`)
    }
  }

  return null
}

interface CouponPageResult {
  couponCode: string | null
  fullTitle: string | null
  cloudflareBlocked?: boolean
}

async function resolveCouponCodeFromPelandoPage(dealUrl: string): Promise<CouponPageResult> {
  // Detail pages don't require FlareSolverr — plain axios works even on datacenter IPs
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Cache-Control': 'no-cache',
  }
  let html = ''
  try {
    const res = await axios.get<string>(dealUrl, {
      timeout: 12000, responseType: 'text', headers: HEADERS,
      maxRedirects: 5, validateStatus: () => true,
    })
    html = res.data as string
  } catch (e) {
    console.log(`[pelando:cupom] falhou para ${dealUrl}: ${(e as Error).message}`)
    return { couponCode: null, fullTitle: null }
  }

  // Extract full title — try og:title, then <title>, then <h1>
  const ogTitle =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"'<]+)["']/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"'<]+)["'][^>]+property=["']og:title["']/i)?.[1] ||
    null
  const pageTitle = html.match(/<title[^>]*>([^<]{10,})<\/title>/i)?.[1] || null
  const h1Title = html.match(/<h1[^>]*>([^<]{10,})<\/h1>/i)?.[1] || null
  const rawTitle = ogTitle || pageTitle || h1Title || null
  const fullTitle = rawTitle ? rawTitle.replace(/\s*[-|]\s*[Pp]elando.*$/i, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() : null
  console.log(`[pelando:cupom] título detalhe: ${fullTitle ?? '(não encontrado)'}`)

  // Cloudflare blocked the detail page — signal caller to skip this deal
  if (fullTitle && /^just a moment|^um momento|attention required/i.test(fullTitle)) {
    return { couponCode: null, fullTitle: null, cloudflareBlocked: true }
  }

  // Pelando uses Astro — deal data is serialized as HTML-encoded JSON in the page
  // Pattern: &quot;couponCode&quot;:[0,&quot;CORREOFF&quot;]
  const astroJson = html.match(/&quot;couponCode&quot;:\[0,&quot;([A-Z0-9]{2,25})&quot;\]/i)
  if (astroJson) {
    console.log(`[pelando:cupom] página detalhe: couponCode JSON = "${astroJson[1]}"`)
    return { couponCode: astroJson[1].toUpperCase(), fullTitle }
  }

  // Fallback 1: <span class="code" ...>CORREOFF</span>
  const spanCode = html.match(/<span\s+class="code"[^>]*>([A-Z0-9]{2,25})<\/span>/i)
  if (spanCode) {
    console.log(`[pelando:cupom] página detalhe: span.code = "${spanCode[1]}"`)
    return { couponCode: spanCode[1].toUpperCase(), fullTitle }
  }

  // Fallback 2: data-code="CORREOFF" on copy button
  const dataCode = html.match(/data-code="([A-Z0-9]{2,25})"/i)
  if (dataCode) {
    console.log(`[pelando:cupom] página detalhe: data-code = "${dataCode[1]}"`)
    return { couponCode: dataCode[1].toUpperCase(), fullTitle }
  }

  console.log(`[pelando:cupom] página detalhe: código não encontrado em ${dealUrl}`)
  return { couponCode: null, fullTitle }
}

// Astro serializes props as [type, value] tuples: [0, scalar] | [1, array]
function decodeAstro(v: unknown): unknown {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') {
    const [type, val] = v as [number, unknown]
    if (type === 0) return decodeAstro(val)
    if (type === 1 && Array.isArray(val)) return (val as unknown[]).map(decodeAstro)
  }
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, vv]) => [k, decodeAstro(vv)])
    )
  }
  return v
}

interface PelandoRawDeal {
  id: string
  slug: string
  title: string
  temperature: number
  price: number | null
  discountPercentage: number | null
  discountFixed: number | null
  status: string
  createdAt: string
  couponCode?: string | null
  sourceUrl?: string | null
  imageUrl?: string | null
  imageSrcset?: { url: string; width: number }[]
  store: { name: string; slug: string }
}

const LISTING_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Cache-Control': 'no-cache',
}

async function fetchCategoryPage(categoryUrl: string): Promise<PelandoRawDeal[]> {
  const category = categoryUrl.split('/').pop()!
  const rawFlareUrl = process.env.FLARESOLVERR_URL?.trim()
  const flaresolverrUrl = rawFlareUrl && !rawFlareUrl.startsWith('http') ? `https://${rawFlareUrl}` : rawFlareUrl

  let html = ''

  let flaresolverrFailed = false
  if (flaresolverrUrl) {
    try {
      console.log(`[pelando] ${category}: usando FlareSolverr`)
      const res = await axios.post<{ solution: { response: string; status: number } }>(
        `${flaresolverrUrl}/v1`,
        { cmd: 'request.get', url: categoryUrl, maxTimeout: 60000 },
        { timeout: 70000, headers: { 'Content-Type': 'application/json' } }
      )
      if (res.data.solution.status !== 200) {
        console.log(`[pelando] ${category}: FlareSolverr status ${res.data.solution.status} — tentando Playwright`)
        flaresolverrFailed = true
      } else {
        html = res.data.solution.response
      }
    } catch (e) {
      console.log(`[pelando] ${category}: FlareSolverr erro — ${(e as Error).message} — tentando Playwright`)
      flaresolverrFailed = true
    }
  }

  if (!flaresolverrUrl || flaresolverrFailed) {
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    try {
      console.log(`[pelando] ${category}: usando Playwright`)
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      })
      const context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'pt-BR',
        extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
      })
      const page = await context.newPage()
      await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      const title = await page.title()
      if (/just a moment|um momento|attention required/i.test(title)) {
        console.log(`[pelando] ${category}: Cloudflare challenge ativo, aguardando resolução...`)
        try {
          await page.waitForFunction(
            () => !document.title.match(/just a moment|um momento|attention required/i),
            { timeout: 12000 }
          )
        } catch {
          console.log(`[pelando] ${category}: challenge não resolvido em 12s`)
        }
      }
      html = await page.content()
    } catch (e) {
      console.log(`[pelando] ${category}: Playwright erro — ${(e as Error).message}`)
      return []
    } finally {
      await browser?.close()
    }
  }

  if (/just a moment|um momento|attention required/i.test(html.slice(0, 3000))) {
    console.log(`[pelando] ${category}: bloqueado por Cloudflare`)
    return []
  }

  const propsMatch = html.match(/component-url="[^"]*CommunityFeedContent[^"]*"[^>]*props="([^"]+)"/)
  if (!propsMatch) {
    console.log(`[pelando] ${category}: props não encontrado na página`)
    return []
  }

  const jsonStr = propsMatch[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")

  try {
    const decoded = decodeAstro(JSON.parse(jsonStr)) as { initialDeals?: PelandoRawDeal[] }
    const deals = decoded.initialDeals ?? []
    console.log(`[pelando] ${category}: ${deals.length} deals encontrados`)
    return deals
  } catch (e) {
    console.log(`[pelando] ${category}: erro ao parsear props — ${(e as Error).message}`)
    return []
  }
}

export interface PelandoDeal {
  id: string
  title: string
  price: string
  originalPrice?: string
  store: string
  dealUrl: string
  imageUrl: string
  temperature: number
  publishedAt: string
  couponCode: string   // empty string if not a coupon deal
}

function getBestPelandoImage(item: PelandoRawDeal): string {
  if (item.imageSrcset?.length) {
    const largest = item.imageSrcset.reduce((a, b) => b.width > a.width ? b : a)
    return largest.url
  }
  return item.imageUrl ?? ''
}

// Pelando category pages for the maternity/home niche
const CATEGORIES = [
  'https://www.pelando.com.br/c/para-minha-familia', // Família, filhos e pets
  'https://www.pelando.com.br/c/para-meu-lar',       // Para meu lar
]

const MIN_TEMPERATURE = 20

export const TOPIC_KEYWORDS: string[] = [
  // Bebê / maternidade
  'fralda', 'bebê', 'bebe', 'infantil', 'maternidade',
  'berço', 'berco', 'carrinho', 'mamadeira', 'chupeta', 'enxoval',
  'lenço umedecido', 'lenco umedecido', 'pomada assadura',
  // Cozinha — eletrodomésticos
  'panela', 'frigideira', 'airfryer', 'air fryer', 'cafeteira',
  'batedeira', 'chaleira', 'liquidificador', 'escorredor',
  'sorveteira', 'panificadora', 'sanduicheira', 'torradeira',
  'espremedor', 'processador', 'fritadeira', 'grill', 'waffle',
  'micro-ondas', 'forno elétrico', 'forno eletrico',
  // Cozinha — utensílios e recipientes
  'faca', 'tábua', 'tabua', 'tigela', 'pote',
  'caneca', 'garrafa', 'copo', 'xícara', 'xicara', 'jarra',
  'galão', 'galao', 'dispenser', 'porta-filtro', 'coador',
  'talheres', 'forma', 'assadeira', 'refratário', 'refratario',
  // Limpeza
  'sabão', 'sabao', 'detergente', 'desinfetante', 'amaciante',
  'esponja', 'mop', 'limpador', 'multiuso', 'vassoura', 'rodo',
  // Beleza / higiene
  'shampoo', 'condicionador', 'creme', 'hidratante', 'sabonete',
  'maquiagem', 'perfume', 'esmalte', 'absorvente', 'protetor solar',
  'desodorante',
  // Casa / organização
  'tapete', 'cortina', 'toalha', 'cesto', 'organizador', 'almofada',
  'jogo de cama', 'edredom', 'prateleira', 'cabide', 'quadro decorativo',
  // Pet
  'ração', 'racao', 'coleira', 'arranhador',
  // Brinquedos
  'brinquedo', 'pelúcia', 'pelucia', 'boneca', 'quebra-cabeça',
]

export function isRelevantForNiche(title: string): boolean {
  const lower = title.toLowerCase()
  return TOPIC_KEYWORDS.some(kw => lower.includes(kw))
}

const ALLOWED_STORES: string[] = ['amazon', 'mercado livre', 'mercadolivre', 'ml', 'shopee']

export async function fetchDeals(): Promise<PelandoDeal[]> {
  const allDeals: PelandoDeal[] = []
  const seen = new Set<string>()
  const rawFlareUrl = process.env.FLARESOLVERR_URL?.trim()
  const flaresolverrUrl = rawFlareUrl && !rawFlareUrl.startsWith('http') ? `https://${rawFlareUrl}` : rawFlareUrl

  for (const categoryUrl of CATEGORIES) {
    try {
      const items = await fetchCategoryPage(categoryUrl)
      const now = new Date().toISOString()
      const storesSeen = items.map(i => i.store?.name || '?')
      console.log(`[pelando] ${categoryUrl.split('/').pop()} — ${items.length} deals, lojas: ${[...new Set(storesSeen)].join(', ')}`)

      for (const item of items) {
        if (!item.title || !item.slug) continue
        if (item.temperature < MIN_TEMPERATURE) continue
        if (item.status === 'expired') continue

        const dealPageUrl = `https://www.pelando.com.br/d/${item.slug}`
        if (seen.has(dealPageUrl)) continue

        const storeName = item.store?.name ?? ''
        const isCouponDeal = !!(item.couponCode && item.couponCode.length > 0)
        const isCouponPrice = item.discountPercentage !== null || item.discountFixed !== null

        // Coupon deal — code from props or fallback to detail page
        if (isCouponPrice || isCouponDeal) {
          // Deals that never have a public coupon code
          if (/só no app|somente no app|only in app|\bprime\b/i.test(item.title)) {
            seen.add(dealPageUrl)
            continue
          }
          let couponCode = item.couponCode ?? ''
          let dealTitle = item.title
          if (!couponCode) {
            console.log(`[pelando:cupom] sem código nos props, buscando na página: ${item.title.slice(0, 60)}`)
            const result = await resolveCouponCodeFromPelandoPage(dealPageUrl)
            couponCode = result.couponCode ?? ''
            if (result.fullTitle && result.fullTitle.length > dealTitle.length) dealTitle = result.fullTitle
            if (result.cloudflareBlocked) { seen.add(dealPageUrl); continue }
          }
          if (!couponCode) continue  // retry next cycle
          seen.add(dealPageUrl)
          console.log(`[pelando:cupom] ✓ ${couponCode} — ${storeName} — ${formatPriceFromProps(item)}`)
          allDeals.push({
            id: dealPageUrl,
            title: dealTitle,
            price: formatPriceFromProps(item),
            store: storeName,
            dealUrl: dealPageUrl,
            imageUrl: '',
            temperature: item.temperature,
            publishedAt: now,
            couponCode,
          })
          continue
        }

        seen.add(dealPageUrl)

        // Niche relevance gate — keeps only products for the housewife niche
        if (!isRelevantForNiche(item.title)) {
          console.log(`[pelando:filter] fora do nicho, ignorado: ${item.title.slice(0, 60)}`)
          continue
        }

        // Regular deal: apply store filter
        if (ALLOWED_STORES.length > 0) {
          const storeLower = storeName.toLowerCase()
          if (!ALLOWED_STORES.some(s => storeLower.includes(s))) continue
        }

        const storeLower = storeName.toLowerCase()
        const isAmazonDeal = storeLower.includes('amazon')
        const isMLDeal = storeLower.includes('mercado') || storeLower.includes('mercadolivre') || storeLower === 'ml'
        let dealUrl = dealPageUrl
        let imageUrl = ''
        let shopeeOriginalPrice: string | undefined

        // sourceUrl comes directly from the category page Astro props — no detail page fetch needed
        const sourceUrl = item.sourceUrl ?? null
        imageUrl = getBestPelandoImage(item)

        if (isAmazonDeal) {
          if (!sourceUrl?.includes('amazon.com.br')) {
            console.log(`[pelando:amazon] sem sourceUrl para: ${item.title.slice(0, 50)}`)
            continue
          }
          console.log(`[pelando:amazon] ✓ ${sourceUrl.slice(0, 80)}`)
          dealUrl = await injectAmazonTag(sourceUrl)
          const amazonImage = await fetchAmazonImage(dealUrl)
          if (amazonImage) imageUrl = amazonImage
        } else if (isMLDeal) {
          if (sourceUrl?.includes('mercadolivre.com.br') || sourceUrl?.includes('mercadolibre.com')) {
            console.log(`[pelando:ml] ✓ ${sourceUrl.slice(0, 80)}`)
            dealUrl = await injectMLTag(sourceUrl)
          } else {
            console.log(`[pelando:ml] sem sourceUrl para: ${item.title.slice(0, 50)}, usando busca`)
            dealUrl = buildMLSearchUrl(item.title)
          }
        } else if (storeLower.includes('shopee')) {
          if (!sourceUrl?.includes('shopee.com.br') && !sourceUrl?.includes('shp.ee')) {
            console.log(`[pelando:shopee] sem sourceUrl para: ${item.title.slice(0, 50)}`)
            continue
          }
          let shopeeUrl = sourceUrl
          if (shopeeUrl.includes('shp.ee') || shopeeUrl.includes('s.shopee.com.br')) {
            shopeeUrl = await expandShortLink(shopeeUrl)
          }
          console.log(`[pelando:shopee] ✓ ${shopeeUrl.slice(0, 80)}`)
          const shopeeInfo = await fetchShopeeProductByUrl(shopeeUrl).catch(() => null)
          if (shopeeInfo?.imageUrl) imageUrl = shopeeInfo.imageUrl
          shopeeOriginalPrice = shopeeInfo?.originalPrice
          const subIds: SubIds = { source: 'telegram', trigger: 'auto', category: 'geral', slot: 'none' }
          try { dealUrl = await generateAffiliateLink(shopeeUrl, subIds) } catch { dealUrl = shopeeUrl }
        }

        allDeals.push({
          id: dealPageUrl,
          title: item.title.slice(0, 80),
          price: formatPriceFromProps(item),
          originalPrice: shopeeOriginalPrice,
          store: storeName,
          dealUrl,
          imageUrl,
          temperature: item.temperature,
          publishedAt: now,
          couponCode: '',
        })
      }
    } catch (err) {
      console.error(`[pelando] Erro em ${categoryUrl}:`, err instanceof Error ? err.message : err)
    }
  }

  return allDeals.sort((a, b) => b.temperature - a.temperature).slice(0, 20)
}

function formatPriceFromProps(item: PelandoRawDeal): string {
  if (item.price !== null && item.price !== undefined) {
    return `R$${item.price.toFixed(2).replace('.', ',')}`
  }
  if (item.discountPercentage !== null && item.discountPercentage !== undefined) {
    return `${item.discountPercentage}% OFF`
  }
  if (item.discountFixed !== null && item.discountFixed !== undefined) {
    return `R$${item.discountFixed.toFixed(2).replace('.', ',')} OFF`
  }
  return 'Grátis'
}

// ── DealScraper port implementation ──────────────────────────────────────────

function inferPelandoMarketplace(store: string): Marketplace {
  const s = store.toLowerCase()
  if (s.includes('amazon')) return 'amazon'
  if (s.includes('mercado') || s.includes('mercadolivre') || s === 'ml') return 'mercadolivre'
  if (s.includes('shopee')) return 'shopee'
  return 'pelando'
}

/**
 * Parses a Brazilian-formatted price string (e.g. "R$1.299,90") into a number.
 * Strips currency prefix, removes thousands-separator dots, converts comma decimal to dot.
 * Returns 0 for malformed/non-numeric strings (e.g. "Grátis", "15% OFF").
 */
function parseBRPrice(priceStr: string): number {
  const cleaned = priceStr.replace(/[^\d,.]/g, '')
  // Brazilian format: dot is thousands separator, comma is decimal separator
  const normalized = cleaned.replace(/\./g, '').replace(',', '.')
  return parseFloat(normalized) || 0
}

/**
 * Pure toDeal conversion — exported for unit testing without network IO.
 * Converts a raw PelandoDeal into the core Deal domain type.
 */
export function toDealPelando(raw: PelandoDeal): Deal {
  const price = parseBRPrice(raw.price)

  let originalPrice: number | undefined
  if (raw.originalPrice) {
    const parsed = parseBRPrice(raw.originalPrice)
    if (!isNaN(parsed) && parsed > price) originalPrice = parsed
  }

  return {
    id: raw.id,
    title: raw.title,
    price,
    originalPrice,
    url: raw.dealUrl,
    imageUrl: raw.imageUrl || undefined,
    couponCode: raw.couponCode || undefined,
    marketplace: inferPelandoMarketplace(raw.store),
    category: 'geral',
    postedAt: new Date(raw.publishedAt),
  }
}

export class PelandoScraper implements DealScraper {
  async fetchDeals(_category?: string): Promise<Deal[]> {
    const raw = await fetchDeals()
    return raw.map(toDealPelando)
  }
}
