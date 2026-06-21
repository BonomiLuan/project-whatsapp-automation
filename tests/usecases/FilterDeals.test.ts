import { describe, it, expect } from 'vitest'
import { filterDeals } from '../../src/core/usecases/FilterDeals.js'
import type { Deal } from '../../src/core/domain/Deal.js'
import type { Filter } from '../../src/core/domain/Filter.js'

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: 'deal-1',
    title: 'Produto Teste',
    price: 100,
    originalPrice: undefined,
    url: 'https://example.com/deal-1',
    imageUrl: undefined,
    couponCode: undefined,
    marketplace: 'amazon',
    category: 'eletronicos',
    postedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

const emptyFilter: Filter = {
  keywords: [],
  excludeKeywords: [],
  minDiscount: 0,
  categories: [],
}

describe('filterDeals', () => {
  it('empty filter returns all deals unchanged', () => {
    const deals: Deal[] = [makeDeal({ id: '1' }), makeDeal({ id: '2' }), makeDeal({ id: '3' })]
    const result = filterDeals(deals, emptyFilter)
    expect(result).toHaveLength(3)
    expect(result.map(d => d.id)).toEqual(['1', '2', '3'])
  })

  it('filters deals by category when categories list is non-empty', () => {
    const deals: Deal[] = [
      makeDeal({ id: '1', category: 'eletronicos' }),
      makeDeal({ id: '2', category: 'moda' }),
      makeDeal({ id: '3', category: 'eletronicos' }),
    ]
    const filter: Filter = { ...emptyFilter, categories: ['eletronicos'] }
    const result = filterDeals(deals, filter)
    expect(result.map(d => d.id)).toEqual(['1', '3'])
  })

  it('removes deals whose title contains an excluded keyword (case-insensitive)', () => {
    const deals: Deal[] = [
      makeDeal({ id: '1', title: 'Notebook Samsung' }),
      makeDeal({ id: '2', title: 'Assinatura Amazon Prime por R$10' }),
      makeDeal({ id: '3', title: 'Só no App: iPhone 14 com desconto' }),
    ]
    const filter: Filter = { ...emptyFilter, excludeKeywords: ['prime', 'só no app'] }
    const result = filterDeals(deals, filter)
    expect(result.map(d => d.id)).toEqual(['1'])
  })

  it('keeps only deals matching at least one keyword when keywords list is non-empty', () => {
    const deals: Deal[] = [
      makeDeal({ id: '1', title: 'Smartphone Samsung Galaxy' }),
      makeDeal({ id: '2', title: 'Camiseta Polo' }),
      makeDeal({ id: '3', title: 'iPhone 15 Pro' }),
    ]
    const filter: Filter = { ...emptyFilter, keywords: ['samsung', 'iphone'] }
    const result = filterDeals(deals, filter)
    expect(result.map(d => d.id)).toEqual(['1', '3'])
  })

  it('removes deals below minDiscount when originalPrice is present', () => {
    const deals: Deal[] = [
      makeDeal({ id: '1', price: 80, originalPrice: 100 }), // 20% discount — should pass
      makeDeal({ id: '2', price: 95, originalPrice: 100 }), // 5% discount — should fail
      makeDeal({ id: '3', price: 50, originalPrice: 100 }), // 50% discount — should pass
    ]
    const filter: Filter = { ...emptyFilter, minDiscount: 15 }
    const result = filterDeals(deals, filter)
    expect(result.map(d => d.id)).toEqual(['1', '3'])
  })

  it('deals without originalPrice pass the discount gate regardless of minDiscount', () => {
    const deals: Deal[] = [
      makeDeal({ id: '1', price: 100, originalPrice: undefined }), // no originalPrice — passes
      makeDeal({ id: '2', price: 99, originalPrice: 100 }),         // 1% discount — fails 15% gate
    ]
    const filter: Filter = { ...emptyFilter, minDiscount: 15 }
    const result = filterDeals(deals, filter)
    expect(result.map(d => d.id)).toEqual(['1'])
  })

  it('preserves input order (deterministic output)', () => {
    const deals: Deal[] = [
      makeDeal({ id: 'c', title: 'C deal' }),
      makeDeal({ id: 'a', title: 'A deal' }),
      makeDeal({ id: 'b', title: 'B deal' }),
    ]
    const result = filterDeals(deals, emptyFilter)
    expect(result.map(d => d.id)).toEqual(['c', 'a', 'b'])
  })
})
