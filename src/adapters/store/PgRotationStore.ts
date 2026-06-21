import { pool as defaultPool } from '../db/pool.js'
import type { Pool } from 'pg'
import type { RotationStore, RotationCursor } from '../../core/ports/RotationStore.js'

// ---------------------------------------------------------------------------
// PgRotationStore — persisted RotationStore backed by rotation_state table
// Uses upsert (ON CONFLICT tenant_id DO UPDATE) so save() is idempotent.
// Accepts an optional pool parameter for testability (tests inject a fake pool).
// ---------------------------------------------------------------------------

export class PgRotationStore implements RotationStore {
  private readonly pool: Pick<Pool, 'query'>

  constructor(pool?: Pick<Pool, 'query'>) {
    this.pool = pool ?? defaultPool
  }

  async load(tenantId: string): Promise<RotationCursor> {
    const { rows } = await this.pool.query<{
      round_robin_index: number
      last_source: string | null
    }>(
      `SELECT round_robin_index, last_source
       FROM rotation_state
       WHERE tenant_id = $1`,
      [tenantId],
    )

    if (rows.length === 0) {
      return { roundRobinIndex: 0, lastSource: null }
    }

    return {
      roundRobinIndex: rows[0].round_robin_index,
      lastSource: rows[0].last_source,
    }
  }

  async save(tenantId: string, cursor: RotationCursor): Promise<void> {
    await this.pool.query(
      `INSERT INTO rotation_state (tenant_id, round_robin_index, last_source, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id) DO UPDATE
         SET round_robin_index = EXCLUDED.round_robin_index,
             last_source       = EXCLUDED.last_source,
             updated_at        = EXCLUDED.updated_at`,
      [tenantId, cursor.roundRobinIndex, cursor.lastSource],
    )
  }

  async reset(tenantId: string): Promise<void> {
    await this.save(tenantId, { roundRobinIndex: 0, lastSource: null })
  }
}
