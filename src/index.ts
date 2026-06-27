import 'dotenv/config'

// ── Adapters ──────────────────────────────────────────────────────────────────
import { InMemoryRotationStore } from './adapters/store/InMemoryRotationStore.js'
import { InMemoryDealRepository } from './adapters/db/InMemoryDealRepository.js'
import { InMemoryTenantRepository } from './adapters/db/InMemoryTenantRepository.js'
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

// ── Instantiate adapters ──────────────────────────────────────────────────────
const rotationStore = new InMemoryRotationStore()
const dealRepo = new InMemoryDealRepository()
const tenantRepo = new InMemoryTenantRepository()
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
