import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { injectAmazonTag } from '../api/amazonAffiliate.js'

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

const ALLOWED_STORES: string[] = ['amazon']

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

          const dealUrl = item.store.toLowerCase().includes('amazon')
            ? injectAmazonTag(item.dealUrl)
            : item.dealUrl

          allDeals.push({
            id: item.dealUrl,
            title: item.title.slice(0, 80),
            price: formatPrice(item.price),
            store: item.store,
            dealUrl,
            imageUrl: item.imageUrl,
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
