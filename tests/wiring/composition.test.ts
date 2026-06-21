/**
 * Wiring smoke test — verifies the composition root registers the expected job names.
 *
 * Uses fake implementations of all ports so no live DB, network, or cron fires.
 * server.ts is NOT imported here (would start Express/bot at import time).
 */

import { describe, it, expect, vi } from 'vitest'
import type { Scheduler } from '../../src/core/ports/Scheduler.js'
import type { Lock } from '../../src/core/ports/Lock.js'
import type { RotationStore, RotationCursor } from '../../src/core/ports/RotationStore.js'
import type { DealRepository } from '../../src/core/ports/DealRepository.js'
import type { DealPublisher } from '../../src/core/ports/DealPublisher.js'
import type { DealScraper } from '../../src/core/ports/DealScraper.js'
import type { TenantRepository } from '../../src/core/ports/TenantRepository.js'
import type { Tenant } from '../../src/core/domain/Tenant.js'
import { MonitorDeals } from '../../src/core/usecases/MonitorDeals.js'
import { SuggestDeals } from '../../src/core/usecases/SuggestDeals.js'
import { registerPelandoMonitor } from '../../src/jobs/monitorPelando.js'
import { registerMLMonitor } from '../../src/jobs/monitorML.js'
import { registerSuggestionJobs } from '../../src/jobs/cronLock.js'

// ── Fake Scheduler — records scheduled job names without firing cron ───────────

class FakeScheduler implements Scheduler {
  readonly scheduled: Array<{ name: string; cron: string }> = []

  schedule(name: string, cron: string, _job: () => Promise<void>): void {
    this.scheduled.push({ name, cron })
  }
}

// ── Fake Lock — passes through ────────────────────────────────────────────────

const fakeLock: Lock = {
  withLock: <T>(_key: string, fn: () => Promise<T>) => fn(),
}

// ── Fake RotationStore ────────────────────────────────────────────────────────

const fakeRotationStore: RotationStore = {
  load: async (_tenantId: string): Promise<RotationCursor> => ({ roundRobinIndex: 0, lastSource: null }),
  save: async (_tenantId: string, _cursor: RotationCursor): Promise<void> => void 0,
  reset: async (_tenantId: string): Promise<void> => void 0,
}

// ── Fake DealRepository ───────────────────────────────────────────────────────

const fakeDealRepo: DealRepository = {
  findRecentlySentIds: async (_tenantId: string, _withinDays: number): Promise<Set<string>> => new Set(),
  markAsSent: async (_dealId: string, _tenantId: string): Promise<void> => void 0,
}

// ── Fake DealPublisher ────────────────────────────────────────────────────────

const fakePublisher: DealPublisher = {
  publish: vi.fn().mockResolvedValue(undefined),
}

// ── Fake DealScraper ──────────────────────────────────────────────────────────

const fakeScraper: DealScraper = {
  fetchDeals: async (_category?: string) => [],
}

// ── Fake TenantRepository ─────────────────────────────────────────────────────

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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('composition root wiring', () => {
  it('registerPelandoMonitor schedules the pelando-monitor job', () => {
    const scheduler = new FakeScheduler()
    const monitor = new MonitorDeals(fakeScraper, fakePublisher, fakeDealRepo, fakeTenantRepo)

    registerPelandoMonitor(scheduler, fakeLock, monitor)

    expect(scheduler.scheduled).toHaveLength(1)
    expect(scheduler.scheduled[0].name).toBe('pelando-monitor')
    expect(scheduler.scheduled[0].cron).toBe('0 8-22/2 * * *')
  })

  it('registerMLMonitor schedules the ml-monitor job', () => {
    const scheduler = new FakeScheduler()
    const monitor = new MonitorDeals(fakeScraper, fakePublisher, fakeDealRepo, fakeTenantRepo)

    registerMLMonitor(scheduler, fakeLock, monitor)

    expect(scheduler.scheduled).toHaveLength(1)
    expect(scheduler.scheduled[0].name).toBe('ml-monitor')
    expect(scheduler.scheduled[0].cron).toBe('*/30 * * * *')
  })

  it('registerSuggestionJobs schedules suggest-deals and reset-rotation', () => {
    const scheduler = new FakeScheduler()
    const suggest = new SuggestDeals(fakeRotationStore, fakeDealRepo, fakePublisher)

    registerSuggestionJobs(scheduler, suggest, fakeRotationStore, fakeTenantRepo)

    const names = scheduler.scheduled.map(s => s.name)
    expect(names).toContain('suggest-deals')
    expect(names).toContain('reset-rotation')
    expect(scheduler.scheduled.find(s => s.name === 'suggest-deals')?.cron).toBe('*/15 7-22 * * *')
    expect(scheduler.scheduled.find(s => s.name === 'reset-rotation')?.cron).toBe('0 0 * * *')
  })

  it('all three registrations together schedule exactly 4 jobs', () => {
    const scheduler = new FakeScheduler()
    const monitor = new MonitorDeals(fakeScraper, fakePublisher, fakeDealRepo, fakeTenantRepo)
    const suggest = new SuggestDeals(fakeRotationStore, fakeDealRepo, fakePublisher)

    registerPelandoMonitor(scheduler, fakeLock, monitor)
    registerMLMonitor(scheduler, fakeLock, monitor)
    registerSuggestionJobs(scheduler, suggest, fakeRotationStore, fakeTenantRepo)

    expect(scheduler.scheduled).toHaveLength(4)
    expect(scheduler.scheduled.map(s => s.name)).toEqual([
      'pelando-monitor',
      'ml-monitor',
      'suggest-deals',
      'reset-rotation',
    ])
  })
})
