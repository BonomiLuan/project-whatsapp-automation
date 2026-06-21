import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Build channels array from env (may be absent in staging — default to empty).
  const rawIds = process.env.TELEGRAM_CHAT_IDS ?? ''
  const chatIds = rawIds
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  // Validate: chat IDs must be numeric (Telegram IDs are integers or "-100..." prefixed)
  const safeIds = chatIds.filter(id => /^-?\d+$/.test(id))
  const channels = safeIds.map(id => ({ type: 'telegram', channelId: id }))
  const filters  = { minDiscount: 0, categories: [], keywords: [], excludeKeywords: [] }

  // Use parameterized query to avoid SQL injection via env var interpolation
  await pgm.db.query(
    `INSERT INTO tenants (id, name, active, channels, filters, affiliates)
     VALUES ('default', 'Default', true, $1::jsonb, $2::jsonb, $3::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(channels), JSON.stringify(filters), '{}']
  )

  console.log('[migration 002] default tenant upserted or already exists')
}

export async function down(_pgm: MigrationBuilder): Promise<void> {
  // no-op: do not remove existing tenant data on rollback
}
