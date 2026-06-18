import { Pool } from 'pg'

// ---------------------------------------------------------------------------
// Shared singleton pg.Pool — connects via Railway DATABASE_URL
// ---------------------------------------------------------------------------

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

process.on('SIGTERM', () => pool.end())
