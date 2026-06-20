import 'dotenv/config'

// ── Adapters ──────────────────────────────────────────────────────────────────
import { PgAdvisoryLock } from './adapters/lock/PgAdvisoryLock.js'
import { InMemoryRotationStore } from './adapters/store/InMemoryRotationStore.js'
import { PgDealRepository } from './adapters/db/PgDealRepository.js'
import { PgTenantRepository } from './adapters/db/PgTenantRepository.js'
import { TelegramPublisher } from './adapters/publishers/TelegramPublisher.js'
import { PelandoScraper } from './adapters/scrapers/PelandoScraper.js'
import { MercadoLivreScraper } from './adapters/scrapers/MercadoLivreScraper.js'
import { NodeCronScheduler } from './adapters/scheduler/NodeCronScheduler.js'

// ── Use cases ─────────────────────────────────────────────────────────────────
import { MonitorDeals } from './core/usecases/MonitorDeals.js'
import { SuggestDeals } from './core/usecases/SuggestDeals.js'

// ── Job registrations ─────────────────────────────────────────────────────────
import { registerPelandoMonitor } from './jobs/monitorPelando.js'
import { registerMLMonitor } from './jobs/monitorML.js'
import { registerSuggestionJobs } from './jobs/cronLock.js'

// ── Instantiate adapters ──────────────────────────────────────────────────────
const lock = new PgAdvisoryLock()
const rotationStore = new InMemoryRotationStore()
const dealRepo = new PgDealRepository()
const tenantRepo = new PgTenantRepository()
const telegramPublisher = new TelegramPublisher()
const pelandoScraper = new PelandoScraper()
const mlScraper = new MercadoLivreScraper()
const scheduler = new NodeCronScheduler()

// ── Build use cases ───────────────────────────────────────────────────────────
const pelandoMonitor = new MonitorDeals(pelandoScraper, telegramPublisher, dealRepo, tenantRepo)
const mlMonitor = new MonitorDeals(mlScraper, telegramPublisher, dealRepo, tenantRepo)
const suggest = new SuggestDeals(rotationStore, dealRepo, telegramPublisher)

// ── Register jobs ─────────────────────────────────────────────────────────────
registerPelandoMonitor(scheduler, lock, pelandoMonitor)
registerMLMonitor(scheduler, lock, mlMonitor)
registerSuggestionJobs(scheduler, suggest, rotationStore, tenantRepo)

// ── Start web server (Express + WhatsApp bot + Telegram bot) ──────────────────
import './web/server.js'
