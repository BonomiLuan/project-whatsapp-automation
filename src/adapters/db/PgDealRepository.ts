import { pool } from './pool.js'
import type { DealRepository } from '../../core/ports/DealRepository.js'

// ---------------------------------------------------------------------------
// PgDealRepository — real DealRepository implementation over deal_history table
// The multi-tenant deal_history schema (tenant_id column) lands in Phase 4.
// All queries are wrapped in try/catch so a missing column/table does not crash
// production in Phase 3 — matching the defensive fallback style of PgLinkRepository.
// All user-supplied values use $N parameterized placeholders (no string interpolation).
// ---------------------------------------------------------------------------

export class PgDealRepository implements DealRepository {
  async findRecentlySentIds(tenantId: string, withinDays: number): Promise<Set<string>> {
    try {
      const { rows } = await pool.query<{ deal_id: string }>(
        `SELECT deal_id FROM deal_history
         WHERE (tenant_id = $1 AND sent_at > NOW() - ($2 || ' days')::INTERVAL)
            OR vote = 'dislike'`,
        [tenantId, withinDays]
      )
      return new Set(rows.map(r => r.deal_id))
    } catch (err) {
      console.warn('[PgDealRepository] findRecentlySentIds failed (table may not exist yet):', err)
      return new Set()
    }
  }

  async markAsSent(dealId: string, tenantId: string): Promise<void> {
    try {
      // Use UPDATE+INSERT pattern to avoid relying on a named unique constraint,
      // which may not exist in older production schemas where migration 003 hasn't run.
      await pool.query(
        `WITH upd AS (
           UPDATE deal_history SET sent_at = NOW()
           WHERE deal_id = $1 AND tenant_id = $2
           RETURNING deal_id
         )
         INSERT INTO deal_history (deal_id, tenant_id, sent_at)
         SELECT $1, $2, NOW()
         WHERE NOT EXISTS (SELECT 1 FROM upd)`,
        [dealId, tenantId]
      )
    } catch (err) {
      console.warn('[PgDealRepository] markAsSent failed (table may not exist yet):', err)
    }
  }
}
