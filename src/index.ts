import 'dotenv/config'
import path from 'path'
import { runner } from 'node-pg-migrate'

// ── Adapters ──────────────────────────────────────────────────────────────────
import { PgAdvisoryLock } from './adapters/lock/PgAdvisoryLock.js'
import { PgRotationStore } from './adapters/store/PgRotationStore.js'
import { PgDealRepository } from './adapters/db/PgDealRepository.js'
import { PgTenantRepository } from './adapters/db/PgTenantRepository.js'
import { TelegramPublisher } from './adapters/publishers/TelegramPublisher.js'
import { PelandoScraper } from './adapters/scrapers/PelandoScraper.js'
import { MercadoLivreScraper } from './adapters/scrapers/MercadoLivreScraper.js'
import { NodeCronScheduler } from './adapters/scheduler/NodeCronScheduler.js'
import { AmazonAffiliateLinkBuilder } from './adapters/affiliates/AmazonAffiliate.js'
import { MLAffiliateLinkBuilder } from './adapters/affiliates/MLAffiliate.js'
import { ShopeeAffiliateLinkBuilder } from './adapters/affiliates/ShopeeAffiliate.js'
import { CompositeAffiliateLinkBuilder } from './adapters/affiliates/CompositeAffiliateLinkBuilder.js'

// ── Use cases ─────────────────────────────────────────────────────────────────
import { MonitorDeals } from './core/usecases/MonitorDeals.js'
import { SuggestDeals } from './core/usecases/SuggestDeals.js'

// ── Job registrations ─────────────────────────────────────────────────────────
import { registerPelandoMonitor } from './jobs/monitorPelando.js'
import { registerMLMonitor } from './jobs/monitorML.js'
import { registerSuggestionJobs } from './jobs/cronLock.js'
import { setPelandoTrigger } from './adapters/publishers/TelegramPublisher.js'
import { setTenantRepo } from './web/server.js'

// ── Migration runner ──────────────────────────────────────────────────────────
async function runMigrations(): Promise<void> {
  await runner({
    databaseUrl: process.env.DATABASE_URL!,
    dir: path.resolve(process.cwd(), 'migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: (msg: string) => console.log('[migrations]', msg),
  })
}

// ── Boot ──────────────────────────────────────────────────────────────────────
console.log('[boot] running migrations...')
await runMigrations()
console.log('[boot] migrations complete')

// ── Instantiate adapters ──────────────────────────────────────────────────────
const lock = new PgAdvisoryLock()
const rotationStore = new PgRotationStore()
const dealRepo = new PgDealRepository()
const tenantRepo = new PgTenantRepository()
const telegramPublisher = new TelegramPublisher()
const pelandoScraper = new PelandoScraper()
const mlScraper = new MercadoLivreScraper()
const scheduler = new NodeCronScheduler()

// ── Affiliate link builder (composite: Amazon + ML + Shopee) ──────────────────
const affiliateBuilder = new CompositeAffiliateLinkBuilder([
  new AmazonAffiliateLinkBuilder(),
  new MLAffiliateLinkBuilder(),
  new ShopeeAffiliateLinkBuilder(),
])

// ── Build use cases ───────────────────────────────────────────────────────────
const pelandoMonitor = new MonitorDeals(pelandoScraper, telegramPublisher, dealRepo, tenantRepo)
const mlMonitor = new MonitorDeals(mlScraper, telegramPublisher, dealRepo, tenantRepo)
const suggest = new SuggestDeals(rotationStore, dealRepo, telegramPublisher, affiliateBuilder)

// ── Inject tenant repository into web layer ───────────────────────────────────
setTenantRepo(tenantRepo)

// ── Wire bot commands ─────────────────────────────────────────────────────────
setPelandoTrigger(() => pelandoMonitor.execute(undefined, 5))

// ── Register jobs ─────────────────────────────────────────────────────────────
registerPelandoMonitor(scheduler, lock, pelandoMonitor)
registerMLMonitor(scheduler, lock, mlMonitor)
registerSuggestionJobs(scheduler, suggest, rotationStore, tenantRepo)

// ── Start web server (Express + WhatsApp bot + Telegram bot) ──────────────────
// Note: server.ts is already imported via `setTenantRepo` on line 28 above.
// A redundant bare import here was removed to avoid double-module-execution risk.
