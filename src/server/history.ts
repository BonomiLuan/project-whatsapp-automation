import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HISTORY_FILE = join(__dirname, '../../data/history.json')

export interface HistoryEntry {
  id: string
  sentAt: string
  productName: string
  price: string
  imageUrl: string
  affiliateUrl: string
}

export function loadHistory(): HistoryEntry[] {
  if (!existsSync(HISTORY_FILE)) return []
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export function appendHistory(entry: Omit<HistoryEntry, 'id' | 'sentAt'>): HistoryEntry {
  const history = loadHistory()
  const newEntry: HistoryEntry = {
    id: Date.now().toString(),
    sentAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    ...entry,
  }
  history.unshift(newEntry)
  writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, 50), null, 2))
  return newEntry
}
