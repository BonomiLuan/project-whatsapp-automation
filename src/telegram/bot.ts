import { Telegraf, Scenes, session, Markup } from 'telegraf'
import type { WizardContext } from 'telegraf/scenes'
import { scrapeProduct, type ProductData } from '../scraper/productScraper.js'
import { buildMessagePayload, fmt } from '../content/messageBuilder.js'
import { sendOfferMessage } from '../api/metaClient.js'
import { generateAffiliateLink, fetchShopeeProductByUrl, CATEGORY_META, type SubIds, type DealCategory } from '../api/shopeeAffiliate.js'
import { type UnifiedDeal } from '../server/index.js'

import type { Telegram } from 'telegraf'
let telegramApi: Telegram | null = null

interface WizardState {
  product?: ProductData
  coupon?: string
}

type Ctx = WizardContext & { wizard: { state: WizardState } }

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMessage({
  emoji, title, originalPrice, price, coupon, buyUrl, groupUrl,
}: {
  emoji: string
  title: string
  originalPrice?: string
  price?: string
  coupon?: string
  buyUrl: string
  groupUrl: string
}): string {
  const priceLine = originalPrice && price
    ? `~${originalPrice}~ por *${price}*`
    : price ? `*${price}*` : ''

  return [
    `${emoji} *${title}*`,
    ``,
    priceLine,
    coupon ? `🎟️ Cupom: *${coupon}*` : '',
    ``,
    `🔗 Link para comprar:`,
    buyUrl,
    ``,
    groupUrl ? `💬 Link para o grupo:` : '',
    groupUrl || '',
    ``,
    `⏰ Aproveite enquanto durar!`,
    ``,
    `#Anúncio`,
  ].filter(v => v !== undefined && !(v === '' && !groupUrl)).join('\n').trim()
}

function buildTelegramText(product: ProductData, coupon: string, groupUrl: string): string {
  return formatMessage({
    emoji: '🛍️',
    title: product.name,
    originalPrice: fmt(product.originalPrice),
    price: fmt(product.price),
    coupon: coupon || undefined,
    buyUrl: product.originalUrl,
    groupUrl,
  })
}

async function sendToTelegram(ctx: Ctx, product: ProductData, coupon: string) {
  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
  const text = buildTelegramText(product, coupon, groupUrl)

  if (product.imageUrl) {
    try {
      await ctx.replyWithPhoto(product.imageUrl, { caption: text })
      return
    } catch {
      // fallback to text if image fails
    }
  }
  await ctx.reply(text)
}

async function sendToWhatsApp(ctx: Ctx, product: ProductData, coupon: string) {
  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
  const payload = buildMessagePayload(product, coupon, groupUrl)
  await sendOfferMessage(payload)
}

// ── Wizard steps ─────────────────────────────────────────────────────────────

const offerWizard = new Scenes.WizardScene<Ctx>(
  'offer',

  // Step 1 — receive URL, auto-generate affiliate link (Shopee), then scrape
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : ''
    if (!text.startsWith('http')) {
      await ctx.reply('Manda o link do produto (Shopee, Amazon, etc.) 👇')
      return
    }

    const status = await ctx.reply('🔍 Processando produto...')
    const isShopee = text.includes('shopee.com.br') || text.includes('s.shopee.com.br')

    try {
      // Auto-generate affiliate link + fetch product info from Shopee API in parallel
      let affiliateUrl = text
      let shopeeApiInfo: Awaited<ReturnType<typeof fetchShopeeProductByUrl>> = null

      if (isShopee) {
        const subIds: SubIds = { source: 'telegram', trigger: 'manual', category: 'geral', slot: 'none' }
        const [affiliateResult, apiResult] = await Promise.allSettled([
          generateAffiliateLink(text, subIds),
          fetchShopeeProductByUrl(text),
        ])
        if (affiliateResult.status === 'fulfilled') affiliateUrl = affiliateResult.value
        if (apiResult.status === 'fulfilled') shopeeApiInfo = apiResult.value
        await ctx.telegram.editMessageText(
          ctx.chat!.id, status.message_id, undefined,
          `🔗 Link de afiliado gerado!\n\n⏳ Extraindo dados do produto...`,
        )
      }

      const product = await scrapeProduct(text)
      product.originalUrl = affiliateUrl

      // Use API price if scraper didn't find one
      if (!product.price && shopeeApiInfo?.price) {
        product.price = fmt(shopeeApiInfo.price)
      }

      ctx.wizard.state.product = product

      const affiliateNote = isShopee ? '\n🔗 Link de afiliado: gerado ✅' : ''
      await ctx.telegram.editMessageText(
        ctx.chat!.id, status.message_id, undefined,
        `📦 <b>${esc(product.name)}</b>${product.imageUrl ? '\n🖼️ Imagem encontrada' : ''}${affiliateNote}`,
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

  const HELP_TEXT = [
    '👋 <b>Comandos disponíveis:</b>',
    '',
    '/ofertas — ver ofertas de todos os nichos',
    '',
    '<b>Por sub-nicho (3–5 produtos):</b>',
    '/higiene — 🧴 Fraldas, lenço, pomada',
    '/banho — 🛁 Toalha papi, sabonete, shampoo',
    '/alimentacao — 🍼 Mamadeiras, chupetas',
    '/enxoval — 👶 Enxoval, body, manta',
    '/mobilidade — 🚗 Carrinhos, bebê conforto',
    '/quarto — 🛏️ Berço, decoração, monitor',
    '/brinquedos — 🧸 Brinquedos educativos',
    '/saude — 💊 Termômetro, aspirador nasal',
    '/maternidade — 🤱 Mala maternidade, amamentação',
    '/limpeza — 🧹 OMO, Ariel, Lysol, Veja',
    '/casa — 🏠 Panelas, organização, tapetes',
    '',
    '/atualizar — buscar novas ofertas agora',
    '/ajuda — mostrar esta mensagem',
    '',
    '🔗 Ou mande qualquer link de produto e eu monto a oferta com link de afiliado.',
  ].join('\n')

  bot.start((ctx) => ctx.reply(HELP_TEXT, { parse_mode: 'HTML', ...Markup.removeKeyboard() }))
  bot.command('ajuda', (ctx) => ctx.reply(HELP_TEXT, { parse_mode: 'HTML' }))

  bot.command('atualizar', async (ctx) => {
    const status = await ctx.reply('🔄 Buscando novas ofertas...')
    try {
      const { refreshDeals, getCachedDeals } = await import('../server/index.js')
      await refreshDeals()
      const count = getCachedDeals().length
      await ctx.telegram.editMessageText(
        ctx.chat!.id, status.message_id, undefined,
        `✅ ${count} ofertas atualizadas! Use /ofertas para ver.`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      await ctx.telegram.editMessageText(ctx.chat!.id, status.message_id, undefined, `❌ ${msg}`)
    }
  })

  // Reusable: send up to `limit` random deals from a category
  async function sendCategoryDeals(ctx: Ctx, category: DealCategory, limit = 5) {
    const { getCachedDeals } = await import('../server/index.js')
    const deals = getCachedDeals()
    const pool = deals.filter(d => d.category === category)

    if (!pool.length) {
      await ctx.reply('🔍 Nenhuma oferta nessa categoria no momento. Tente /atualizar.')
      return
    }

    const sample = pool.sort(() => Math.random() - 0.5).slice(0, limit)
    const meta = CATEGORY_META[category]
    await ctx.reply(`${meta.emoji} <b>${meta.label} — ${sample.length} ofertas</b>`, { parse_mode: 'HTML' })
    for (const deal of sample) {
      await sendDealCard(ctx, deal)
      await new Promise(r => setTimeout(r, 300))
    }
  }

  bot.command('ofertas', async (ctx) => {
    const { getCachedDeals } = await import('../server/index.js')
    const deals = getCachedDeals()
    if (!deals.length) {
      await ctx.reply('🔍 Nenhuma oferta no momento. Tente /atualizar.')
      return
    }
    const categories = [...new Set(deals.map(d => d.category))] as DealCategory[]
    for (const cat of categories) {
      await sendCategoryDeals(ctx, cat, 3)
    }
  })

  // One command per sub-niche
  const categoryCommands: DealCategory[] = [
    'higiene', 'alimentacao', 'enxoval', 'mobilidade', 'quarto',
    'brinquedos', 'saude', 'maternidade', 'casa', 'limpeza', 'banho',
  ]
  for (const cat of categoryCommands) {
    bot.command(cat, (ctx) => sendCategoryDeals(ctx, cat))
  }

  // WhatsApp callback: send deal card directly via Meta API
  bot.action(/^wa:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('⏳ Enviando para o WhatsApp...')
    const dealId = ctx.match[1]
    const deal = dealCardStore.get(dealId)

    if (!deal) {
      await ctx.answerCbQuery('❌ Oferta não encontrada. Tente reabrir o card.')
      return
    }

    try {
      const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
      const orig = deal.originalPrice ?? ''
      const priceFormatted = orig ? `~${orig}~ ${deal.price}` : deal.price

      const payload: import('../content/messageBuilder.js').MessagePayload = {
        name: deal.title.slice(0, 60),
        price: priceFormatted,
        coupon: ' ',
        affiliateUrl: deal.affiliateUrl,
        groupUrl,
        imageUrl: deal.imageUrl,
      }

      await sendOfferMessage(payload)
      await ctx.answerCbQuery('✅ Enviado para o WhatsApp!')
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 100) : 'Erro desconhecido'
      await ctx.answerCbQuery(`❌ ${msg}`)
    }
  })

  bot.hears(/https?:\/\//, (ctx) => ctx.scene.enter('offer'))

  bot.launch()
  telegramApi = bot.telegram

  bot.telegram.setMyCommands([
    { command: 'ofertas', description: 'Ver ofertas de todos os nichos' },
    { command: 'higiene', description: `${CATEGORY_META.higiene.emoji} Fraldas, lenço, pomada` },
    { command: 'banho', description: `${CATEGORY_META.banho.emoji} Toalha papi, sabonete, shampoo bebê` },
    { command: 'alimentacao', description: `${CATEGORY_META.alimentacao.emoji} Mamadeiras, chupetas, cadeirinha` },
    { command: 'enxoval', description: `${CATEGORY_META.enxoval.emoji} Enxoval, body, manta` },
    { command: 'mobilidade', description: `${CATEGORY_META.mobilidade.emoji} Carrinhos, bebê conforto` },
    { command: 'quarto', description: `${CATEGORY_META.quarto.emoji} Berço, decoração, monitor` },
    { command: 'brinquedos', description: `${CATEGORY_META.brinquedos.emoji} Brinquedos educativos` },
    { command: 'saude', description: `${CATEGORY_META.saude.emoji} Termômetro, aspirador nasal` },
    { command: 'maternidade', description: `${CATEGORY_META.maternidade.emoji} Mala maternidade, amamentação` },
    { command: 'limpeza', description: `${CATEGORY_META.limpeza.emoji} OMO, Ariel, Lysol, Veja` },
    { command: 'casa', description: `${CATEGORY_META.casa.emoji} Panelas, organização, tapetes` },
    { command: 'atualizar', description: 'Buscar novas ofertas agora' },
    { command: 'ajuda', description: 'Ver todos os comandos' },
  ])

  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))

  console.log('[telegram] ✅ Bot iniciado')
  return bot
}

function getTargetChatIds(): string[] {
  const multi = process.env.TELEGRAM_CHAT_IDS?.split(',').map(s => s.trim()).filter(Boolean) ?? []
  const single = process.env.TELEGRAM_CHAT_ID?.trim()
  const ids = multi.length > 0 ? multi : single ? [single] : []
  return [...new Set(ids)]
}

export async function sendDealToChat(deal: UnifiedDeal): Promise<void> {
  const chatIds = getTargetChatIds()
  if (!telegramApi || chatIds.length === 0) throw new Error('Bot ou TELEGRAM_CHAT_ID não configurado')

  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
  const categoryEmoji = CATEGORY_META[deal.category]?.emoji ?? '🛍️'

  let dealUrl = deal.affiliateUrl
  if (deal.productLink) {
    try {
      const subIds: SubIds = {
        source: 'telegram', trigger: 'auto',
        category: deal.category as SubIds['category'],
        slot: 'none',
      }
      dealUrl = await generateAffiliateLink(deal.productLink, subIds)
    } catch { /* fallback */ }
  }

  const text = formatMessage({
    emoji: categoryEmoji,
    title: deal.title,
    originalPrice: deal.originalPrice,
    price: deal.price,
    buyUrl: dealUrl,
    groupUrl,
  })

  dealCardStore.set(deal.id, { ...deal, affiliateUrl: dealUrl })

  const waButton = Markup.inlineKeyboard([[
    Markup.button.url('🛒 Abrir oferta', dealUrl),
    Markup.button.callback('📲 WhatsApp', `wa:${deal.id}`),
  ]])

  for (let i = 0; i < chatIds.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 60_000))
    const id = chatIds[i]
    if (deal.imageUrl) {
      try {
        await telegramApi!.sendPhoto(id, deal.imageUrl, { caption: text, ...waButton })
        continue
      } catch { /* fallback to text */ }
    }
    await telegramApi!.sendMessage(id, text, waButton)
  }
}

export async function sendProductToChat(
  product: ProductData,
  coupon: string,
): Promise<void> {
  const chatIds = getTargetChatIds()
  if (!telegramApi || chatIds.length === 0) throw new Error('Bot ou TELEGRAM_CHAT_ID não configurado')

  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
  const text = buildTelegramText(product, coupon, groupUrl)

  for (let i = 0; i < chatIds.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 60_000))
    const id = chatIds[i]
    if (product.imageUrl) {
      try {
        await telegramApi!.sendPhoto(id, product.imageUrl, { caption: text })
        continue
      } catch { /* fallback to text */ }
    }
    await telegramApi!.sendMessage(id, text)
  }
}

// Stores deals shown in cards so the WhatsApp callback can find them
const dealCardStore = new Map<string, UnifiedDeal>()

async function sendDealCard(ctx: Ctx, deal: UnifiedDeal) {
  const isShopee = deal.source === 'shopee'

  let dealUrl = deal.affiliateUrl
  if (isShopee && deal.productLink) {
    try {
      const subIds: SubIds = {
        source: 'telegram', trigger: 'manual',
        category: deal.category as SubIds['category'],
        slot: 'none',
      }
      dealUrl = await generateAffiliateLink(deal.productLink, subIds)
    } catch { /* fallback to pre-generated link */ }
  }

  dealCardStore.set(deal.id, { ...deal, affiliateUrl: dealUrl })

  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
  const categoryEmoji = CATEGORY_META[deal.category]?.emoji ?? '🛍️'

  const text = formatMessage({
    emoji: categoryEmoji,
    title: deal.title,
    originalPrice: deal.originalPrice,
    price: deal.price,
    buyUrl: dealUrl,
    groupUrl,
  })

  const buttons = Markup.inlineKeyboard([[
    Markup.button.url('🛒 Abrir oferta', dealUrl),
    Markup.button.callback('📲 WhatsApp', `wa:${deal.id}`),
  ]])

  try {
    if (deal.imageUrl) {
      await ctx.replyWithPhoto(deal.imageUrl, { caption: text, ...buttons })
    } else {
      await ctx.reply(text, buttons)
    }
  } catch {
    await ctx.reply(text, buttons)
  }
}

export { sendDealCard }

function esc(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c))
}
