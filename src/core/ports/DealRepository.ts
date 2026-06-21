export interface DealRepository {
  findRecentlySentIds(tenantId: string, withinDays: number): Promise<Set<string>>
  markAsSent(dealId: string, tenantId: string): Promise<void>
}
