import type { DealRepository } from '../../core/ports/DealRepository.js'

// ---------------------------------------------------------------------------
// PgDealRepository — Phase-3 stub implementing DealRepository port
// Full implementation deferred to Phase 3 (deal-history migration)
// ---------------------------------------------------------------------------

export class PgDealRepository implements DealRepository {
  findRecentlySentIds(_tenantId: string, _withinDays: number): Promise<Set<string>> {
    throw new Error('Not implemented — Phase 3')
  }

  markAsSent(_dealId: string, _tenantId: string): Promise<void> {
    throw new Error('Not implemented — Phase 3')
  }
}
