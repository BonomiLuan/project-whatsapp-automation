import { Pool } from 'pg'

// Pool fails gracefully at query time when DATABASE_URL is not set.
// All callers already wrap queries in try/catch.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL })
