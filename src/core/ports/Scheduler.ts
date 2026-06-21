export interface Scheduler {
  schedule(name: string, cron: string, job: () => Promise<void>): void
}
