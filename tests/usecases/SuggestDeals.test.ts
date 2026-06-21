import { describe, it, expect, vi } from 'vitest'
import { SuggestDeals } from '../../src/core/usecases/SuggestDeals.js'
import type { DealRepository } from '../../src/core/ports/DealRepository.js'
import type { DealPublisher } from '../../src/core/ports/DealPublisher.js'
import type { RotationStore } from '../../src/core/ports/RotationStore.js'
import type { RotationCursor } from '../../src/core/ports/RotationStore.js'
import type { AffiliateLinkBuilder } from '../../src/core/ports/AffiliateLinkBuilder.js'
import type { Deal } from '../../src/core/domain/Deal.js'
import type { Tenant } from '../../src/core/domain/Tenant.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: 'deal-1',
    title: 'Test Deal',
    price: 50,
    url: 'https://example.com',
    marketplace: 'amazon',
    category: 'electronics',
    postedAt: new Date(),
    ...overrides,
  }
}

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'tenant-1',
    name: 'Test Tenant',
    channels: [],
    filters: { keywords: [], excludeKeywords: [], minDiscount: 0, categories: [] },
    affiliates: {},
    active: true,
    ...overrides,
  }
}

// ── Fake ports ────────────────────────────────────────────────────────────────

function makeFakeRotationStore(initialCursor?: RotationCursor): RotationStore & { saved: RotationCursor | null } {
  let cursor: RotationCursor = initialCursor ?? { roundRobinIndex: 0, lastSource: null }
  return {
    saved: null,
    async load(_tenantId: string) {
      return cursor
    },
    async save(_tenantId: string, next: RotationCursor) {
      (this as any).saved = next
      cursor = next
    },
    async reset(_tenantId: string) {
      cursor = { roundRobinIndex: 0, lastSource: null }
    },
  }
}

function makeFakeDealRepo(recentIds: Set<string> = new Set()): DealRepository & { markedAsSent: string[] } {
  const markedAsSent: string[] = []
  return {
    markedAsSent,
    async findRecentlySentIds(_tenantId: string, _withinDays: number) {
      return recentIds
    },
    async markAsSent(dealId: string, _tenantId: string) {
      markedAsSent.push(dealId)
    },
  }
}

function makeFakePublisher(): DealPublisher & { published: Array<{ deal: Deal; tenant: Tenant }> } {
  const published: Array<{ deal: Deal; tenant: Tenant }> = []
  return {
    published,
    async publish(deal: Deal, tenant: Tenant) {
      published.push({ deal, tenant })
    },
  }
}

function makeThrowingPublisher(): DealPublisher {
  return {
    async publish(_deal: Deal, _tenant: Tenant) {
      throw new Error('Simulated publish failure')
    },
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SuggestDeals', () => {
  it('returns early without publish when pool is empty after dedupe', async () => {
    const deal = makeDeal({ id: 'deal-1' })
    const tenant = makeTenant()

    const rotationStore = makeFakeRotationStore()
    const dealRepo = makeFakeDealRepo(new Set(['deal-1'])) // all excluded
    const publisher = makeFakePublisher()

    const useCase = new SuggestDeals(rotationStore, dealRepo, publisher)
    await useCase.execute(tenant, [deal])

    expect(publisher.published).toHaveLength(0)
    expect(dealRepo.markedAsSent).toHaveLength(0)
    expect(rotationStore.saved).toBeNull()
  })

  it('publishes a deal and saves cursor on success', async () => {
    const deal = makeDeal({ id: 'deal-1', category: 'electronics', marketplace: 'amazon' })
    const tenant = makeTenant()

    const rotationStore = makeFakeRotationStore({ roundRobinIndex: 0, lastSource: null })
    const dealRepo = makeFakeDealRepo()
    const publisher = makeFakePublisher()

    const useCase = new SuggestDeals(rotationStore, dealRepo, publisher)
    await useCase.execute(tenant, [deal])

    expect(publisher.published).toHaveLength(1)
    expect(publisher.published[0].deal.id).toBe('deal-1')
    expect(dealRepo.markedAsSent).toContain('deal-1')
    // Cursor must be saved with advanced roundRobinIndex and lastSource set to deal.marketplace
    expect(rotationStore.saved).not.toBeNull()
    expect(rotationStore.saved!.lastSource).toBe('amazon')
    expect(rotationStore.saved!.roundRobinIndex).toBeGreaterThan(0)
  })

  it('does NOT save cursor or markAsSent when publish throws', async () => {
    const deal = makeDeal({ id: 'deal-1', category: 'electronics', marketplace: 'amazon' })
    const tenant = makeTenant()

    const rotationStore = makeFakeRotationStore({ roundRobinIndex: 0, lastSource: null })
    const dealRepo = makeFakeDealRepo()
    const publisher = makeThrowingPublisher()

    const useCase = new SuggestDeals(rotationStore, dealRepo, publisher)
    await expect(useCase.execute(tenant, [deal])).rejects.toThrow()

    expect(dealRepo.markedAsSent).toHaveLength(0)
    expect(rotationStore.saved).toBeNull()
  })

  it('prefers a different source than lastSource (variety)', async () => {
    // Two deals — one from same source as lastSource, one from different
    const sameDeal = makeDeal({ id: 'same-source-deal', marketplace: 'amazon', category: 'electronics' })
    const diffDeal = makeDeal({ id: 'diff-source-deal', marketplace: 'pelando', category: 'electronics' })
    const tenant = makeTenant()

    // Run 10 independent executions each with a fresh store starting at lastSource='amazon'
    // so preferDifferentSource always sees the same initial condition
    const useCase = new SuggestDeals(
      makeFakeRotationStore({ roundRobinIndex: 0, lastSource: null }), // will be overridden per run
      makeFakeDealRepo(),
      makeFakePublisher(),
    )

    const chosenIds: string[] = []
    for (let i = 0; i < 10; i++) {
      const rotationStore = makeFakeRotationStore({ roundRobinIndex: 0, lastSource: 'amazon' })
      const dealRepo = makeFakeDealRepo()
      const publisher = makeFakePublisher()
      const run = new SuggestDeals(rotationStore, dealRepo, publisher)
      await run.execute(tenant, [sameDeal, diffDeal])
      if (publisher.published.length > 0) {
        chosenIds.push(publisher.published[0].deal.id)
      }
    }

    // All 10 independent runs should choose pelando (different source), never amazon
    expect(chosenIds).toHaveLength(10)
    expect(chosenIds.every(id => id === 'diff-source-deal')).toBe(true)
  })

  it('walks categories via nextCategory to pick a deal from the right category', async () => {
    // Pool has deals in two categories; cursor starts at index 0
    const electronicsPool = [
      makeDeal({ id: 'elec-1', category: 'electronics' }),
      makeDeal({ id: 'elec-2', category: 'electronics' }),
    ]
    const fashionPool = [makeDeal({ id: 'fashion-1', category: 'fashion' })]
    const tenant = makeTenant()

    const rotationStore = makeFakeRotationStore({ roundRobinIndex: 0, lastSource: null })
    const dealRepo = makeFakeDealRepo()
    const publisher = makeFakePublisher()

    const useCase = new SuggestDeals(rotationStore, dealRepo, publisher)
    await useCase.execute(tenant, [...electronicsPool, ...fashionPool])

    // Should publish exactly one deal
    expect(publisher.published).toHaveLength(1)
    // Cursor must have advanced
    expect(rotationStore.saved!.roundRobinIndex).toBeGreaterThan(0)
  })

  it('falls back to any available deal when no category matches', async () => {
    // Only deals in 'electronics'; tenant categories is empty (no restriction)
    const deal = makeDeal({ id: 'deal-1', category: 'electronics' })
    const tenant = makeTenant()

    // Force a cursor that skips 'electronics' in the initial pass by starting
    // with a pool that has many categories rotated past
    const rotationStore = makeFakeRotationStore({ roundRobinIndex: 9999, lastSource: null })
    const dealRepo = makeFakeDealRepo()
    const publisher = makeFakePublisher()

    const useCase = new SuggestDeals(rotationStore, dealRepo, publisher)
    await useCase.execute(tenant, [deal])

    // Fallback should still publish the one available deal
    expect(publisher.published).toHaveLength(1)
    expect(publisher.published[0].deal.id).toBe('deal-1')
  })

  it('calls affiliateBuilder.build() when supports() returns true', async () => {
    const originalDeal = makeDeal({ id: 'deal-1', url: 'https://original.com', marketplace: 'amazon' })
    const affiliatedDeal = { ...originalDeal, url: 'AFFILIATE_URL' }
    const tenant = makeTenant()

    const realAffiliate: AffiliateLinkBuilder = {
      supports: vi.fn(() => true),
      build: vi.fn(async () => affiliatedDeal),
    }

    const rotationStore = makeFakeRotationStore()
    const dealRepo = makeFakeDealRepo()
    const publisher = makeFakePublisher()

    const useCase = new SuggestDeals(rotationStore, dealRepo, publisher, realAffiliate)
    await useCase.execute(tenant, [originalDeal])

    expect(realAffiliate.supports).toHaveBeenCalledWith('amazon')
    expect(realAffiliate.build).toHaveBeenCalledOnce()
    // Publisher must receive the affiliated deal (with AFFILIATE_URL)
    expect(publisher.published).toHaveLength(1)
    expect(publisher.published[0].deal.url).toBe('AFFILIATE_URL')
  })

  it('does NOT modify deal when affiliateBuilder.supports() returns false', async () => {
    const originalDeal = makeDeal({ id: 'deal-1', url: 'https://original.com', marketplace: 'amazon' })
    const tenant = makeTenant()

    const noopAffiliate: AffiliateLinkBuilder = {
      supports: vi.fn(() => false),
      build: vi.fn(async (deal) => deal),
    }

    const rotationStore = makeFakeRotationStore()
    const dealRepo = makeFakeDealRepo()
    const publisher = makeFakePublisher()

    const useCase = new SuggestDeals(rotationStore, dealRepo, publisher, noopAffiliate)
    await useCase.execute(tenant, [originalDeal])

    expect(noopAffiliate.supports).toHaveBeenCalledWith('amazon')
    expect(noopAffiliate.build).not.toHaveBeenCalled()
    // Publisher must receive the original deal unchanged
    expect(publisher.published).toHaveLength(1)
    expect(publisher.published[0].deal.url).toBe('https://original.com')
  })
})
