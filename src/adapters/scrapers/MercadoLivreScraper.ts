import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { injectMLTag } from '../affiliates/MLAffiliate.js'
import type { DealCategory } from '../affiliates/ShopeeAffiliate.js'
import type { DealScraper } from '../../core/ports/DealScraper.js'
import type { Deal } from '../../core/domain/Deal.js'

chromium.use(StealthPlugin())

const MIN_DISCOUNT_PERCENT = 15

// Buscas direcionadas ao nicho do grupo — categoria fixada por URL
// lista.mercadolivre.com.br requer sessão; as buscas são feitas via navegação interna
const ML_SEARCHES: Array<{ query: string; category: DealCategory }> = [
  { query: 'fralda descartavel bebe',  category: 'fraldas'     },
  { query: 'lenco umedecido bebe',     category: 'higiene'     },
  { query: 'carrinho de bebe',         category: 'mobilidade'  },
  { query: 'mamadeira bebe',           category: 'alimentacao' },
  { query: 'roupinha bebe conjunto',   category: 'enxoval'     },
]

const KEYWORD_MAP: [string, DealCategory][] = [
  ['fralda', 'fraldas'],
  ['lenço umedecido', 'higiene'], ['pomada assadura', 'higiene'], ['creme assadur', 'higiene'],
  ['escova de dentes infantil', 'higiene'], ['sabonete líquido', 'higiene'],
  ['shampoo', 'banho'], ['sabonete', 'banho'], ['toalha capuz', 'banho'], ['banheira', 'banho'],
  ['esponja', 'banho'], ['roupão', 'banho'],
  ['mamadeira', 'alimentacao'], ['chupeta', 'alimentacao'], ['esterilizador', 'alimentacao'],
  ['almofada amamentação', 'maternidade'], ['sling', 'maternidade'], ['babá eletrônica', 'maternidade'],
  ['trocador', 'maternidade'], ['amamenta', 'maternidade'],
  ['body bebê', 'enxoval'], ['manta bebê', 'enxoval'], ['enxoval', 'enxoval'],
  ['pijama infantil', 'enxoval'], ['conjunto menin', 'enxoval'], ['vestido infantil', 'enxoval'],
  ['sapatilha', 'enxoval'], ['tênis infantil', 'enxoval'],
  ['carrinho', 'mobilidade'], ['bebê conforto', 'mobilidade'], ['bebe conforto', 'mobilidade'],
  ['berço', 'quarto'], ['berco', 'quarto'], ['cortina blackout', 'quarto'], ['protetor de berço', 'quarto'],
  ['brinquedo', 'brinquedos'], ['pelúcia', 'brinquedos'], ['boneca', 'brinquedos'],
  ['bloco de montar', 'brinquedos'], ['tapete de atividades', 'brinquedos'],
  ['termômetro', 'saude'], ['aspirador nasal', 'saude'], ['nebulizador', 'saude'],
  ['panela', 'casa'], ['organização', 'casa'], ['cesto', 'casa'], ['tapete', 'casa'],
  ['detergente', 'limpeza'], ['sabão em pó', 'limpeza'], ['desinfetante', 'limpeza'],
  ['multiuso', 'limpeza'], ['mop', 'limpeza'], ['aspirador de pó', 'limpeza'],
  ['quadro decorativo', 'decoracao'], ['espelho', 'decoracao'], ['luminária', 'decoracao'],
  ['manta para sofá', 'decoracao'],
]

function inferCategory(title: string): DealCategory {
  const lower = title.toLowerCase()
  for (const [kw, cat] of KEYWORD_MAP) {
    if (lower.includes(kw)) return cat
  }
  return 'geral'
}

export interface MLCategoryDeal {
  id: string
  title: string
  price: string
  originalPrice: string
  discountPercent: number
  imageUrl: string
  affiliateUrl: string
  category: DealCategory
}

export async function fetchMLCategoryDeals(limit = 60): Promise<MLCategoryDeal[]> {
  const t0 = Date.now()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    })

    const contextOptions = {
      viewport: { width: 1366, height: 768 } as const,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
    }

    const seenIds = new Set<string>()
    const rawProducts: Array<{ id: string; title: string; price: number; original: number; img: string; url: string; category: DealCategory }> = []

    for (const { query, category: pageCategory } of ML_SEARCHES) {
      const label = query
      // Contexto limpo por busca — evita rastreamento de sessão entre requests
      const context = await browser.newContext(contextOptions)
      const page = await context.newPage()
      try {
        const searchUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(query.replace(/ /g, '-'))}`
        console.log(`[ml:playwright] buscando "${label}"...`)
        const res = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        console.log(`[ml:playwright] HTTP ${res?.status()} | ${label}`)

        if (!res || res.status() >= 400) {
          console.log(`[ml:playwright] ${label}: página inválida, pulando`)
          continue
        }

        // Aguarda cards aparecerem (até 15s)
        const cardSelector = '[class*="poly-card"], [class*="ui-search-result"], [class*="shops__item"]'
        try {
          await page.waitForSelector(cardSelector, { timeout: 15000 })
        } catch {
          console.log(`[ml:playwright] ${label}: nenhum card encontrado após 15s`)
          continue
        }

        // Scroll progressivo para carregar mais cards (lazy loading da página)
        let prevHeight = 0
        for (let i = 0; i < 4; i++) {
          const h = await page.evaluate(() => document.body.scrollHeight)
          if (h === prevHeight) break
          prevHeight = h
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
          await page.waitForTimeout(1500)
        }

        const found = await page.evaluate((selector) => {
          const cards = Array.from(document.querySelectorAll(selector))
          const results: Array<{ id: string; title: string; price: number; original: number; img: string; url: string }> = []

          for (const card of cards) {
            // URL e ID
            const anchor = card.querySelector<HTMLAnchorElement>('a[href*="MLB"]') ?? card.querySelector<HTMLAnchorElement>('a[href*="mercadolivre"]')
            const url = anchor?.href ?? ''
            const id = url.match(/MLB\d+/)?.[0] ?? card.querySelector('[class*="poly-component__title"]')?.getAttribute('href')?.match(/MLB\d+/)?.[0] ?? ''
            if (!id) continue

            // Título
            const title = (
              card.querySelector('[class*="poly-component__title"]') ??
              card.querySelector('[class*="item__title"]') ??
              card.querySelector('h2')
            )?.textContent?.trim() ?? ''

            // Preço atual — busca dentro do container de preço atual para não capturar o preço riscado (original)
            const priceAnchor = (
              card.querySelector('[class*="poly-price__current"]') ??
              card.querySelector('[class*="price-tag-amount"]:not([class*="price-tag-amount--through"])') ??
              card
            )
            const priceFrac = priceAnchor.querySelector('[class*="price-tag-fraction"], [class*="andes-money-amount__fraction"]')?.textContent?.replace(/\D/g, '') ?? ''
            const priceCents = priceAnchor.querySelector('[class*="price-tag-cents"], [class*="andes-money-amount__cents"]')?.textContent?.replace(/\D/g, '') ?? '00'
            const price = priceFrac ? parseFloat(`${priceFrac}.${priceCents.padEnd(2, '0')}`) : 0

            // Preço original (riscado) — poly-card usa andes-money-amount--previous / poly-price__original
            const origParent = card.querySelector(
              '[class*="poly-price__original"], [class*="andes-money-amount--previous"], s[class*="andes-money-amount"], [class*="original-value"], [class*="price-tag--del"], [class*="price-tag-amount--through"]'
            )
            const origFrac = origParent?.querySelector('[class*="andes-money-amount__fraction"], [class*="fraction"]')?.textContent?.replace(/\D/g, '') ?? ''
            const origCents = origParent?.querySelector('[class*="andes-money-amount__cents"], [class*="cents"]')?.textContent?.replace(/\D/g, '') ?? '00'
            let original = origFrac ? parseFloat(`${origFrac}.${origCents.padEnd(2, '0')}`) : 0

            // Fallback: badge de desconto percentual (ex: "-30%") → calcula preço original
            if (!original || original <= price) {
              const discountBadge = card.querySelector(
                '[class*="poly-component__discount"], [class*="price-tag-discount"], [class*="discount-label"], [class*="discount-badge"]'
              )
              const discountText = discountBadge?.textContent?.match(/(\d+)\s*%/)?.[1]
              if (discountText) {
                const pct = parseInt(discountText, 10)
                if (pct > 0 && pct < 100) original = price / (1 - pct / 100)
              }
            }

            // Imagem
            const img = (card.querySelector<HTMLImageElement>('img[src*="mlstatic"], img[src*="http"]')?.src ?? card.querySelector<HTMLImageElement>('img')?.src ?? '').replace('http://', 'https://')

            if (title && price > 0) results.push({ id, title, price, original, img, url })
          }
          return results
        }, cardSelector)

        const newCount = found.filter(p => !seenIds.has(p.id)).length
        console.log(`[ml:playwright] ${label}: ${found.length} cards extraídos (${newCount} novos)`)
        for (const p of found) {
          if (!seenIds.has(p.id)) { seenIds.add(p.id); rawProducts.push({ ...p, category: pageCategory }) }
        }
      } catch (e) {
        console.error(`[ml:playwright] erro em ${label}: ${(e as Error).message}`)
      } finally {
        await page.close()
        await context.close()
      }
    }

    // Plano B: todos os produtos da página /ofertas são deals curados pelo ML
    // Desconto é informativo quando detectado, mas não bloqueia inclusão
    const deals: MLCategoryDeal[] = []
    let withDiscount = 0

    for (const p of rawProducts) {
      const hasOriginal = p.original > 0 && p.original > p.price
      const discount = hasOriginal ? Math.round((1 - p.price / p.original) * 100) : 0
      if (hasOriginal) withDiscount++

      const affiliateUrl = await injectMLTag(p.url)
      deals.push({
        id: p.id,
        title: p.title.slice(0, 80),
        price: `R$${p.price.toFixed(2).replace('.', ',')}`,
        originalPrice: hasOriginal ? `R$${p.original.toFixed(2).replace('.', ',')}` : '',
        discountPercent: discount,
        imageUrl: p.img,
        affiliateUrl,
        category: p.category,
      })
    }

    const sorted = deals.sort((a, b) => b.discountPercent - a.discountPercent).slice(0, limit)
    const byCategory = sorted.reduce<Record<string, number>>((acc, d) => { acc[d.category] = (acc[d.category] ?? 0) + 1; return acc }, {})
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

    console.log(`[ml:playwright] ✓ ${elapsed}s | ${rawProducts.length} extraídos | ${withDiscount} c/ preço original | ${sorted.length} ≥${MIN_DISCOUNT_PERCENT}%`)
    console.log(`[ml:playwright] categorias: ${Object.entries(byCategory).map(([k, v]) => `${k}:${v}`).join(' | ')}`)

    return sorted
  } catch (e) {
    console.error(`[ml:playwright] erro fatal: ${(e as Error).message}`)
    return []
  } finally {
    await browser?.close()
  }
}

// ── DealScraper port implementation ──────────────────────────────────────────

/**
 * Parses a Brazilian-formatted price string (e.g. "R$1.299,90") into a number.
 * Strips currency prefix, removes thousands-separator dots, converts comma decimal to dot.
 */
function parseBRPrice(priceStr: string): number {
  // Remove everything that's not digit, comma, or dot
  const cleaned = priceStr.replace(/[^\d,.]/g, '')
  // Brazilian format: dot is thousands separator, comma is decimal separator
  // e.g. "1.299,90" → remove dots → "1299,90" → replace comma → "1299.90"
  const normalized = cleaned.replace(/\./g, '').replace(',', '.')
  return parseFloat(normalized) || 0
}

/**
 * Pure toDeal conversion — exported for unit testing without network IO.
 * Converts a raw MLCategoryDeal into the core Deal domain type.
 */
export function toDealML(raw: MLCategoryDeal): Deal {
  const price = parseBRPrice(raw.price)

  let originalPrice: number | undefined
  if (raw.originalPrice) {
    const parsed = parseBRPrice(raw.originalPrice)
    if (!isNaN(parsed) && parsed > 0) originalPrice = parsed
  }

  return {
    id: raw.id,
    title: raw.title,
    price,
    originalPrice,
    url: raw.affiliateUrl,
    imageUrl: raw.imageUrl || undefined,
    marketplace: 'mercadolivre',
    category: raw.category as string,
    postedAt: new Date(),
  }
}

export class MercadoLivreScraper implements DealScraper {
  async fetchDeals(_category?: string): Promise<Deal[]> {
    const raw = await fetchMLCategoryDeals()
    return raw.map(toDealML)
  }
}
