import type { Scheduler } from '../core/ports/Scheduler.js'
import type { Lock } from '../core/ports/Lock.js'
import type { MonitorDeals } from '../core/usecases/MonitorDeals.js'

/**
 * registerMLMonitor — wires the Mercado Livre monitor into the scheduler.
 * No cron runs at import time; the caller (composition root) controls lifecycle.
 */
export function registerMLMonitor(
  scheduler: Scheduler,
  lock: Lock,
  monitor: MonitorDeals,
): void {
  scheduler.schedule(
    'ml-monitor',
    '0 8-22/2 * * *',
    () => lock.withLock('monitor:ml', () => monitor.execute()).then(() => void 0),
  )
}
