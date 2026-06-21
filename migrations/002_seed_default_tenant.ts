import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Build channels array from env (may be absent in staging — default to empty).
  const rawIds = process.env.TELEGRAM_CHAT_IDS ?? ''
  const chatIds = rawIds
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  const channels = chatIds.map(id => ({ type: 'telegram', channelId: id }))
  const filters  = { minDiscount: 0, categories: [], keywords: [], excludeKeywords: [] }

  const channelsJson  = JSON.stringify(channels)
  const filtersJson   = JSON.stringify(filters)
  const affiliatesJson = JSON.stringify({})

  pgm.sql(`
    INSERT INTO tenants (id, name, active, channels, filters, affiliates)
    VALUES (
      'default',
      'Default',
      true,
      '${channelsJson}'::jsonb,
      '${filtersJson}'::jsonb,
      '${affiliatesJson}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `)

  console.log('[migration 002] default tenant upserted or already exists')
}

export async function down(_pgm: MigrationBuilder): Promise<void> {
  // no-op: do not remove existing tenant data on rollback
}
