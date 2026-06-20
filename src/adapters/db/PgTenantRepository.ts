import { pool } from './pool.js'
import type { Tenant } from '../../core/domain/Tenant.js'
import type { TenantRepository } from '../../core/ports/TenantRepository.js'

// ---------------------------------------------------------------------------
// PgTenantRepository — real TenantRepository implementation over tenants table
// The tenants table lands in Phase 4. All queries are wrapped in defensive
// try/catch so a missing table does not crash production at boot in Phase 3.
// All user-supplied values use $N parameterized placeholders (no string interpolation).
// ---------------------------------------------------------------------------

// Map a raw DB row to the Tenant domain type.
// Channels, filters, and affiliates default to empty/neutral values when their
// related tables or columns are absent (Phase 3 safety).
function rowToTenant(row: Record<string, unknown>): Tenant {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    active: row['active'] !== undefined ? Boolean(row['active']) : true,
    channels: Array.isArray(row['channels']) ? row['channels'] as Tenant['channels'] : [],
    filters: (row['filters'] as Tenant['filters']) ?? { minDiscount: 0, categories: [], sources: [] },
    affiliates: (row['affiliates'] as Tenant['affiliates']) ?? {},
  }
}

export class PgTenantRepository implements TenantRepository {
  async findAll(): Promise<Tenant[]> {
    try {
      const { rows } = await pool.query<Record<string, unknown>>(
        `SELECT id, name, active, channels, filters, affiliates FROM tenants WHERE active = true`
      )
      return rows.map(rowToTenant)
    } catch (err) {
      console.warn('[PgTenantRepository] findAll failed (table may not exist yet):', err)
      return []
    }
  }

  async findById(id: string): Promise<Tenant | null> {
    try {
      const { rows } = await pool.query<Record<string, unknown>>(
        `SELECT id, name, active, channels, filters, affiliates FROM tenants WHERE id = $1`,
        [id]
      )
      return rows[0] ? rowToTenant(rows[0]) : null
    } catch (err) {
      console.warn('[PgTenantRepository] findById failed (table may not exist yet):', err)
      return null
    }
  }

  async save(tenant: Tenant): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO tenants (id, name, active, channels, filters, affiliates)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE
           SET name       = EXCLUDED.name,
               active     = EXCLUDED.active,
               channels   = EXCLUDED.channels,
               filters    = EXCLUDED.filters,
               affiliates = EXCLUDED.affiliates`,
        [
          tenant.id,
          tenant.name,
          tenant.active,
          JSON.stringify(tenant.channels),
          JSON.stringify(tenant.filters),
          JSON.stringify(tenant.affiliates),
        ]
      )
    } catch (err) {
      console.warn('[PgTenantRepository] save failed (table may not exist yet):', err)
    }
  }
}
