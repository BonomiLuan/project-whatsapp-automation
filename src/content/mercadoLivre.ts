import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { injectMLTag } from '../api/mercadoLivreAffiliate.js'
import type { DealCategory } from '../api/shopeeAffiliate.js'

chromium.use(StealthPlugin())

const MIN_DISCOUNT_PERCENT = 15

// Página principal de ofertas ML — sub-páginas de categoria retornam 200 mas sem cards
const ML_PAGES = [
  'https://www.mercadolivre.com.br/ofertas',
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

    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
    })

    const seenIds = new Set<string>()
    const rawProducts: Array<{ id: string; title: string; price: number; original: number; img: string; url: string }> = []

    for (const pageUrl of ML_PAGES) {
      const label = pageUrl.replace('https://www.mercadolivre.com.br/', '')
      const page = await context.newPage()
      try {
        console.log(`[ml:playwright] abrindo ${label}...`)
        const res = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        console.log(`[ml:playwright] HTTP ${res?.status()} | ${label}`)

        if (!res || res.status() >= 400) {
          console.log(`[ml:playwright] página inválida, pulando`)
          await page.close()
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

            // Preço atual (fraction + cents)
            const priceFrac = card.querySelector('[class*="price-tag-fraction"], [class*="andes-money-amount__fraction"]')?.textContent?.replace(/\D/g, '') ?? ''
            const priceCents = card.querySelector('[class*="price-tag-cents"], [class*="andes-money-amount__cents"]')?.textContent?.replace(/\D/g, '') ?? '00'
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

        console.log(`[ml:playwright] ${label}: ${found.length} cards extraídos`)
        for (const p of found) {
          if (!seenIds.has(p.id)) { seenIds.add(p.id); rawProducts.push(p) }
        }
      } catch (e) {
        console.error(`[ml:playwright] erro em ${label}: ${(e as Error).message}`)
      } finally {
        await page.close()
      }
    }

    // Filtra por desconto e gera links de afiliado
    const deals: MLCategoryDeal[] = []
    let withDiscount = 0

    for (const p of rawProducts) {
      if (!p.original || p.original <= p.price) continue
      withDiscount++
      const discount = Math.round((1 - p.price / p.original) * 100)
      if (discount < MIN_DISCOUNT_PERCENT) continue

      const affiliateUrl = await injectMLTag(p.url)
      deals.push({
        id: p.id,
        title: p.title.slice(0, 80),
        price: `R$${p.price.toFixed(2).replace('.', ',')}`,
        originalPrice: `R$${p.original.toFixed(2).replace('.', ',')}`,
        discountPercent: discount,
        imageUrl: p.img,
        affiliateUrl,
        category: inferCategory(p.title),
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
