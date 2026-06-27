import type { DealRepository } from '../../core/ports/DealRepository.js'

export class InMemoryDealRepository implements DealRepository {
  private sent = new Map<string, Set<string>>()

  async findRecentlySentIds(tenantId: string, _withinDays: number): Promise<Set<string>> {
    return this.sent.get(tenantId) ?? new Set()
  }

  async markAsSent(dealId: string, tenantId: string): Promise<void> {
    if (!this.sent.has(tenantId)) this.sent.set(tenantId, new Set())
    this.sent.get(tenantId)!.add(dealId)
  }
}
