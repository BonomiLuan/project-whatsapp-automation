import { Pool } from 'pg'
import { randomBytes } from 'crypto'

// ---------------------------------------------------------------------------
// Pool — connects via Railway DATABASE_URL
// ---------------------------------------------------------------------------

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

process.on('SIGTERM', () => pool.end())

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinkEntry {
  code: string
  title: string
  image_url: string
  affiliate_url: string
  source: 'shopee' | 'amazon' | 'ml'
  click_count: number
  created_at: Date
  expires_at: Date
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function generateCode(): string {
  const bytes = randomBytes(4)
  let code = ''
  for (let i = 0; i < 5; i++) {
    code += ALPHABET[bytes[i % 4] % ALPHABET.length]
  }
  return code
}

async function generateUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode()
    const { rows } = await pool.query('SELECT 1 FROM links WHERE code = $1', [code])
    if (rows.length === 0) return code
  }
  throw new Error('Could not generate unique code after 10 attempts')
}

// ---------------------------------------------------------------------------
// SSRF allowlist
// ---------------------------------------------------------------------------

const ALLOWED_IMAGE_HOSTS = [
  /\.shopee\.com\.br$/,
  /\.szcdn\.com$/,
  /\.ssl-images-amazon\.com$/,
  /\.cloudfront\.net$/,
  /\.mlstatic\.com$/,
]

export function isSsrfAllowed(imageUrl: string): boolean {
  try {
    const { hostname } = new URL(imageUrl)
    return ALLOWED_IMAGE_HOSTS.some((re) => re.test(hostname))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Affiliate URL domain allowlist
// ---------------------------------------------------------------------------

const ALLOWED_AFFILIATE_PREFIXES = [
  'https://shopee.com.br',
  'https://www.shopee.com.br',
  'https://s.shopee.com.br',
  'https://amazon.com.br',
  'https://www.amazon.com.br',
  'https://amzn.to',
  'https://www.mercadolivre.com.br',
  'https://mercadolivre.com.br',
  'https://www.mercadolibre.com',
  'https://meli.la',
  'https://ml.bz',
]

// ---------------------------------------------------------------------------
// Expired link redirect URL builder
// ---------------------------------------------------------------------------

export function buildExpiredRedirectUrl(
  source: 'shopee' | 'amazon' | 'ml',
  title: string
): string {
  switch (source) {
    case 'shopee':
      return 'https://shopee.com.br/search?keyword=' + encodeURIComponent(title)
    case 'amazon':
      return (
        'https://www.amazon.com.br/s?k=' +
        encodeURIComponent(title) +
        '&tag=' +
        (process.env.AMAZON_TAG || process.env.AMAZON_ASSOCIATE_TAG || '')
      )
    case 'ml':
      return (
        'https://www.mercadolivre.com.br/jm/search?as_word=' +
        encodeURIComponent(title) +
        '&matt_tool=' +
        (process.env.ML_PUBLISHER_ID || '64897511') +
        '&matt_word=' +
        (process.env.ML_MATT_WORD || 'mamaeeconomica')
      )
  }
}

// ---------------------------------------------------------------------------
// DDL migration
// ---------------------------------------------------------------------------

export async function initLinksTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      code          VARCHAR(5)   PRIMARY KEY,
      title         TEXT         NOT NULL,
      image_url     TEXT         NOT NULL,
      affiliate_url TEXT         NOT NULL,
      source        VARCHAR(20)  NOT NULL,
      click_count   INTEGER      NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMPTZ  NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_links_code ON links(code);
  `)
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createLink(data: {
  title: string
  image_url: string
  affiliate_url: string
  source: 'shopee' | 'amazon' | 'ml'
}): Promise<LinkEntry> {
  const isAllowed = ALLOWED_AFFILIATE_PREFIXES.some((prefix) =>
    data.affiliate_url.startsWith(prefix)
  )
  if (!isAllowed) {
    throw new Error('Invalid affiliate URL domain')
  }

  const code = await generateUniqueCode()
  const { rows } = await pool.query<LinkEntry>(
    `INSERT INTO links (code, title, image_url, affiliate_url, source, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '45 days')
     RETURNING *`,
    [code, data.title, data.image_url, data.affiliate_url, data.source]
  )
  return rows[0]
}

export async function getLink(code: string): Promise<LinkEntry | null> {
  const { rows } = await pool.query<LinkEntry>('SELECT * FROM links WHERE code = $1', [code])
  return rows[0] ?? null
}

export async function incrementClick(code: string): Promise<void> {
  try {
    await pool.query('UPDATE links SET click_count = click_count + 1 WHERE code = $1', [code])
  } catch {
    // Swallow errors — click tracking must not break the redirect flow
  }
}

export async function getLinks(limit = 100): Promise<LinkEntry[]> {
  const { rows } = await pool.query<LinkEntry>(
    'SELECT * FROM links ORDER BY created_at DESC LIMIT $1',
    [limit]
  )
  return rows
}
