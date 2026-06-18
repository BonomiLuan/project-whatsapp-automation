import { pool } from '../db/pool.js'

// ---------------------------------------------------------------------------
// Advisory lock helpers — prevent concurrent cron execution across instances
// ---------------------------------------------------------------------------

export async function withCronLock<T>(lockId: number, fn: () => Promise<T>): Promise<T | null> {
  if (!process.env.DATABASE_URL) return fn()
  const client = await pool.connect()
  try {
    const res = await client.query<{ pg_try_advisory_lock: boolean }>('SELECT pg_try_advisory_lock($1)', [lockId])
    if (!res.rows[0].pg_try_advisory_lock) return null
    return await fn()
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [lockId])
    client.release()
  }
}

// Distributed lock: atomically claims the auto-send slot.
// Returns true if this instance should send (no send in the last `intervalMinutes`).
export async function claimAutoSendSlot(intervalMinutes = 13): Promise<boolean> {
  try {
    const { rows } = await pool.query(`
      UPDATE auto_send_control
      SET last_send = NOW()
      WHERE key = 'last_auto_send'
        AND last_send < NOW() - ($1 || ' minutes')::INTERVAL
      RETURNING key
    `, [intervalMinutes])
    return rows.length > 0
  } catch {
    return true // fallback: allow send if DB check fails
  }
}
