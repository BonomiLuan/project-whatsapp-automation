export const SEEN_TTL_DAYS = 5

export class ShownDealsTracker {
  // category → dealId → timestamp (ms) quando foi exibido
  private store = new Map<string, Map<string, number>>()

  markShown(category: string, dealIds: string[]): void {
    if (!this.store.has(category)) this.store.set(category, new Map())
    const cat = this.store.get(category)!
    const now = Date.now()
    for (const id of dealIds) cat.set(id, now)
  }

  filterUnseen<T>(
    category: string,
    deals: T[],
    getId: (d: T) => string,
    ttlDays = SEEN_TTL_DAYS,
  ): T[] {
    const cat = this.store.get(category)
    if (!cat) return deals

    const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000
    // lazy eviction: remove entradas expiradas ao filtrar
    for (const [id, seenAt] of cat) {
      if (seenAt <= cutoff) cat.delete(id)
    }

    return deals.filter(d => !cat.has(getId(d)))
  }

  resetCategory(category?: string): number {
    if (category !== undefined) {
      const cat = this.store.get(category)
      if (!cat) return 0
      const count = cat.size
      cat.clear()
      return count
    }
    let total = 0
    for (const cat of this.store.values()) total += cat.size
    this.store.clear()
    return total
  }
}

export const shownDealsTracker = new ShownDealsTracker()
