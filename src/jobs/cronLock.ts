import type { Scheduler } from '../core/ports/Scheduler.js'
import type { RotationStore } from '../core/ports/RotationStore.js'
import type { TenantRepository } from '../core/ports/TenantRepository.js'
import type { SuggestDeals } from '../core/usecases/SuggestDeals.js'
import { getCachedDeals } from '../web/server.js'

/**
 * registerSuggestionJobs — wires suggestion + daily reset into the scheduler.
 * No cron runs at import time; the caller (composition root) controls lifecycle.
 *
 * SuggestDeals.execute(tenant, pool) requires a tenant and a deal pool.
 * At each firing we fetch all active tenants from tenantRepo and run the use
 * case for each, using the in-memory deal cache as the suggestion pool.
 */
export function registerSuggestionJobs(
  scheduler: Scheduler,
  suggest: SuggestDeals,
  rotationStore: RotationStore,
  tenantRepo: TenantRepository,
): void {
  // Every 30 min during 07–22 — send next suggestion for every active tenant
  scheduler.schedule(
    'suggest-deals',
    '*/30 7-22 * * *',
    async () => {
      const tenants = await tenantRepo.findAll()
      const parsePrice = (s: string) => parseFloat(s.replace(/[^\d,.]/g, '').replace(',', '.')) || 0
      const pool = getCachedDeals().map(d => ({
        id: d.id,
        title: d.title,
        price: parsePrice(d.price),
        originalPrice: d.originalPrice ? (parsePrice(d.originalPrice) || undefined) : undefined,
        url: d.affiliateUrl,
        imageUrl: d.imageUrl || undefined,
        marketplace: (d.source === 'mercado-livre' ? 'mercadolivre' : d.source) as import('../core/domain/Deal.js').Marketplace,
        category: d.category as string,
        postedAt: new Date(d.publishedAt),
      }))
      for (const tenant of tenants.filter(t => t.active)) {
        try {
          await suggest.execute(tenant, pool)
        } catch (err) {
          console.error(`[suggest-job] error for tenant ${tenant.id}:`, err)
        }
      }
    },
  )

  // Midnight reset — clear rotation cursors for all tenants
  scheduler.schedule(
    'reset-rotation',
    '0 0 * * *',
    async () => {
      const tenants = await tenantRepo.findAll()
      for (const tenant of tenants) {
        try {
          await rotationStore.reset(tenant.id)
        } catch (err) {
          console.error(`[reset-job] error for tenant ${tenant.id}:`, err)
        }
      }
      console.log('[cron] Rotation cursors reset for all tenants')
    },
  )
}
