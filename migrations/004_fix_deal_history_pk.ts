import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Normalise tenant_id for rows inserted before multi-tenancy
  pgm.sql(`UPDATE deal_history SET tenant_id = 'default' WHERE tenant_id IS NULL OR tenant_id = ''`)

  // Remove duplicates — keep the latest sent_at per (deal_id, tenant_id)
  pgm.sql(`
    DELETE FROM deal_history dh1
    USING deal_history dh2
    WHERE dh1.ctid < dh2.ctid
      AND dh1.deal_id   = dh2.deal_id
      AND dh1.tenant_id = dh2.tenant_id
  `)

  // Drop whatever PK exists (may be single-column from old schema)
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'deal_history'::regclass AND contype = 'p'
      ) THEN
        ALTER TABLE deal_history DROP CONSTRAINT deal_history_pkey;
      END IF;
    END
    $$
  `)

  // Add correct composite PK
  pgm.sql(`ALTER TABLE deal_history ADD PRIMARY KEY (deal_id, tenant_id)`)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE deal_history DROP CONSTRAINT IF EXISTS deal_history_pkey`)
}
