import type { DealScraper } from '../ports/DealScraper.js'
import type { DealPublisher } from '../ports/DealPublisher.js'
import type { DealRepository } from '../ports/DealRepository.js'
import type { TenantRepository } from '../ports/TenantRepository.js'
import { filterDeals } from './FilterDeals.js'

/**
 * MonitorDeals orchestrates the deal-monitoring pipeline:
 *   scrape → dedupe → filter → publish → markAsSent
 *
 * Invariants:
 *   - publish is called BEFORE markAsSent (at-least-once delivery).
 *   - A failed publish for one deal does NOT abort the rest of the batch.
 *   - markAsSent is never called when publish throws.
 *   - Inactive tenants receive zero publish calls.
 *   - No imports from adapters/, web/, or jobs/; all IO goes through injected ports.
 */
export class MonitorDeals {
  constructor(
    private readonly scraper: DealScraper,
    private readonly publisher: DealPublisher,
    private readonly dealRepo: DealRepository,
    private readonly tenantRepo: TenantRepository,
  ) {}

  async execute(category?: string): Promise<void> {
    const deals = await this.scraper.fetchDeals(category)
    const tenants = await this.tenantRepo.findAll()

    for (const tenant of tenants.filter(t => t.active)) {
      const sentIds = await this.dealRepo.findRecentlySentIds(tenant.id, 7)

      // Exclude already-sent deals, then apply tenant filters
      const fresh = deals.filter(d => !sentIds.has(d.id))
      const filtered = filterDeals(fresh, tenant.filters)

      for (const deal of filtered) {
        // Per-deal isolation: a single failure must not abort the whole tenant batch
        try {
          await this.publisher.publish(deal, tenant)
          // markAsSent AFTER publish → at-least-once: prefer re-send over drop
          await this.dealRepo.markAsSent(deal.id, tenant.id)
        } catch (err) {
          console.error('[MonitorDeals] error publishing deal:', err)
        }
      }
    }
  }
}
