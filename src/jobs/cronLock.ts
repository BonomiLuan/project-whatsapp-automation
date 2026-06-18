import cron from 'node-cron'
import { sendNextSuggestion, resetDailyState } from '../web/server.js'

cron.schedule('*/15 7-22 * * *', sendNextSuggestion, { timezone: 'America/Sao_Paulo' })
cron.schedule('0 0 * * *', resetDailyState, { timezone: 'America/Sao_Paulo' })
