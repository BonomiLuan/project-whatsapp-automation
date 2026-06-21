import { describe, it, expect, vi } from 'vitest'
import { PgRotationStore } from '../../src/adapters/store/PgRotationStore.js'

// ── Fake pool helpers ─────────────────────────────────────────────────────────

function makeFakePool(rowsOrRows: Record<string, unknown>[][] = []) {
  let callIndex = 0
  const query = vi.fn(async () => {
    const rows = rowsOrRows[callIndex++] ?? []
    return { rows }
  })
  return { query }
}

function emptyPool() {
  return makeFakePool([[]])
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PgRotationStore', () => {
  it('load() returns default cursor when no row exists for tenantId', async () => {
    const fakePool = emptyPool()
    const store = new PgRotationStore(fakePool as any)

    const cursor = await store.load('t1')

    expect(cursor).toEqual({ roundRobinIndex: 0, lastSource: null })
    expect(fakePool.query).toHaveBeenCalledOnce()
    expect(fakePool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT'),
      ['t1'],
    )
  })

  it('save() then load() returns the saved cursor', async () => {
    const fakePool = makeFakePool([
      // rows returned by save (INSERT ... ON CONFLICT)
      [],
      // rows returned by load (SELECT)
      [{ round_robin_index: 3, last_source: 'amazon' }],
    ])
    const store = new PgRotationStore(fakePool as any)

    await store.save('t1', { roundRobinIndex: 3, lastSource: 'amazon' })
    const cursor = await store.load('t1')

    expect(cursor).toEqual({ roundRobinIndex: 3, lastSource: 'amazon' })
  })

  it('save() twice for same tenantId: upsert SQL is called each time (no duplicate rows)', async () => {
    const fakePool = makeFakePool([[], []])
    const store = new PgRotationStore(fakePool as any)

    await store.save('t1', { roundRobinIndex: 1, lastSource: 'ml' })
    await store.save('t1', { roundRobinIndex: 2, lastSource: 'shopee' })

    // Both calls must hit the same ON CONFLICT upsert
    expect(fakePool.query).toHaveBeenCalledTimes(2)
    const [, args1] = fakePool.query.mock.calls[0] as [string, unknown[]]
    const [, args2] = fakePool.query.mock.calls[1] as [string, unknown[]]
    // Both target same tenantId
    expect(args1[0]).toBe('t1')
    expect(args2[0]).toBe('t1')
    // SQL must contain ON CONFLICT
    const [sql1] = fakePool.query.mock.calls[0] as [string, unknown[]]
    expect(sql1).toMatch(/ON CONFLICT/)
  })

  it('reset() after save: load returns default cursor', async () => {
    const fakePool = makeFakePool([
      // reset() calls save() internally → rows from that upsert
      [],
      // subsequent load()
      [{ round_robin_index: 0, last_source: null }],
    ])
    const store = new PgRotationStore(fakePool as any)

    await store.reset('t1')
    const cursor = await store.load('t1')

    expect(cursor).toEqual({ roundRobinIndex: 0, lastSource: null })
  })

  it('load() for different tenantIds uses correct tenantId parameter', async () => {
    const fakePool = makeFakePool([
      [{ round_robin_index: 5, last_source: 'pelando' }],
      [{ round_robin_index: 1, last_source: 'amazon' }],
    ])
    const store = new PgRotationStore(fakePool as any)

    const cursorA = await store.load('tenant-a')
    const cursorB = await store.load('tenant-b')

    expect(cursorA).toEqual({ roundRobinIndex: 5, lastSource: 'pelando' })
    expect(cursorB).toEqual({ roundRobinIndex: 1, lastSource: 'amazon' })

    // Each call uses the right tenantId as parameter
    expect(fakePool.query.mock.calls[0][1]).toEqual(['tenant-a'])
    expect(fakePool.query.mock.calls[1][1]).toEqual(['tenant-b'])
  })
})
