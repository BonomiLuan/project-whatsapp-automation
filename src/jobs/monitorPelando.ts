import cron from 'node-cron'
import { monitorPelando } from '../web/server.js'

cron.schedule('*/30 * * * *', monitorPelando, { timezone: 'America/Sao_Paulo' })
