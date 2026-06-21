import type { Deal } from '../domain/Deal.js'
import type { Filter } from '../domain/Filter.js'

/**
 * Pure function: filters a list of deals according to the given filter criteria.
 * No IO, no side effects, no mutable module-level state.
 */
export function filterDeals(deals: Deal[], filter: Filter): Deal[] {
  return deals.filter(deal => {
    // Category gate: if categories list is non-empty, deal's category must be in the list
    if (filter.categories.length > 0 && !filter.categories.includes(deal.category)) {
      return false
    }

    const titleLower = deal.title.toLowerCase()

    // Exclude keywords gate: remove deals whose title contains any excluded token (case-insensitive substring)
    for (const token of (filter.excludeKeywords ?? [])) {
      if (titleLower.includes(token.toLowerCase())) {
        return false
      }
    }

    // Keyword inclusion gate: if keywords list is non-empty, at least one must appear in title
    if ((filter.keywords ?? []).length > 0) {
      const matchesKeyword = (filter.keywords ?? []).some(kw => titleLower.includes(kw.toLowerCase()))
      if (!matchesKeyword) return false
    }

    // Min discount gate: only applies to deals with an originalPrice
    if (filter.minDiscount > 0 && deal.originalPrice !== undefined) {
      const discount = ((deal.originalPrice - deal.price) / deal.originalPrice) * 100
      if (discount < filter.minDiscount) return false
    }

    return true
  })
}
