import { Telegraf, Scenes, session, Markup } from 'telegraf'
import type { WizardContext } from 'telegraf/scenes'
import { scrapeProduct, type ProductData } from '../scraper/productScraper.js'
import { buildMessagePayload, fmt } from '../content/messageBuilder.js'
import { sendOfferMessage } from '../api/metaClient.js'

interface WizardState {
  product?: ProductData
  coupon?: string
}

type Ctx = WizardContext & { wizard: { state: WizardState } }

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildTelegramText(product: ProductData, coupon: string, groupUrl: string): string {
  const promo = fmt(product.price)
  const orig = fmt(product.originalPrice)

  // "de R$180,00 por R$115,00"  or just "por R$115,00"
  const priceLine = orig && promo
    ? `de <s>${orig}</s> por <b>${promo}</b>`
    : `por <b>${promo || 'Consulte o site'}</b>`

  const lines = [
    `🛍️ <b>Oferta especial!</b>`,
    ``,
    `<b>${esc(product.name)}</b> ${priceLine}`,
    coupon ? `🎟️ Cupom: <code>${esc(coupon)}</code>` : '',
    ``,
    `Compre aqui: ${esc(product.originalUrl)}`,
    ``,
    groupUrl ? `💰 Grupo de ofertas: ${esc(groupUrl)}` : '',
    ``,
    `Aproveite enquanto durar! ⏰`,
  ].filter(line => line !== undefined && !(line === '' && !groupUrl)).join('\n')

  return lines.trim()
}

async function sendToTelegram(ctx: Ctx, product: ProductData, coupon: string) {
  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
  const text = buildTelegramText(product, coupon, groupUrl)

  if (product.imageUrl) {
    try {
      await ctx.replyWithPhoto(product.imageUrl, { caption: text, parse_mode: 'HTML' })
      return
    } catch {
      // fallback to text if image fails
    }
  }
  await ctx.reply(text, { parse_mode: 'HTML' })
}

async function sendToWhatsApp(ctx: Ctx, product: ProductData, coupon: string) {
  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
  const payload = buildMessagePayload(product, coupon, groupUrl)
  await sendOfferMessage(payload)
}

// ── Wizard steps ─────────────────────────────────────────────────────────────

const offerWizard = new Scenes.WizardScene<Ctx>(
  'offer',

  // Step 1 — receive URL, scrape
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : ''
    if (!text.startsWith('http')) {
      await ctx.reply('Manda o link do produto (Shopee, Amazon, etc.) 👇')
      return
    }

    const status = await ctx.reply('🔍 Extraindo produto...')

    try {
      const product = await scrapeProduct(text)
      ctx.wizard.state.product = product

      await ctx.telegram.editMessageText(
        ctx.chat!.id, status.message_id, undefined,
        `📦 <b>${esc(product.name)}</b>${product.imageUrl ? '\n🖼️ Imagem encontrada' : ''}`,
        { parse_mode: 'HTML' }
      )

      if (product.price) {
        await ctx.reply(
          `💰 Preço encontrado: <b>${esc(product.price)}</b>\nTem preço original (riscado)? Digite ou /skip`,
          { parse_mode: 'HTML' }
        )
        return ctx.wizard.selectStep(2)
      }

      await ctx.reply('💰 Preço não encontrado. Digite o preço promocional:')
      return ctx.wizard.next()

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      await ctx.telegram.editMessageText(ctx.chat!.id, status.message_id, undefined, `❌ ${msg}`)
    }
  },

  // Step 2 — receive promo price (only if not found automatically)
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : ''
    if (!text) return

    ctx.wizard.state.product!.price = fmt(text)
    await ctx.reply('🏷️ Tem preço original (riscado)? Digite ou /skip')
    return ctx.wizard.next()
  },

  // Step 3 — receive original price (optional)
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : ''
    if (text && text !== '/skip') {
      ctx.wizard.state.product!.originalPrice = fmt(text)
    }
    await ctx.reply(
      '🎟️ Tem cupom? Digite o código ou /skip',
      Markup.keyboard([['/skip']]).oneTime().resize()
    )
    return ctx.wizard.next()
  },

  // Step 4 — receive coupon, ask destination
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : ''
    ctx.wizard.state.coupon = (text === '/skip' || !text) ? '' : text

    await ctx.reply(
      '📍 Onde quer enviar a oferta?',
      {
        ...Markup.removeKeyboard(),
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('📱 Telegram', 'dest_telegram'),
            Markup.button.callback('💬 WhatsApp', 'dest_whatsapp'),
          ],
          [Markup.button.callback('🔄 Ambos', 'dest_both')],
        ]),
      }
    )
    // Stay in this step — waiting for inline button press (handled by action below)
  }
)

// Handle destination choice (inline keyboard callbacks)
offerWizard.action(/^dest_(telegram|whatsapp|both)$/, async (ctx) => {
  const dest = ctx.match[1]
  const product = ctx.wizard.state.product!
  const coupon = ctx.wizard.state.coupon || ''

  await ctx.answerCbQuery()
  await ctx.editMessageReplyMarkup(undefined) // remove buttons

  const status = await ctx.reply('⏳ Enviando...')

  try {
    if (dest === 'telegram' || dest === 'both') {
      await sendToTelegram(ctx, product, coupon)
    }

    if (dest === 'whatsapp' || dest === 'both') {
      await sendToWhatsApp(ctx, product, coupon)
    }

    const labels: Record<string, string> = {
      telegram: '📱 Enviado no Telegram!',
      whatsapp: '💬 Enviado no WhatsApp!',
      both: '🔄 Enviado nos dois!',
    }

    await ctx.telegram.editMessageText(
      ctx.chat!.id, status.message_id, undefined,
      `✅ ${labels[dest]}\n\nManda outro link quando quiser.`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    await ctx.telegram.editMessageText(
      ctx.chat!.id, status.message_id, undefined,
      `❌ Erro: ${msg}`
    )
  }

  await ctx.scene.leave()
})

// ── Bot setup ────────────────────────────────────────────────────────────────

export function createBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token || token === 'PREENCHER') {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN não configurado — bot desabilitado')
    return null
  }

  const bot = new Telegraf<Ctx>(token)
  const stage = new Scenes.Stage<Ctx>([offerWizard])

  bot.use(session())
  bot.use(stage.middleware())

  bot.start((ctx) =>
    ctx.reply(
      '👋 Olá! Manda o link de um produto e eu monto a oferta.\n\nPosso enviar direto aqui no Telegram ou no WhatsApp!',
      Markup.removeKeyboard()
    )
  )

  bot.hears(/https?:\/\//, (ctx) => ctx.scene.enter('offer'))

  bot.launch()

  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))

  console.log('[telegram] ✅ Bot iniciado — @casaemae_ofertas_bot')
  return bot
}

function esc(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c))
}
