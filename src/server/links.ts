import { Pool } from 'pg'
import { randomBytes } from 'crypto'
import axios from 'axios'

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
  /\.susercontent\.com$/,   // Shopee CDN (down-br.img.susercontent.com etc.)
  /\.szcdn\.com$/,
  /\.ssl-images-amazon\.com$/,
  /\.media-amazon\.com$/,
  /\.cloudfront\.net$/,
  /\.mlstatic\.com$/,
  /\.pelando\.com\.br$/,
  /media\.pelando\.com\.br$/,
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
  if (!process.env.DATABASE_URL) {
    console.warn('[links] DATABASE_URL não definido — tabela de links não será criada')
    return
  }
  try {
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
      ALTER TABLE links ADD COLUMN IF NOT EXISTS image_data BYTEA;
      ALTER TABLE links ADD COLUMN IF NOT EXISTS image_mime TEXT;
      CREATE TABLE IF NOT EXISTS auto_send_control (
        key       TEXT PRIMARY KEY,
        last_send TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO auto_send_control (key, last_send)
        VALUES ('last_auto_send', NOW() - INTERVAL '1 hour')
        ON CONFLICT DO NOTHING;
    `)
    // Remove duplicate affiliate_urls keeping the most recent row before creating unique index
    await pool.query(`
      DELETE FROM links
      WHERE code IN (
        SELECT code FROM (
          SELECT code,
                 ROW_NUMBER() OVER (PARTITION BY affiliate_url ORDER BY created_at DESC) AS rn
          FROM links
        ) ranked
        WHERE rn > 1
      )
    `)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_links_affiliate_url ON links(affiliate_url)
    `)
    console.log('[links] ✅ Tabela de links pronta (Railway Postgres conectado)')
  } catch (err) {
    console.error('[links] ❌ Falha ao conectar/criar tabela:', err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

async function fetchImageForStorage(imageUrl: string): Promise<{ buffer: Buffer; mime: string } | null> {
  if (!imageUrl) { console.warn('[links:img] URL vazia'); return null }
  if (!isSsrfAllowed(imageUrl)) { console.warn(`[links:img] domínio bloqueado: ${new URL(imageUrl).hostname}`); return null }
  try {
    const imageHost = new URL(imageUrl).hostname
    const referer = imageHost.includes('amazon') ? 'https://www.amazon.com.br/'
      : imageHost.includes('pelando') ? 'https://www.pelando.com.br/'
      : imageHost.includes('mercadolivre') || imageHost.includes('mlstatic') ? 'https://www.mercadolivre.com.br/'
      : 'https://shopee.com.br/'
    const response = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': referer,
      },
    })
    if (response.status >= 400) {
      console.warn(`[links:img] HTTP ${response.status} para ${imageUrl.slice(0, 80)}`)
      return null
    }
    const buffer = Buffer.from(response.data)
    if (buffer.length < 5000) {
      console.warn(`[links:img] imagem suspeita (${buffer.length} bytes — possível bloqueio): ${imageUrl.slice(0, 80)}`)
      return null
    }
    const mime = (response.headers['content-type'] as string) || 'image/jpeg'
    return { buffer, mime }
  } catch (err) {
    console.warn(`[links:img] erro ao buscar ${imageUrl.slice(0, 80)}: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

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
  const { rows } = await pool.query<LinkEntry & { image_data: Buffer | null }>(
    `INSERT INTO links (code, title, image_url, affiliate_url, source, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '45 days')
     ON CONFLICT (affiliate_url) DO UPDATE
       SET expires_at  = NOW() + INTERVAL '45 days',
           title       = EXCLUDED.title,
           image_url   = EXCLUDED.image_url
     RETURNING *, image_data IS NOT NULL AS has_image`,
    [code, data.title, data.image_url, data.affiliate_url, data.source]
  )
  const entry = rows[0]
  const isNew = entry.code === code  // conflict → existing code returned, different from the one we generated

  if (isNew) {
    console.log(`[links] ✓ novo link criado: ${code}`)
  } else {
    console.log(`[links] ✓ link existente renovado: ${entry.code}`)
  }

  // Fetch and store image bytes if not yet stored
  if (!(entry as unknown as { has_image: boolean }).has_image) {
    try {
      const img = await fetchImageForStorage(data.image_url)
      if (img) {
        await pool.query(
          'UPDATE links SET image_data = $1, image_mime = $2 WHERE code = $3',
          [img.buffer, img.mime, entry.code]
        )
        console.log(`[links] ✓ imagem armazenada (${img.buffer.length} bytes) para ${entry.code}`)
      } else {
        console.warn(`[links] ⚠️  sem imagem para ${entry.code} — URL: ${data.image_url.slice(0, 60)}`)
      }
    } catch (err) {
      console.warn(`[links] ⚠️  falha ao buscar imagem para ${entry.code}:`, err instanceof Error ? err.message : err)
    }
  }

  return entry
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

export async function getLinkImageData(code: string): Promise<{ buffer: Buffer; mime: string } | null> {
  const { rows } = await pool.query(
    'SELECT image_data, image_mime FROM links WHERE code = $1 AND image_data IS NOT NULL',
    [code]
  )
  if (!rows[0]?.image_data) return null
  return { buffer: rows[0].image_data as Buffer, mime: (rows[0].image_mime as string) || 'image/jpeg' }
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

export async function cleanupLinks(): Promise<{ expired: number; stale: number; total: number }> {
  const { rows: expiredRows } = await pool.query(
    `DELETE FROM links WHERE expires_at < NOW() RETURNING code`
  )
  const { rows: staleRows } = await pool.query(
    `DELETE FROM links WHERE click_count = 0 AND created_at < NOW() - INTERVAL '7 days' RETURNING code`
  )
  const expired = expiredRows.length
  const stale = staleRows.length
  return { expired, stale, total: expired + stale }
}

export async function truncateLinks(): Promise<number> {
  const { rows } = await pool.query(`DELETE FROM links RETURNING code`)
  return rows.length
}
