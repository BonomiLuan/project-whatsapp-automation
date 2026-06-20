/**
 * seed-default-tenant.ts
 *
 * Creates the `tenants` table (if it doesn't exist) and upserts a single
 * default tenant whose Telegram channels come from TELEGRAM_CHAT_IDS env var.
 *
 * Run once: npx tsx scripts/seed-default-tenant.ts
 */
import 'dotenv/config'
import pg from 'pg'

const { Pool } = pg

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const chatIds = (process.env.TELEGRAM_CHAT_IDS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

if (chatIds.length === 0) {
  console.error('❌ TELEGRAM_CHAT_IDS não configurado no .env')
  process.exit(1)
}

async function run() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        active     BOOLEAN NOT NULL DEFAULT true,
        channels   JSONB NOT NULL DEFAULT '[]',
        filters    JSONB NOT NULL DEFAULT '{"minDiscount":0,"categories":[],"sources":[]}',
        affiliates JSONB NOT NULL DEFAULT '{}'
      )
    `)
    console.log('✅ Tabela tenants criada (ou já existia)')

    const channels = chatIds.map(id => ({ type: 'telegram', channelId: id }))
    const filters  = { minDiscount: 0, keywords: [], excludeKeywords: [], categories: [] }
    const affiliates = {
      amazonTag:    process.env.AMAZON_ASSOCIATE_TAG,
      shopeeSourceId: process.env.SHOPEE_SOURCE_ID,
    }

    await client.query(
      `INSERT INTO tenants (id, name, active, channels, filters, affiliates)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET channels   = EXCLUDED.channels,
             filters    = EXCLUDED.filters,
             affiliates = EXCLUDED.affiliates,
             active     = true`,
      [
        'default',
        'Padrão',
        true,
        JSON.stringify(channels),
        JSON.stringify(filters),
        JSON.stringify(affiliates),
      ]
    )

    console.log(`✅ Tenant "default" seeded com ${channels.length} canal(is) Telegram:`)
    chatIds.forEach(id => console.log(`   • ${id}`))
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch(err => {
  console.error('❌ Erro:', err.message)
  process.exit(1)
})
