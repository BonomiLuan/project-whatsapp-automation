import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Remove duplicate rows before adding the PK — keep the latest sent_at per (deal_id, tenant_id)
  pgm.sql(`
    DELETE FROM deal_history dh1
    USING deal_history dh2
    WHERE dh1.ctid < dh2.ctid
      AND dh1.deal_id  = dh2.deal_id
      AND dh1.tenant_id = dh2.tenant_id
  `)

  // Add the PRIMARY KEY only if it doesn't already exist
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'deal_history'::regclass
          AND contype = 'p'
      ) THEN
        ALTER TABLE deal_history ADD PRIMARY KEY (deal_id, tenant_id);
      END IF;
    END
    $$
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE deal_history DROP CONSTRAINT IF EXISTS deal_history_pkey`)
}
