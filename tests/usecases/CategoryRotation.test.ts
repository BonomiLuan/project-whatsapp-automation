import { describe, it, expect } from 'vitest'
import { nextCategory, preferDifferentSource } from '../../src/core/usecases/CategoryRotation.js'
import type { RotationCursor } from '../../src/core/ports/RotationStore.js'

describe('nextCategory', () => {
  it('returns first category and increments roundRobinIndex from 0', () => {
    const cursor: RotationCursor = { roundRobinIndex: 0, lastSource: null }
    const { category, nextCursor } = nextCategory(cursor, ['a', 'b', 'c'])
    expect(category).toBe('a')
    expect(nextCursor.roundRobinIndex).toBe(1)
  })

  it('wraps around when roundRobinIndex equals number of categories', () => {
    const cursor: RotationCursor = { roundRobinIndex: 3, lastSource: null }
    const { category, nextCursor } = nextCategory(cursor, ['a', 'b', 'c'])
    expect(category).toBe('a')
    expect(nextCursor.roundRobinIndex).toBe(4)
  })

  it('preserves lastSource unchanged in nextCursor', () => {
    const cursor: RotationCursor = { roundRobinIndex: 1, lastSource: 'shopee' }
    const { nextCursor } = nextCategory(cursor, ['a', 'b', 'c'])
    expect(nextCursor.lastSource).toBe('shopee')
  })

  it('does not mutate the input cursor', () => {
    const cursor: RotationCursor = { roundRobinIndex: 0, lastSource: null }
    nextCategory(cursor, ['a', 'b', 'c'])
    expect(cursor.roundRobinIndex).toBe(0)
  })
})

describe('preferDifferentSource', () => {
  it('returns candidates unchanged when lastSource is null', () => {
    const candidates = [
      { marketplace: 'shopee', id: '1' },
      { marketplace: 'amazon', id: '2' },
    ]
    const result = preferDifferentSource(candidates, null)
    expect(result).toEqual(candidates)
  })

  it('filters out candidates sharing lastSource when alternatives exist', () => {
    const candidates = [
      { marketplace: 'shopee', id: '1' },
      { marketplace: 'amazon', id: '2' },
      { marketplace: 'shopee', id: '3' },
    ]
    const result = preferDifferentSource(candidates, 'shopee')
    expect(result.map(c => c.id)).toEqual(['2'])
  })

  it('returns original candidates when ALL share the same lastSource', () => {
    const candidates = [
      { marketplace: 'shopee', id: '1' },
      { marketplace: 'shopee', id: '2' },
    ]
    const result = preferDifferentSource(candidates, 'shopee')
    expect(result).toEqual(candidates)
  })

  it('returns all candidates when none match lastSource', () => {
    const candidates = [
      { marketplace: 'amazon', id: '1' },
      { marketplace: 'mercadolivre', id: '2' },
    ]
    const result = preferDifferentSource(candidates, 'shopee')
    expect(result).toEqual(candidates)
  })

  it('works with empty candidate list', () => {
    const result = preferDifferentSource([], 'shopee')
    expect(result).toEqual([])
  })

  it('does not mutate the input candidates array', () => {
    const candidates = [{ marketplace: 'shopee', id: '1' }]
    preferDifferentSource(candidates, 'amazon')
    expect(candidates).toHaveLength(1)
  })
})
