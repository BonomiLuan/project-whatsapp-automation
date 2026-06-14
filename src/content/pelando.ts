import axios from 'axios'
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { injectAmazonTag } from '../api/amazonAffiliate.js'
import { buildMLSearchUrl, injectMLTag } from '../api/mercadoLivreAffiliate.js'
import { generateAffiliateLink, expandShortLink, type SubIds } from '../api/shopeeAffiliate.js'

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

async function resolveCouponCodeFromPelandoPage(dealUrl: string): Promise<string | null> {
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
    console.log(`[pelando:cupom] axios falhou para ${dealUrl}: ${(e as Error).message}`)
    return null
  }

  // Pelando uses Astro — deal data is serialized as HTML-encoded JSON in the page
  // Pattern: &quot;couponCode&quot;:[0,&quot;CORREOFF&quot;]
  const astroJson = html.match(/&quot;couponCode&quot;:\[0,&quot;([A-Z0-9]{2,25})&quot;\]/i)
  if (astroJson) {
    console.log(`[pelando:cupom] página detalhe: couponCode JSON = "${astroJson[1]}"`)
    return astroJson[1].toUpperCase()
  }

  // Fallback 1: <span class="code" ...>CORREOFF</span>
  const spanCode = html.match(/<span\s+class="code"[^>]*>([A-Z0-9]{2,25})<\/span>/i)
  if (spanCode) {
    console.log(`[pelando:cupom] página detalhe: span.code = "${spanCode[1]}"`)
    return spanCode[1].toUpperCase()
  }

  // Fallback 2: data-code="CORREOFF" on copy button
  const dataCode = html.match(/data-code="([A-Z0-9]{2,25})"/i)
  if (dataCode) {
    console.log(`[pelando:cupom] página detalhe: data-code = "${dataCode[1]}"`)
    return dataCode[1].toUpperCase()
  }

  console.log(`[pelando:cupom] página detalhe: código não encontrado em ${dealUrl}`)
  return null
}

chromium.use(StealthPlugin())

export interface PelandoDeal {
  id: string
  title: string
  price: string
  store: string
  dealUrl: string
  imageUrl: string
  temperature: number
  publishedAt: string
  couponCode: string   // empty string if not a coupon deal
}

// Pelando category pages for the maternity/home niche
const CATEGORIES = [
  'https://www.pelando.com.br/c/para-minha-familia', // Família, filhos e pets
  'https://www.pelando.com.br/c/para-meu-lar',       // Para meu lar
]

const MIN_TEMPERATURE = 20

const ALLOWED_STORES: string[] = ['amazon', 'mercado livre', 'mercadolivre', 'ml', 'shopee']

export async function fetchDeals(): Promise<PelandoDeal[]> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  })
  const page = await browser.newPage()

  await page.setViewportSize({ width: 1366, height: 768 })
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  })

  const allDeals: PelandoDeal[] = []
  const seen = new Set<string>()

  try {
    for (const categoryUrl of CATEGORIES) {
      try {
        await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })

        // Cloudflare JS challenge — StealthPlugin executes the proof-of-work and page redirects back
        if (/just a moment|checking your browser|attention required/i.test(await page.title())) {
          console.log(`[pelando] Aguardando resolução de challenge Cloudflare para ${categoryUrl.split('/').pop()}...`)
          try {
            await page.waitForURL(url => !url.toString().includes('__cf_chl'), { timeout: 35000 })
            await page.waitForLoadState('domcontentloaded', { timeout: 15000 })
          } catch {
            console.log(`[pelando] Challenge Cloudflare não resolvido em ${categoryUrl} — IP bloqueado`)
            continue
          }
        }

        const pageTitle = await page.title()
        console.log(`[pelando] página carregada: "${pageTitle}"`)
        if (/cloudflare|just a moment|checking your browser|attention required/i.test(pageTitle)) {
          console.log(`[pelando] BLOQUEADO por Cloudflare (hard block) em ${categoryUrl}`)
          continue
        }
        await page.waitForSelector('[class*="deal-card-stamp"]', { timeout: 20000 })

        const raw = await page.evaluate(() => {
          const priceEls = Array.from(document.querySelectorAll('[class*="deal-card-stamp"]'))
          return priceEls.map(priceEl => {
            let card = priceEl.parentElement
            for (let i = 0; i < 6; i++) {
              if (!card) break
              if (card.querySelector('[class*="deal-card-title"]') && card.querySelector('[class*="deal-card-actions"]')) break
              card = card.parentElement
            }
            if (!card) return null

            const titleEl = card.querySelector('[class*="deal-card-title"] a, [class*="deal-card-title"]')
            const storeEl = card.querySelector('[class*="deal-card-store"] strong')
            const actionsText = card.querySelector('[class*="deal-card-actions"]')?.textContent || ''
            const imgEl = card.querySelector<HTMLImageElement>('img')
            const linkEl = card.querySelector<HTMLAnchorElement>('a[href*="/d/"]')
            const tempMatch = actionsText.match(/^(\d+)°/)

            // Detect store via /cupons-de-descontos/STORE link (most reliable)
            const storeLink = card.querySelector<HTMLAnchorElement>('a[href*="/cupons-de-descontos/"]')
            const storeFromLink = storeLink?.getAttribute('href')?.split('/cupons-de-descontos/')[1] || ''
            const storeText = storeEl?.textContent?.trim() || storeFromLink

            // Coupon code extraction — try several selector patterns used by Pelando
            const COUPON_SELECTORS = [
              '[class*="coupon-code"]', '[class*="CouponCode"]', '[class*="promo-code"]',
              '[class*="PromoCode"]', '[class*="discount-code"]', '[data-testid*="coupon"]',
              '[class*="Coupon"]', '[class*="cupom"]', '[class*="codigo"]',
            ]
            const codeEl = card.querySelector(COUPON_SELECTORS.join(', '))
            const titleText = titleEl?.textContent?.trim() || ''
            let couponCode = ''
            let _dbg_codeElClass = ''
            let _dbg_codeElRaw = ''
            let _dbg_cardClasses: string[] = []
            if (codeEl) {
              const raw = codeEl.textContent?.trim().replace(/\s+/g, '').toUpperCase() || ''
              _dbg_codeElClass = (codeEl as HTMLElement).className || ''
              _dbg_codeElRaw = raw
              const skip = ['COPIAR', 'COPY', 'VER', 'CODIGO', 'CUPOM', 'CODE', 'CLIQUE', 'REVELAR']
              if (raw.length >= 4 && !skip.includes(raw)) couponCode = raw
            } else {
              // Collect suspicious class names to help discover correct selectors
              const allClasses = [...card.querySelectorAll('*')].flatMap(el => [...(el as HTMLElement).classList]).filter(Boolean)
              _dbg_cardClasses = [...new Set(allClasses)].filter(c => /code|coupon|promo|cupom|desconto|discount/i.test(c))
            }
            // Fallback: extract code from title only when preceded by colon — e.g. "Código: VIRADA20"
            // Note: NOT matching "Cupom Mercado Livre" (space, not colon) to avoid false positives
            if (!couponCode) {
              const m = titleText.match(/(?:c[oó]digo|code)\s*[=:]\s*([A-Z0-9]{4,20})/i)
              if (m) couponCode = m[1].toUpperCase()
            }
            const priceText = priceEl.textContent?.trim() || ''
            const isCouponPrice = /\d+%\s*off|R\$\s*[\d,.]+\s*off/i.test(priceText)

            return {
              title: titleEl?.textContent?.trim() || '',
              price: priceText,
              store: storeText,
              temperature: tempMatch ? parseInt(tempMatch[1]) : 0,
              imageUrl: imgEl?.src || imgEl?.getAttribute('data-src') || '',
              dealUrl: linkEl?.href?.split('?')[0] || '',
              couponCode,
              isCouponPrice,
              _dbg_codeElClass,
              _dbg_codeElRaw,
              _dbg_cardClasses,
            }
          }).filter(Boolean)
        })

        const now = new Date().toISOString()
        const storesSeen = raw.map(i => i?.store || '(sem loja)').filter(Boolean)
        console.log(`[pelando] ${categoryUrl.split('/').pop()} — ${raw.length} deals, lojas: ${[...new Set(storesSeen)].join(', ')}`)

        for (const item of raw) {
          if (!item?.title || !item.dealUrl) continue
          if (item.temperature < MIN_TEMPERATURE) continue
          if (seen.has(item.dealUrl)) continue

          // Resolve coupon code — card extraction first, then deal page fallback
          let couponCode = item.couponCode
          if (item.isCouponPrice && !couponCode) {
            console.log(`[pelando:cupom] sem código no card, buscando na página: ${item.title.slice(0, 60)}`)
            couponCode = await resolveCouponCodeFromPelandoPage(item.dealUrl) ?? ''
          }

          const isCouponDeal = item.isCouponPrice && couponCode.length > 0

          if (isCouponDeal) {
            // Mark as seen only after successful resolution
            seen.add(item.dealUrl)
            console.log(`[pelando:cupom] ✓ ${couponCode} — ${item.store} — ${item.price}`)
            allDeals.push({
              id: item.dealUrl,
              title: item.title.slice(0, 80),
              price: formatPrice(item.price),
              store: item.store,
              dealUrl: item.dealUrl,
              imageUrl: item.imageUrl,
              temperature: item.temperature,
              publishedAt: now,
              couponCode,
            })
            continue
          }

          // isCouponPrice but no code found → don't mark seen, retry next cycle
          if (item.isCouponPrice) continue

          seen.add(item.dealUrl)

          // Regular deal: apply store filter
          if (ALLOWED_STORES.length > 0) {
            const storeLower = item.store.toLowerCase()
            const allowed = ALLOWED_STORES.some(s => storeLower.includes(s))
            if (!allowed) continue
          }

          const storeLowerFull = item.store.toLowerCase()
          const isAmazonDeal = storeLowerFull.includes('amazon')
          const isMLDeal = storeLowerFull.includes('mercado') || storeLowerFull.includes('mercadolivre') || storeLowerFull === 'ml'
          let dealUrl: string
          let imageUrl = item.imageUrl
          if (isAmazonDeal) {
            let amazonUrl: string | null = null
            try {
              const resolved = await resolveAmazonFromPelandoPage(item.dealUrl)
              amazonUrl = resolved.amazonUrl
              if (resolved.imageUrl) imageUrl = resolved.imageUrl
              if (amazonUrl) {
                console.log(`[pelando:amazon] ✓ resolveu: ${amazonUrl.slice(0, 80)}`)
              } else {
                console.log(`[pelando] não resolveu URL Amazon para: ${item.title.slice(0, 50)}`)
              }
            } catch (e) {
              console.log(`[pelando:amazon] erro: ${(e as Error).message}`)
            }
            if (!amazonUrl) continue  // skip Amazon deals where real URL couldn't be resolved
            dealUrl = await injectAmazonTag(amazonUrl)
            // If still no product image, fetch from Amazon product page
            if (imageUrl === item.imageUrl) {
              const amazonImage = await fetchAmazonImage(dealUrl)
              console.log(`[pelando:amazon] fetchAmazonImage: ${amazonImage ?? 'null'}`)
              if (amazonImage) imageUrl = amazonImage
            }
          } else if (isMLDeal) {
            let mlUrl: string | null = null
            try {
              mlUrl = await resolveMLFromPelandoPage(item.dealUrl)
              if (mlUrl) {
                console.log(`[pelando:ml] ✓ resolveu: ${mlUrl.slice(0, 80)}`)
              } else {
                console.log(`[pelando:ml] não resolveu URL ML para: ${item.title.slice(0, 50)}`)
              }
            } catch (e) {
              console.log(`[pelando:ml] erro: ${(e as Error).message}`)
            }
            dealUrl = mlUrl ? await injectMLTag(mlUrl) : buildMLSearchUrl(item.title)
          } else if (storeLowerFull.includes('shopee')) {
            let shopeeUrl: string | null = null
            try {
              shopeeUrl = await resolveShopeeFromPelandoPage(item.dealUrl)
              if (shopeeUrl) {
                if (shopeeUrl.includes('shp.ee') || shopeeUrl.includes('s.shopee.com.br')) {
                  shopeeUrl = await expandShortLink(shopeeUrl)
                }
                console.log(`[pelando:shopee] ✓ resolveu: ${shopeeUrl.slice(0, 80)}`)
              } else {
                console.log(`[pelando:shopee] não resolveu URL para: ${item.title.slice(0, 50)}`)
              }
            } catch (e) {
              console.log(`[pelando:shopee] erro: ${(e as Error).message}`)
            }
            if (!shopeeUrl) continue
            const subIds: SubIds = { source: 'telegram', trigger: 'auto', category: 'geral', slot: 'none' }
            try { dealUrl = await generateAffiliateLink(shopeeUrl, subIds) } catch { dealUrl = shopeeUrl }
          } else {
            dealUrl = item.dealUrl
          }

          allDeals.push({
            id: item.dealUrl,
            title: item.title.slice(0, 80),
            price: formatPrice(item.price),
            store: item.store,
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

    // Sort by temperature descending
    return allDeals.sort((a, b) => b.temperature - a.temperature).slice(0, 20)

  } finally {
    await browser.close()
  }
}

function formatPrice(raw: string): string {
  if (!raw) return ''
  if (/gr[aá]tis/i.test(raw)) return 'Grátis'
  if (raw.includes('OFF')) return raw.trim()
  const match = raw.match(/[\d.,]+/)
  if (!match) return raw.trim()
  const num = parseFloat(match[0].replace(/\./g, '').replace(',', '.'))
  if (isNaN(num)) return raw.trim()
  return `R$${num.toFixed(2).replace('.', ',')}`
}
