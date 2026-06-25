import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

chromium.use(StealthPlugin())

export const SHOPEE_COUPON_PAGE = 'https://shopee.com.br/m/cupom-de-desconto'

export interface ShopeeCoupon {
  discount: string
  condition?: string
}

export async function fetchShopeeCoupons(): Promise<ShopeeCoupon[]> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    console.log('[shopee-coupons] Abrindo página de cupons Shopee...')
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
    await page.goto(SHOPEE_COUPON_PAGE, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Wait for dynamic content to render
    await page.waitForTimeout(4000)

    const coupons = await page.evaluate((): Array<{ discount: string; condition?: string }> => {
      const results: Array<{ discount: string; condition?: string }> = []

      // Shopee uses hashed class names — match on partial class patterns
      const selectors = [
        '[class*="coupon-card"]',
        '[class*="voucher-card"]',
        '[class*="coupon-item"]',
        '[class*="voucher-item"]',
        '[class*="CouponCard"]',
        '[class*="VoucherCard"]',
      ]

      let cards: Element[] = []
      for (const sel of selectors) {
        const found = Array.from(document.querySelectorAll(sel))
        if (found.length > 0) { cards = found; break }
      }

      // Fallback: scan all elements whose text contains R$ OFF or % OFF
      if (cards.length === 0) {
        document.querySelectorAll('li, article, section > div').forEach(el => {
          const t = el.textContent ?? ''
          if (/(R\$\s*\d+\s*OFF|\d+%\s*OFF)/i.test(t) && t.length < 300) {
            cards.push(el)
          }
        })
      }

      const seen = new Set<string>()
      for (const card of cards.slice(0, 10)) {
        const text = card.textContent ?? ''
        const discountMatch = text.match(/(R\$\s*\d+(?:[,.]\d+)?\s*(?:OFF|off)?|\d+\s*%\s*(?:OFF|off|desconto)?)/i)
        if (!discountMatch) continue
        const discount = discountMatch[0].trim().toUpperCase().replace(/\s+/g, ' ')
        if (seen.has(discount)) continue
        seen.add(discount)

        const condMatch = text.match(/(acima\s+de|mín(?:imo)?[:\s]+|a\s+partir\s+de)\s*R\$\s*[\d,.]+/i)
        results.push({ discount, condition: condMatch?.[0].trim() })
      }

      return results
    })

    console.log(`[shopee-coupons] ${coupons.length} cupons extraídos`)
    return coupons
  } catch (err) {
    console.error('[shopee-coupons] Erro ao scraping:', err instanceof Error ? err.message : err)
    return []
  } finally {
    await browser?.close()
  }
}
