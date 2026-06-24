import cron from 'node-cron'
import type { Scheduler } from '../../core/ports/Scheduler.js'

const TIMEZONE = process.env.TZ ?? 'America/Sao_Paulo'

export class NodeCronScheduler implements Scheduler {
  schedule(name: string, expression: string, job: () => Promise<void>): void {
    cron.schedule(expression, job, { timezone: TIMEZONE })
  }
}
