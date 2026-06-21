import type { Deal } from '../domain/Deal.js'

export interface DealScraper {
  fetchDeals(category?: string): Promise<Deal[]>
}
