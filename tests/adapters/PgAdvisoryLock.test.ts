import { describe, it, expect } from 'vitest'
import { hashKey, PgAdvisoryLock } from '../../src/adapters/lock/PgAdvisoryLock.js'

describe('hashKey', () => {
  it('returns the same integer for the same key (deterministic)', () => {
    const a = hashKey('monitor:pelando')
    const b = hashKey('monitor:pelando')
    expect(a).toBe(b)
  })

  it('returns different integers for different keys', () => {
    expect(hashKey('monitor:pelando')).not.toBe(hashKey('monitor:shopee'))
  })

  it('returns a non-negative integer in [0, 2^31)', () => {
    const val = hashKey('monitor:pelando')
    expect(Number.isInteger(val)).toBe(true)
    expect(val).toBeGreaterThanOrEqual(0)
    expect(val).toBeLessThan(2 ** 31)
  })

  it('returns 0 or positive for empty string', () => {
    const val = hashKey('')
    expect(val).toBeGreaterThanOrEqual(0)
    expect(val).toBeLessThan(2 ** 31)
  })
})

describe('PgAdvisoryLock.withLock (no DB — uses fn directly via overriding)', () => {
  it('calls fn and returns its result when lock is acquired', async () => {
    const lock = new PgAdvisoryLock()
    // Bypass DB by monkey-patching withCronLock-like behaviour: we call fn directly
    // withLock will attempt to use withCronLock which needs DATABASE_URL.
    // When DATABASE_URL is absent, withCronLock calls fn() directly.
    const original = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      const result = await lock.withLock('test:key', async () => 42)
      expect(result).toBe(42)
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original
    }
  })
})
