import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // tenants table
  pgm.createTable(
    'tenants',
    {
      id:         { type: 'text', primaryKey: true },
      name:       { type: 'text', notNull: true },
      active:     { type: 'boolean', notNull: true, default: true },
      channels:   { type: 'jsonb', notNull: true, default: "'[]'" },
      filters:    {
        type: 'jsonb',
        notNull: true,
        default: '\'{"minDiscount":0,"categories":[],"keywords":[],"excludeKeywords":[]}\'',
      },
      affiliates: { type: 'jsonb', notNull: true, default: "'{}'" },
    },
    { ifNotExists: true }
  )

  // deal_history table — tenant_id column has DEFAULT 'default' to preserve existing rows (Pitfall 1 mitigated)
  pgm.createTable(
    'deal_history',
    {
      deal_id:   { type: 'text', notNull: true },
      tenant_id: { type: 'text', notNull: true, default: "'default'" },
      sent_at:   { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: { primaryKey: ['deal_id', 'tenant_id'] },
    }
  )

  // If deal_history was created by a previous migration without tenant_id, add the column safely
  pgm.addColumns(
    'deal_history',
    { tenant_id: { type: 'text', notNull: true, default: "'default'" } },
    { ifNotExists: true }
  )

  // rotation_state table
  pgm.createTable(
    'rotation_state',
    {
      tenant_id:         { type: 'text', primaryKey: true },
      round_robin_index: { type: 'integer', notNull: true, default: 0 },
      last_source:       { type: 'text' },
      updated_at:        { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true }
  )

  // deal_feedback table
  pgm.createTable(
    'deal_feedback',
    {
      id:         { type: 'bigserial', primaryKey: true },
      deal_id:    { type: 'text', notNull: true },
      tenant_id:  { type: 'text', notNull: true },
      user_id:    { type: 'text', notNull: true },
      reaction:   { type: 'text', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        unique: ['deal_id', 'tenant_id', 'user_id'],
        check: "reaction IN ('like', 'dislike')",
      },
    }
  )
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Only drop tables that do not hold user-critical data.
  // tenants and deal_history are intentionally NOT dropped in down() — T-04-02 mitigation.
  pgm.dropTable('deal_feedback', { ifExists: true })
  pgm.dropTable('rotation_state', { ifExists: true })
}
