import type { RotationStore, RotationCursor } from '../ports/RotationStore.js'
import type { DealRepository } from '../ports/DealRepository.js'
import type { DealPublisher } from '../ports/DealPublisher.js'
import type { Deal } from '../domain/Deal.js'
import type { Tenant } from '../domain/Tenant.js'
import { nextCategory, preferDifferentSource } from './CategoryRotation.js'

/**
 * SuggestDeals orchestrates the rotating-showcase pipeline:
 *   dedupe → load cursor → walk categories (nextCategory) → source variety
 *   (preferDifferentSource) → random pick → publish → markAsSent → save cursor
 *
 * Invariants:
 *   - Cursor advances ONLY on a successful publish (at-least-once for cursor state).
 *   - Neither markAsSent nor rotationStore.save is called when publish throws.
 *   - Returns early (no publish, no cursor save) when nothing is available after dedupe.
 *   - The timing-lock (advisory slot claim) is a job/lock concern — NOT in this use case.
 *   - No imports from adapters/, web/, or jobs/; all IO goes through injected ports.
 */
export class SuggestDeals {
  constructor(
    private readonly rotationStore: RotationStore,
    private readonly dealRepo: DealRepository,
    private readonly publisher: DealPublisher,
  ) {}

  async execute(tenant: Tenant, pool: Deal[]): Promise<void> {
    // 1. Dedupe: exclude deals already sent within the last 7 days
    const excluded = await this.dealRepo.findRecentlySentIds(tenant.id, 7)
    const available = pool.filter(d => !excluded.has(d.id))

    if (available.length === 0) return

    // 2. Load rotation cursor
    const cursor = await this.rotationStore.load(tenant.id)

    // 3. Walk categories via nextCategory until we find one with available deals
    //    Derive the ordered category list from the available pool (unique, insertion-ordered)
    const allCategories = [...new Set(available.map(d => d.category))]

    let deal: Deal | undefined
    let finalCursor: RotationCursor = cursor
    let attempts = 0

    while (!deal && attempts < allCategories.length) {
      const { category, nextCursor } = nextCategory(finalCursor, allCategories)
      finalCursor = nextCursor
      attempts++

      const categoryPool = available.filter(d => d.category === category)
      if (categoryPool.length > 0) {
        // Apply source-variety filter to the category pool
        const candidates = preferDifferentSource(categoryPool, cursor.lastSource)
        // Random pick within the chosen pool
        deal = candidates[Math.floor(Math.random() * candidates.length)]
      }
    }

    // 4. Fallback: pick any available deal when no category matched
    if (!deal) {
      const candidates = preferDifferentSource(available, cursor.lastSource)
      deal = candidates[Math.floor(Math.random() * candidates.length)]
    }

    if (!deal) return

    // 5. Publish → markAsSent → save cursor (all three only on success)
    //    If publish throws, neither markAsSent nor save is called
    await this.publisher.publish(deal, tenant)
    await this.dealRepo.markAsSent(deal.id, tenant.id)
    await this.rotationStore.save(tenant.id, {
      roundRobinIndex: finalCursor.roundRobinIndex,
      lastSource: deal.marketplace,
    })
  }
}
