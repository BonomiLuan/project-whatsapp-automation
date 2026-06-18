import cron from 'node-cron'
import { refreshDeals } from '../web/server.js'

cron.schedule('*/30 * * * *', refreshDeals, { timezone: 'America/Sao_Paulo' })
