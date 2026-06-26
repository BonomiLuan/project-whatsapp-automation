import 'dotenv/config'
import path from 'path'
import { runner } from 'node-pg-migrate'

// ── Adapters ──────────────────────────────────────────────────────────────────
import { PgAdvisoryLock } from './adapters/lock/PgAdvisoryLock.js'
import { PgRotationStore } from './adapters/store/PgRotationStore.js'
import { PgDealRepository } from './adapters/db/PgDealRepository.js'
import { PgTenantRepository } from './adapters/db/PgTenantRepository.js'
import { TelegramPublisher } from './adapters/publishers/TelegramPublisher.js'
import { NodeCronScheduler } from './adapters/scheduler/NodeCronScheduler.js'
import { AmazonAffiliateLinkBuilder } from './adapters/affiliates/AmazonAffiliate.js'
import { MLAffiliateLinkBuilder } from './adapters/affiliates/MLAffiliate.js'
import { ShopeeAffiliateLinkBuilder } from './adapters/affiliates/ShopeeAffiliate.js'
import { CompositeAffiliateLinkBuilder } from './adapters/affiliates/CompositeAffiliateLinkBuilder.js'

// ── Use cases ─────────────────────────────────────────────────────────────────
import { SuggestDeals } from './core/usecases/SuggestDeals.js'

// ── Job registrations ─────────────────────────────────────────────────────────
import { registerSuggestionJobs } from './jobs/cronLock.js'
import { refreshDeals } from './web/server.js'
import { setShopeeCouponTrigger, sendCouponAlertToChat } from './adapters/publishers/TelegramPublisher.js'
import { setTenantRepo } from './web/server.js'
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
const scheduler = new NodeCronScheduler()

// ── Affiliate link builder ────────────────────────────────────────────────────
const affiliateBuilder = new CompositeAffiliateLinkBuilder([
  new AmazonAffiliateLinkBuilder(),
  new MLAffiliateLinkBuilder(),
  new ShopeeAffiliateLinkBuilder(),
])

// ── Build use cases ───────────────────────────────────────────────────────────
const suggest = new SuggestDeals(rotationStore, dealRepo, telegramPublisher, affiliateBuilder)

// ── Inject tenant repository into web layer ───────────────────────────────────
setTenantRepo(tenantRepo)

// ── Wire Shopee coupon bot command ────────────────────────────────────────────
const SHOPEE_COUPON_PAGE = 'https://shopee.com.br/m/cupom-de-desconto'

async function runShopeeCouponAlert(): Promise<void> {
  const affiliateUrl = await generateAffiliateLink(SHOPEE_COUPON_PAGE).catch(() => SHOPEE_COUPON_PAGE)
  await sendCouponAlertToChat([], affiliateUrl)
}

setShopeeCouponTrigger(runShopeeCouponAlert)

// ── Register jobs ─────────────────────────────────────────────────────────────
registerSuggestionJobs(scheduler, suggest, rotationStore, tenantRepo)

// Refresh Shopee deal cache every 6 hours
scheduler.schedule('shopee-refresh', '0 8,14,20 * * *', async () => {
  console.log('[shopee-refresh] Atualizando cache de produtos...')
  await refreshDeals()
})

// Shopee coupon alert every 4h
scheduler.schedule('shopee-coupon-monitor', '0 9,13,17,21 * * *', async () => {
  console.log('[shopee-coupons] Verificando cupons Shopee...')
  try {
    await runShopeeCouponAlert()
    console.log('[shopee-coupons] ✓ Alerta enviado')
  } catch (err) {
    console.error('[shopee-coupons] Erro:', err instanceof Error ? err.message : err)
  }
})

// ── Start web server ──────────────────────────────────────────────────────────
// Note: server.ts is already imported via `setTenantRepo` above.
