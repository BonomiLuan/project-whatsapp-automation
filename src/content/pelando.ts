import axios from 'axios'
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { injectAmazonTag } from '../api/amazonAffiliate.js'
import { buildMLSearchUrl } from '../api/mercadoLivreAffiliate.js'

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
}

// Pelando category pages for the maternity/home niche
const CATEGORIES = [
  'https://www.pelando.com.br/c/para-minha-familia', // Família, filhos e pets
  'https://www.pelando.com.br/c/para-meu-lar',       // Para meu lar
]

const MIN_TEMPERATURE = 20

const ALLOWED_STORES: string[] = ['amazon', 'mercado livre', 'mercadolivre', 'ml']

export async function fetchDeals(): Promise<PelandoDeal[]> {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  await page.setViewportSize({ width: 1366, height: 768 })
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  })

  const allDeals: PelandoDeal[] = []
  const seen = new Set<string>()

  try {
    for (const categoryUrl of CATEGORIES) {
      try {
        await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForSelector('[class*="deal-card-stamp"]', { timeout: 15000 })

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

            return {
              title: titleEl?.textContent?.trim() || '',
              price: priceEl.textContent?.trim() || '',
              store: storeText,
              temperature: tempMatch ? parseInt(tempMatch[1]) : 0,
              imageUrl: imgEl?.src || imgEl?.getAttribute('data-src') || '',
              dealUrl: linkEl?.href?.split('?')[0] || '',
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

          // Store filter — only include configured stores
          if (ALLOWED_STORES.length > 0) {
            const storeLower = item.store.toLowerCase()
            const allowed = ALLOWED_STORES.some(s => storeLower.includes(s))
            if (!allowed) continue
          }

          seen.add(item.dealUrl)

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
            dealUrl = buildMLSearchUrl(item.title)
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
