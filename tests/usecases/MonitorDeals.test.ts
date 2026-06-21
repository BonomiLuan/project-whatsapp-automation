import { describe, it, expect, vi } from 'vitest'
import { MonitorDeals } from '../../src/core/usecases/MonitorDeals.js'
import type { DealScraper } from '../../src/core/ports/DealScraper.js'
import type { DealPublisher } from '../../src/core/ports/DealPublisher.js'
import type { DealRepository } from '../../src/core/ports/DealRepository.js'
import type { TenantRepository } from '../../src/core/ports/TenantRepository.js'
import type { Deal } from '../../src/core/domain/Deal.js'
import type { Tenant } from '../../src/core/domain/Tenant.js'

// ── Fixtures ─────────────────────────────────────────────────────────────────

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

function makeFakeScraper(deals: Deal[]): DealScraper {
  return {
    fetchDeals: async (_category?: string) => deals,
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

function makeThrowingPublisher(throwOnDealId: string): DealPublisher & { published: string[] } {
  const published: string[] = []
  return {
    published,
    async publish(deal: Deal, _tenant: Tenant) {
      if (deal.id === throwOnDealId) {
        throw new Error(`Simulated publish failure for ${throwOnDealId}`)
      }
      published.push(deal.id)
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

function makeFakeTenantRepo(tenants: Tenant[]): TenantRepository {
  return {
    async findAll() {
      return tenants
    },
    async findById(id: string) {
      return tenants.find(t => t.id === id) ?? null
    },
    async save(_tenant: Tenant) {
      // no-op
    },
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MonitorDeals', () => {
  it('publishes filtered deals to active tenants', async () => {
    const deal = makeDeal({ id: 'deal-1' })
    const tenant = makeTenant({ id: 'tenant-1', active: true })

    const scraper = makeFakeScraper([deal])
    const publisher = makeFakePublisher()
    const dealRepo = makeFakeDealRepo()
    const tenantRepo = makeFakeTenantRepo([tenant])

    const useCase = new MonitorDeals(scraper, publisher, dealRepo, tenantRepo)
    await useCase.execute()

    expect(publisher.published).toHaveLength(1)
    expect(publisher.published[0].deal.id).toBe('deal-1')
    expect(publisher.published[0].tenant.id).toBe('tenant-1')
  })

  it('skips deals already in recently-sent set (dedupe)', async () => {
    const deal1 = makeDeal({ id: 'deal-1' })
    const deal2 = makeDeal({ id: 'deal-2' })
    const tenant = makeTenant({ id: 'tenant-1', active: true })

    const scraper = makeFakeScraper([deal1, deal2])
    const publisher = makeFakePublisher()
    const dealRepo = makeFakeDealRepo(new Set(['deal-1'])) // deal-1 already sent
    const tenantRepo = makeFakeTenantRepo([tenant])

    const useCase = new MonitorDeals(scraper, publisher, dealRepo, tenantRepo)
    await useCase.execute()

    expect(publisher.published).toHaveLength(1)
    expect(publisher.published[0].deal.id).toBe('deal-2')
  })

  it('publishes before markAsSent (at-least-once ordering)', async () => {
    const deal = makeDeal({ id: 'deal-1' })
    const tenant = makeTenant({ id: 'tenant-1', active: true })

    const calls: string[] = []
    const scraper = makeFakeScraper([deal])
    const publisher: DealPublisher = {
      async publish() {
        calls.push('publish')
      },
    }
    const dealRepo: DealRepository & { markedAsSent: string[] } = {
      markedAsSent: [],
      async findRecentlySentIds() {
        return new Set()
      },
      async markAsSent(dealId: string) {
        calls.push('markAsSent')
        this.markedAsSent.push(dealId)
      },
    }
    const tenantRepo = makeFakeTenantRepo([tenant])

    const useCase = new MonitorDeals(scraper, publisher, dealRepo, tenantRepo)
    await useCase.execute()

    expect(calls).toEqual(['publish', 'markAsSent'])
  })

  it('does not markAsSent when publish throws (failure isolation)', async () => {
    const failingDeal = makeDeal({ id: 'fail-deal' })
    const goodDeal = makeDeal({ id: 'good-deal' })
    const tenant = makeTenant({ id: 'tenant-1', active: true })

    const scraper = makeFakeScraper([failingDeal, goodDeal])
    const publisher = makeThrowingPublisher('fail-deal')
    const dealRepo = makeFakeDealRepo()
    const tenantRepo = makeFakeTenantRepo([tenant])

    const useCase = new MonitorDeals(scraper, publisher, dealRepo, tenantRepo)
    await useCase.execute()

    // The failing deal must NOT be marked as sent
    expect(dealRepo.markedAsSent).not.toContain('fail-deal')
    // The good deal must still be processed
    expect(dealRepo.markedAsSent).toContain('good-deal')
    expect(publisher.published).toContain('good-deal')
  })

  it('skips inactive tenants entirely (zero publish calls)', async () => {
    const deal = makeDeal({ id: 'deal-1' })
    const inactiveTenant = makeTenant({ id: 'tenant-inactive', active: false })

    const scraper = makeFakeScraper([deal])
    const publisher = makeFakePublisher()
    const dealRepo = makeFakeDealRepo()
    const tenantRepo = makeFakeTenantRepo([inactiveTenant])

    const useCase = new MonitorDeals(scraper, publisher, dealRepo, tenantRepo)
    await useCase.execute()

    expect(publisher.published).toHaveLength(0)
  })

  it('continues batch after a deal publish error (per-deal isolation)', async () => {
    const deal1 = makeDeal({ id: 'deal-1' })
    const deal2 = makeDeal({ id: 'deal-2' })
    const deal3 = makeDeal({ id: 'deal-3' })
    const tenant = makeTenant({ id: 'tenant-1', active: true })

    const scraper = makeFakeScraper([deal1, deal2, deal3])
    const publisher = makeThrowingPublisher('deal-2') // only deal-2 fails
    const dealRepo = makeFakeDealRepo()
    const tenantRepo = makeFakeTenantRepo([tenant])

    const useCase = new MonitorDeals(scraper, publisher, dealRepo, tenantRepo)
    await useCase.execute()

    // deal-1 and deal-3 succeed; deal-2 fails but does not abort
    expect(publisher.published).toContain('deal-1')
    expect(publisher.published).not.toContain('deal-2')
    expect(publisher.published).toContain('deal-3')
    expect(dealRepo.markedAsSent).toContain('deal-1')
    expect(dealRepo.markedAsSent).not.toContain('deal-2')
    expect(dealRepo.markedAsSent).toContain('deal-3')
  })
})
