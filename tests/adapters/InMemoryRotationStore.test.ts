import { describe, it, expect } from 'vitest'
import { InMemoryRotationStore } from '../../src/adapters/store/InMemoryRotationStore.js'

describe('InMemoryRotationStore', () => {
  it('load returns {roundRobinIndex:0, lastSource:null} for unknown tenantId', async () => {
    const store = new InMemoryRotationStore()
    const cursor = await store.load('tenant-unknown')
    expect(cursor).toEqual({ roundRobinIndex: 0, lastSource: null })
  })

  it('save then load round-trips the cursor for the same tenantId', async () => {
    const store = new InMemoryRotationStore()
    await store.save('tenant-1', { roundRobinIndex: 3, lastSource: 'shopee' })
    const cursor = await store.load('tenant-1')
    expect(cursor).toEqual({ roundRobinIndex: 3, lastSource: 'shopee' })
  })

  it('isolates cursors between different tenantIds', async () => {
    const store = new InMemoryRotationStore()
    await store.save('tenant-a', { roundRobinIndex: 5, lastSource: 'amazon' })
    const cursorB = await store.load('tenant-b')
    expect(cursorB).toEqual({ roundRobinIndex: 0, lastSource: null })
  })

  it('reset sets cursor back to {roundRobinIndex:0, lastSource:null}', async () => {
    const store = new InMemoryRotationStore()
    await store.save('tenant-1', { roundRobinIndex: 7, lastSource: 'ml' })
    await store.reset('tenant-1')
    const cursor = await store.load('tenant-1')
    expect(cursor).toEqual({ roundRobinIndex: 0, lastSource: null })
  })
})
