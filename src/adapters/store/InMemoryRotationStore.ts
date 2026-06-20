import type { RotationStore, RotationCursor } from '../../core/ports/RotationStore.js'

// ---------------------------------------------------------------------------
// InMemoryRotationStore — implements RotationStore port using in-process Map
// Preserves roundRobinIndex/lastSource state across use-case calls within the
// same process lifetime. Suitable for single-instance deployments (Phase 3).
// ---------------------------------------------------------------------------

const DEFAULT_CURSOR: RotationCursor = { roundRobinIndex: 0, lastSource: null }

export class InMemoryRotationStore implements RotationStore {
  private state = new Map<string, RotationCursor>()

  async load(tenantId: string): Promise<RotationCursor> {
    return this.state.get(tenantId) ?? { ...DEFAULT_CURSOR }
  }

  async save(tenantId: string, cursor: RotationCursor): Promise<void> {
    this.state.set(tenantId, { ...cursor })
  }

  async reset(tenantId: string): Promise<void> {
    this.state.set(tenantId, { ...DEFAULT_CURSOR })
  }
}
