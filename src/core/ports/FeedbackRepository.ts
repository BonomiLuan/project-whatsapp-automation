import type { Deal } from '../domain/Deal.js'

export type CategoryStats = Record<string, { likes: number; dislikes: number }>

export interface FeedbackRepository {
  record(deal: Deal, tenantId: string, userId: string, reaction: 'like' | 'dislike'): Promise<void>
  statsByCategory(tenantId: string): Promise<CategoryStats>
}
