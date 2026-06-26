import { describe, it, expect, vi } from 'vitest'
import type { Scheduler } from '../../src/core/ports/Scheduler.js'
import type { RotationStore, RotationCursor } from '../../src/core/ports/RotationStore.js'
import type { DealRepository } from '../../src/core/ports/DealRepository.js'
import type { DealPublisher } from '../../src/core/ports/DealPublisher.js'
import type { TenantRepository } from '../../src/core/ports/TenantRepository.js'
import type { Tenant } from '../../src/core/domain/Tenant.js'
import { SuggestDeals } from '../../src/core/usecases/SuggestDeals.js'
import { registerSuggestionJobs } from '../../src/jobs/cronLock.js'

class FakeScheduler implements Scheduler {
  readonly scheduled: Array<{ name: string; cron: string }> = []
  schedule(name: string, cron: string, _job: () => Promise<void>): void {
    this.scheduled.push({ name, cron })
  }
}

const fakeRotationStore: RotationStore = {
  load: async (_tenantId: string): Promise<RotationCursor> => ({ roundRobinIndex: 0, lastSource: null }),
  save: async (_tenantId: string, _cursor: RotationCursor): Promise<void> => void 0,
  reset: async (_tenantId: string): Promise<void> => void 0,
}

const fakeDealRepo: DealRepository = {
  findRecentlySentIds: async (_tenantId: string, _withinDays: number): Promise<Set<string>> => new Set(),
  markAsSent: async (_dealId: string, _tenantId: string): Promise<void> => void 0,
}

const fakePublisher: DealPublisher = {
  publish: vi.fn().mockResolvedValue(undefined),
}

const fakeTenant: Tenant = {
  id: 'tenant-1',
  name: 'Test Tenant',
  active: true,
  channels: [],
  filters: { keywords: [], excludeKeywords: [], minDiscount: 0, categories: [] },
  affiliates: {},
}

const fakeTenantRepo: TenantRepository = {
  findAll: async (): Promise<Tenant[]> => [fakeTenant],
  findById: async (_id: string): Promise<Tenant | null> => null,
  save: async (_tenant: Tenant): Promise<void> => void 0,
}

describe('composition root wiring', () => {
  it('registerSuggestionJobs schedules suggest-deals and reset-rotation', () => {
    const scheduler = new FakeScheduler()
    const suggest = new SuggestDeals(fakeRotationStore, fakeDealRepo, fakePublisher)

    registerSuggestionJobs(scheduler, suggest, fakeRotationStore, fakeTenantRepo)

    const names = scheduler.scheduled.map(s => s.name)
    expect(names).toContain('suggest-deals')
    expect(names).toContain('reset-rotation')
    expect(scheduler.scheduled.find(s => s.name === 'suggest-deals')?.cron).toBe('*/30 7-22 * * *')
    expect(scheduler.scheduled.find(s => s.name === 'reset-rotation')?.cron).toBe('0 0 * * *')
  })
})
