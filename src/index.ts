import 'dotenv/config'
import path from 'path'
import { runner } from 'node-pg-migrate'

// ── Adapters ──────────────────────────────────────────────────────────────────
import { PgAdvisoryLock } from './adapters/lock/PgAdvisoryLock.js'
import { PgRotationStore } from './adapters/store/PgRotationStore.js'
import { PgDealRepository } from './adapters/db/PgDealRepository.js'
import { PgTenantRepository } from './adapters/db/PgTenantRepository.js'
import { TelegramPublisher } from './adapters/publishers/TelegramPublisher.js'
import { PelandoScraper } from './adapters/scrapers/PelandoScraper.js'
import { MercadoLivreScraper } from './adapters/scrapers/MercadoLivreScraper.js'
import { NodeCronScheduler } from './adapters/scheduler/NodeCronScheduler.js'
import { AmazonAffiliateLinkBuilder } from './adapters/affiliates/AmazonAffiliate.js'
import { MLAffiliateLinkBuilder } from './adapters/affiliates/MLAffiliate.js'
import { ShopeeAffiliateLinkBuilder } from './adapters/affiliates/ShopeeAffiliate.js'
import { CompositeAffiliateLinkBuilder } from './adapters/affiliates/CompositeAffiliateLinkBuilder.js'

// ── Use cases ─────────────────────────────────────────────────────────────────
import { MonitorDeals } from './core/usecases/MonitorDeals.js'
import { SuggestDeals } from './core/usecases/SuggestDeals.js'

// ── Job registrations ─────────────────────────────────────────────────────────
import { registerPelandoMonitor } from './jobs/monitorPelando.js'
import { registerMLMonitor } from './jobs/monitorML.js'
import { registerSuggestionJobs } from './jobs/cronLock.js'
import { refreshDeals } from './web/server.js'
import { setPelandoTrigger, setShopeeCouponTrigger, sendCouponAlertToChat } from './adapters/publishers/TelegramPublisher.js'
import { setTenantRepo } from './web/server.js'
import { fetchShopeeCoupons, SHOPEE_COUPON_PAGE } from './adapters/scrapers/ShopeeCouponScraper.js'
import { generateAffiliateLink } from './adapters/affiliates/ShopeeAffiliate.js'

// ── Migration runner ──────────────────────────────────────────────────────────
async function runMigrations(): Promise<void> {
  await runner({
    databaseUrl: process.env.DATABASE_URL!,
    dir: path.resolve(process.cwd(), 'migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: (msg: string) => console.log('[migrations]', msg),
  })
}

// ── Boot ──────────────────────────────────────────────────────────────────────
console.log('[boot] running migrations...')
await runMigrations()
console.log('[boot] migrations complete')

// ── Instantiate adapters ──────────────────────────────────────────────────────
const lock = new PgAdvisoryLock()
const rotationStore = new PgRotationStore()
const dealRepo = new PgDealRepository()
const tenantRepo = new PgTenantRepository()
const telegramPublisher = new TelegramPublisher()
const pelandoScraper = new PelandoScraper()
const mlScraper = new MercadoLivreScraper()
const scheduler = new NodeCronScheduler()

// ── Affiliate link builder (composite: Amazon + ML + Shopee) ──────────────────
const affiliateBuilder = new CompositeAffiliateLinkBuilder([
  new AmazonAffiliateLinkBuilder(),
  new MLAffiliateLinkBuilder(),
  new ShopeeAffiliateLinkBuilder(),
])

// ── Build use cases ───────────────────────────────────────────────────────────
const pelandoMonitor = new MonitorDeals(pelandoScraper, telegramPublisher, dealRepo, tenantRepo)
const mlMonitor = new MonitorDeals(mlScraper, telegramPublisher, dealRepo, tenantRepo)
const suggest = new SuggestDeals(rotationStore, dealRepo, telegramPublisher, affiliateBuilder)

// ── Inject tenant repository into web layer ───────────────────────────────────
setTenantRepo(tenantRepo)

// ── Wire bot commands ─────────────────────────────────────────────────────────
setPelandoTrigger(() => pelandoMonitor.execute(undefined, 5))

async function runShopeeCouponAlert(): Promise<void> {
  const [couponsResult, urlResult] = await Promise.allSettled([
    fetchShopeeCoupons(),
    generateAffiliateLink(SHOPEE_COUPON_PAGE),
  ])
  const coupons = couponsResult.status === 'fulfilled' ? couponsResult.value : []
  const affiliateUrl = urlResult.status === 'fulfilled' ? urlResult.value : SHOPEE_COUPON_PAGE
  await sendCouponAlertToChat(coupons, affiliateUrl)
}

setShopeeCouponTrigger(runShopeeCouponAlert)

// ── Register jobs ─────────────────────────────────────────────────────────────
registerPelandoMonitor(scheduler, lock, pelandoMonitor)
// ML monitor disabled — Playwright scraping unreliable; revisit with REST API
// registerMLMonitor(scheduler, lock, mlMonitor)
registerSuggestionJobs(scheduler, suggest, rotationStore, tenantRepo)

// Refresh Shopee deal cache every 6 hours (8h, 14h, 20h)
scheduler.schedule('shopee-refresh', '0 8,14,20 * * *', async () => {
  console.log('[shopee-refresh] Atualizando cache de produtos...')
  await refreshDeals()
})

// Shopee coupon page monitor — every 4h (9h, 13h, 17h, 21h)
scheduler.schedule('shopee-coupon-monitor', '0 9,13,17,21 * * *', async () => {
  console.log('[shopee-coupons] Verificando cupons Shopee...')
  try {
    await runShopeeCouponAlert()
    console.log('[shopee-coupons] ✓ Alerta enviado')
  } catch (err) {
    console.error('[shopee-coupons] Erro:', err instanceof Error ? err.message : err)
  }
})

// ── Start web server (Express + WhatsApp bot + Telegram bot) ──────────────────
// Note: server.ts is already imported via `setTenantRepo` on line 28 above.
// A redundant bare import here was removed to avoid double-module-execution risk.
