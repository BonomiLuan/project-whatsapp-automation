import { Telegraf, Scenes, session, Markup } from 'telegraf'
import type { WizardContext } from 'telegraf/scenes'
import { createReadStream } from 'fs'
import { resolve } from 'path'
import { scrapeProduct, quickFetchProduct, type ProductData } from '../scraper/productScraper.js'
import { buildMessagePayload, fmt } from '../content/messageBuilder.js'
import { sendOfferMessage } from '../api/metaClient.js'
import { generateAffiliateLink, fetchShopeeProductByUrl, expandShortLink, CATEGORY_META, type SubIds, type DealCategory } from '../api/shopeeAffiliate.js'
import { injectAmazonTag, isAmazonUrl } from '../api/amazonAffiliate.js'
import { injectMLTag, isMercadoLivreUrl, fetchMLProductInfo } from '../api/mercadoLivreAffiliate.js'
import { type UnifiedDeal } from '../server/index.js'
import { createLink } from '../server/links.js'

import type { Telegram } from 'telegraf'
let telegramApi: Telegram | null = null

interface WizardState {
  product?: ProductData
  coupon?: string
  // coupon wizard
  couponCode?: string
  couponDiscount?: string
  couponMinimum?: string
  couponExpiry?: string
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

function detectSource(url: string): 'shopee' | 'amazon' | 'ml' {
  if (url.includes('shopee')) return 'shopee'
  if (url.includes('amazon') || url.includes('amzn')) return 'amazon'
  return 'ml'
}

async function sendToTelegram(ctx: Ctx, product: ProductData, coupon: string) {
  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
  let shortUrl = product.originalUrl
  try {
    const link = await createLink({ title: product.name, image_url: product.imageUrl ?? '', affiliate_url: product.originalUrl, source: detectSource(product.originalUrl) })
    shortUrl = (process.env.BASE_URL || '') + '/r/' + link.code
  } catch (err) { console.warn('[links] createLink failed in sendToTelegram, using original URL:', err) }
  const text = buildTelegramText({ ...product, originalUrl: shortUrl }, coupon, groupUrl)

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

// ── Coupon helpers ────────────────────────────────────────────────────────────

const CUPOM_IMAGE_PATH = resolve('cupons shopee', 'cupom_shopee.jpeg')

function parseShopeeMessage(text: string): { code: string; discount: string; minimum: string; expiry: string } | null {
  const codeMatch = text.match(/\*([A-Z0-9]{5,25})\*/)
  if (!codeMatch) return null

  const code = codeMatch[1]

  const discountMatch = text.match(/R\$\s*(\d+(?:[,.]\d+)?)\s*OFF/i)
  const discount = discountMatch ? `R$${discountMatch[1]} OFF` : ''

  const minimumMatch = text.match(/acima de\s+R\$\s*(\d+(?:[,.]\d+)?)/i)
  const minimum = minimumMatch ? `R$${minimumMatch[1]}` : ''

  const expiryMatch = text.match(/[Vv][áa]lido\s+(.+?)(?:!|\n|$)/)
  const expiry = expiryMatch ? expiryMatch[1].replace(/_/g, '').trim() : ''

  if (!discount) return null

  return { code, discount, minimum, expiry }
}

function buildCouponMessage({ code, discount, minimum, expiry, groupUrl }: {
  code: string
  discount: string
  minimum?: string
  expiry?: string
  groupUrl: string
}): string {
  return [
    `🎟️ *CUPOM EXCLUSIVO SHOPEE!*`,
    ``,
    `Mães, aproveitem! 🛍️`,
    ``,
    `🔖 Código: \`${code}\``,
    `💰 *${discount}*${minimum ? ` em compras acima de *${minimum}*` : ''}`,
    expiry ? `⏰ ${expiry}` : null,
    ``,
    `📲 Como usar: adicione os produtos ao carrinho na Shopee e cole o código na finalização!`,
    ``,
    groupUrl ? `💚 Grupo Mamãe Econômica:\n${groupUrl}` : null,
    ``,
    `#Cupom #Shopee #MamãeEconômica`,
  ].filter((l): l is string => l !== null).join('\n')
}

async function sendCouponWithImage(ctx: Ctx, message: string) {
  try {
    await ctx.replyWithPhoto(
      { source: createReadStream(CUPOM_IMAGE_PATH) },
      { caption: message, parse_mode: 'Markdown' }
    )
  } catch {
    await ctx.reply(message, { parse_mode: 'Markdown' })
  }
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
    const isShopee = text.includes('shopee.com.br') || text.includes('s.shopee.com.br') || text.includes('shp.ee')
    const isAmazon = isAmazonUrl(text)
    const isML = isMercadoLivreUrl(text)

    try {
      // Auto-generate affiliate link + fetch product info from Shopee API in parallel
      let affiliateUrl = text
      let scrapeUrl = text
      let shopeeApiInfo: Awaited<ReturnType<typeof fetchShopeeProductByUrl>> = null

      if (isShopee) {
        // Expand short links (br.shp.ee, s.shopee.com.br) to full URL before API calls
        let shopeeUrl = text
        if (text.includes('shp.ee') || text.includes('s.shopee.com.br')) {
          shopeeUrl = await expandShortLink(text)
        }
        scrapeUrl = shopeeUrl

        const subIds: SubIds = { source: 'telegram', trigger: 'manual', category: 'geral', slot: 'none' }
        const [affiliateResult, apiResult] = await Promise.allSettled([
          generateAffiliateLink(shopeeUrl, subIds),
          fetchShopeeProductByUrl(shopeeUrl),
        ])
        if (affiliateResult.status === 'fulfilled') affiliateUrl = affiliateResult.value
        if (apiResult.status === 'fulfilled') shopeeApiInfo = apiResult.value
        await ctx.telegram.editMessageText(
          ctx.chat!.id, status.message_id, undefined,
          `🔗 Link de afiliado gerado!\n\n⏳ Extraindo dados do produto...`,
        )
      } else if (isAmazon) {
        affiliateUrl = await injectAmazonTag(text)
        scrapeUrl = affiliateUrl  // use the expanded, clean Amazon URL for scraping
        await ctx.telegram.editMessageText(
          ctx.chat!.id, status.message_id, undefined,
          `🔗 Tag Amazon adicionada!\n\n⏳ Extraindo dados do produto...`,
        )
      } else if (isML) {
        const [affiliateResult, mlInfo] = await Promise.allSettled([
          injectMLTag(text),
          fetchMLProductInfo(text),
        ])
        if (affiliateResult.status === 'fulfilled') affiliateUrl = affiliateResult.value
        if (mlInfo.status === 'fulfilled' && mlInfo.value) {
          const info = mlInfo.value
          ctx.wizard.state.product = {
            name: info.name,
            price: info.price,
            originalPrice: info.originalPrice,
            imageUrl: info.imageUrl,
            originalUrl: affiliateUrl,
          }
        }
        scrapeUrl = affiliateUrl
        await ctx.telegram.editMessageText(
          ctx.chat!.id, status.message_id, undefined,
          `🔗 Link ML com tag adicionada!\n\n⏳ Extraindo dados do produto...`,
        )
      }

      // Montar produto com melhor fonte disponível
      let product: ProductData
      if (isML && ctx.wizard.state.product) {
        // ML: API retornou dados — usa direto
        product = ctx.wizard.state.product
      } else if (isML) {
        // ML: API falhou — tentar Playwright (stealth) antes do manual
        await ctx.telegram.editMessageText(
          ctx.chat!.id, status.message_id, undefined,
          `🔗 Link ML com tag gerada!\n\n⏳ Tentando extrair dados via navegador...`,
        )
        let mlScraped: ProductData | null = null
        try { mlScraped = await scrapeProduct(scrapeUrl) } catch { /* segue manual */ }
        if (mlScraped?.name && (mlScraped.price || mlScraped.imageUrl)) {
          product = { ...mlScraped, originalUrl: affiliateUrl }
        } else {
          await ctx.telegram.editMessageText(
            ctx.chat!.id, status.message_id, undefined,
            `🔗 Link ML com tag gerada!\n\n⚠️ Não consegui extrair dados automaticamente.\n\n💰 Digite o preço promocional:`,
          )
          ctx.wizard.state.product = { name: mlScraped?.name || 'Produto Mercado Livre', price: '', imageUrl: mlScraped?.imageUrl || '', originalUrl: affiliateUrl }
          return ctx.wizard.next()
        }
      } else if (isAmazon) {
        // Amazon: fetch leve (OG tags) antes de abrir o Playwright
        const quick = await quickFetchProduct(scrapeUrl)
        product = quick ?? await scrapeProduct(scrapeUrl)
      } else if (isShopee && shopeeApiInfo?.name && shopeeApiInfo?.imageUrl) {
        // Shopee: API retornou nome + imagem — usa direto, sem Playwright
        const rawName = shopeeApiInfo.name.trim()
        product = {
          name: rawName.length > 60 ? rawName.slice(0, 57) + '...' : rawName,
          price: fmt(shopeeApiInfo.price),
          imageUrl: shopeeApiInfo.imageUrl,
          originalUrl: affiliateUrl,
        }
      } else {
        // Fallback: Playwright (Shopee sem API ou outros sites)
        product = await scrapeProduct(scrapeUrl)
        // Preenche lacunas com dados da API Shopee se disponíveis
        if (shopeeApiInfo) {
          if (!product.price) product.price = fmt(shopeeApiInfo.price)
          if (!product.imageUrl) product.imageUrl = shopeeApiInfo.imageUrl
        }
      }
      product.originalUrl = affiliateUrl

      ctx.wizard.state.product = product

      const affiliateNote = isShopee || isAmazon ? '\n🔗 Link de afiliado: gerado ✅' : ''
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

// ── Coupon wizard ─────────────────────────────────────────────────────────────

const couponWizard = new Scenes.WizardScene<Ctx>(
  'cupom',

  // Step 1 — ask: paste Shopee message or enter code manually
  async (ctx) => {
    await ctx.reply(
      '🎟️ Cole a mensagem da Shopee ou só o código do cupom:',
      Markup.removeKeyboard()
    )
    return ctx.wizard.next()
  },

  // Step 2 — receive input: auto-parse Shopee message OR treat as manual code
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : ''
    if (!text) return

    const parsed = parseShopeeMessage(text)
    if (parsed) {
      ctx.wizard.state.couponCode     = parsed.code
      ctx.wizard.state.couponDiscount = parsed.discount
      ctx.wizard.state.couponMinimum  = parsed.minimum
      ctx.wizard.state.couponExpiry   = parsed.expiry

      const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
      const preview = buildCouponMessage({ code: parsed.code, discount: parsed.discount, minimum: parsed.minimum, expiry: parsed.expiry, groupUrl })

      await ctx.reply(`✅ *Cupom detectado automaticamente!*\n\n${preview}`, { parse_mode: 'Markdown' })
      return showCouponDestination(ctx)
    }

    // Manual flow: input is the code
    ctx.wizard.state.couponCode = text.toUpperCase()
    await ctx.reply('💰 Qual o desconto? (ex: R$20 OFF, 15% OFF, Frete Grátis)')
    return ctx.wizard.next()
  },

  // Step 3 — manual: receive discount, ask minimum
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : ''
    if (!text) return
    ctx.wizard.state.couponDiscount = text
    await ctx.reply('🛒 Valor mínimo do pedido? (ex: R$149) ou /skip', Markup.keyboard([['/skip']]).oneTime().resize())
    return ctx.wizard.next()
  },

  // Step 4 — manual: receive minimum, ask expiry
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : ''
    ctx.wizard.state.couponMinimum = (text === '/skip' || !text) ? '' : text
    await ctx.reply('⏰ Válido até quando? (ex: hoje às 23:59) ou /skip', Markup.keyboard([['/skip']]).oneTime().resize())
    return ctx.wizard.next()
  },

  // Step 5 — manual: receive expiry, show preview
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : ''
    ctx.wizard.state.couponExpiry = (text === '/skip' || !text) ? '' : text

    const { couponCode, couponDiscount, couponMinimum, couponExpiry } = ctx.wizard.state
    const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
    const preview = buildCouponMessage({ code: couponCode!, discount: couponDiscount!, minimum: couponMinimum, expiry: couponExpiry, groupUrl })

    await ctx.reply(`👀 *Preview:*\n\n${preview}`, { parse_mode: 'Markdown', ...Markup.removeKeyboard() })
    return showCouponDestination(ctx)
  },
)

async function showCouponDestination(ctx: Ctx) {
  await ctx.reply(
    '📍 Onde quer enviar?',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('📱 Telegram', 'coupon_telegram'),
        Markup.button.callback('💬 WhatsApp', 'coupon_whatsapp'),
      ],
      [Markup.button.callback('🔄 Ambos', 'coupon_both')],
      [Markup.button.callback('❌ Cancelar', 'coupon_cancel')],
    ])
  )
}

couponWizard.action(/^coupon_(telegram|whatsapp|both|cancel)$/, async (ctx) => {
  const dest = ctx.match[1]
  await ctx.answerCbQuery()
  await ctx.editMessageReplyMarkup(undefined)

  if (dest === 'cancel') {
    await ctx.reply('❌ Cancelado.')
    return ctx.scene.leave()
  }

  const { couponCode, couponDiscount, couponMinimum, couponExpiry } = ctx.wizard.state
  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
  const message = buildCouponMessage({
    code:     couponCode!,
    discount: couponDiscount!,
    minimum:  couponMinimum,
    expiry:   couponExpiry,
    groupUrl,
  })

  const status = await ctx.reply('⏳ Enviando...')

  try {
    if (dest === 'telegram' || dest === 'both') {
      await sendCouponWithImage(ctx, message)
    }

    if (dest === 'whatsapp' || dest === 'both') {
      const payload: import('../content/messageBuilder.js').MessagePayload = {
        name:         `🎟️ CUPOM: ${couponCode}`,
        price:        couponDiscount!,
        coupon:       couponMinimum ? `Mínimo: ${couponMinimum}` : ' ',
        affiliateUrl: 'https://shopee.com.br',
        groupUrl,
        imageUrl:     '',
      }
      await sendOfferMessage(payload)
    }

    const labels: Record<string, string> = {
      telegram: '📱 Enviado no Telegram!',
      whatsapp: '💬 Enviado no WhatsApp!',
      both:     '🔄 Enviado nos dois!',
    }
    await ctx.telegram.editMessageText(ctx.chat!.id, status.message_id, undefined, `✅ ${labels[dest]}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    await ctx.telegram.editMessageText(ctx.chat!.id, status.message_id, undefined, `❌ Erro: ${msg}`)
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
  const stage = new Scenes.Stage<Ctx>([offerWizard, couponWizard])

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
    '/fraldas — 🍼 Kits, trocador, pomada assadura',
    '/limpeza — 🧹 OMO, Ariel, Lysol, Veja',
    '/casa — 🏠 Panelas, organização, tapetes',
    '',
    '/amazon — 📦 Ofertas Amazon do momento',
    '/cupom — 🎟️ Montar e enviar um cupom Shopee',
    '/atualizar — buscar novas ofertas agora',
    '/ajuda — mostrar esta mensagem',
    '',
    '🔗 Ou mande qualquer link de produto e eu monto a oferta com link de afiliado.',
  ].join('\n')

  bot.start((ctx) => ctx.reply(HELP_TEXT, { parse_mode: 'HTML', ...Markup.removeKeyboard() }))
  bot.command('ajuda', (ctx) => ctx.reply(HELP_TEXT, { parse_mode: 'HTML' }))

  bot.command('cupom', (ctx) => ctx.scene.enter('cupom'))

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
    'brinquedos', 'saude', 'maternidade', 'casa', 'limpeza', 'banho', 'fraldas',
  ]
  for (const cat of categoryCommands) {
    bot.command(cat, (ctx) => sendCategoryDeals(ctx, cat))
  }

  bot.command('amazon', async (ctx) => {
    const { getCachedDeals } = await import('../server/index.js')
    const deals = getCachedDeals()
    const pool = deals.filter(d => d.source === 'amazon')
    if (!pool.length) {
      await ctx.reply('🔍 Nenhuma oferta Amazon no momento. Tente /atualizar.')
      return
    }
    const sample = pool.sort(() => Math.random() - 0.5).slice(0, 5)
    await ctx.reply(`📦 <b>Amazon — ${sample.length} ofertas</b>`, { parse_mode: 'HTML' })
    for (const deal of sample) {
      await sendDealCard(ctx, deal)
      await new Promise(r => setTimeout(r, 300))
    }
  })

  // WhatsApp callback: send deal card directly via Meta API
  bot.action(/^wa:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery()
    const dealId = ctx.match[1]
    const deal = dealCardStore.get(dealId)

    if (!deal) {
      await ctx.reply('❌ Oferta não encontrada no cache. Tente buscar novamente com /ofertas.')
      return
    }

    const status = await ctx.reply('⏳ Enviando para o WhatsApp...')

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

      console.log(`[wa-button] Enviando para WhatsApp: ${deal.title.slice(0, 40)}`)
      await sendOfferMessage(payload)
      console.log(`[wa-button] ✓ Enviado com sucesso`)

      await ctx.telegram.editMessageText(
        ctx.chat!.id, status.message_id, undefined,
        `✅ Enviado para o WhatsApp!\n📦 ${deal.title.slice(0, 50)}`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      console.error(`[wa-button] ✗ Erro:`, msg)
      await ctx.telegram.editMessageText(
        ctx.chat!.id, status.message_id, undefined,
        `❌ Falha ao enviar para o WhatsApp:\n\`${msg.slice(0, 200)}\``
      )
    }
  })

  bot.hears(/https?:\/\//, (ctx) => ctx.scene.enter('offer'))

  bot.launch().catch((err: Error) => {
    console.error('[telegram] Falha no launch (bot desabilitado):', err.message)
  })
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
    { command: 'fraldas', description: `${CATEGORY_META.fraldas.emoji} Kits, trocador, pomada assadura` },
    { command: 'limpeza', description: `${CATEGORY_META.limpeza.emoji} OMO, Ariel, Lysol, Veja` },
    { command: 'casa', description: `${CATEGORY_META.casa.emoji} Panelas, organização, tapetes` },
    { command: 'amazon', description: '📦 Ofertas Amazon do momento' },
    { command: 'cupom', description: '🎟️ Montar e enviar um cupom Shopee' },
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
  if (deal.source === 'shopee' && deal.productLink) {
    try {
      const subIds: SubIds = {
        source: 'telegram', trigger: 'auto',
        category: deal.category as SubIds['category'],
        slot: 'none',
      }
      dealUrl = await generateAffiliateLink(deal.productLink, subIds)
    } catch { /* fallback */ }
  } else if (deal.source === 'amazon') {
    try {
      dealUrl = await injectAmazonTag(deal.affiliateUrl)
    } catch { /* fallback to original affiliateUrl */ }
  }

  let shortUrl = dealUrl
  try {
    const link = await createLink({ title: deal.title, image_url: deal.imageUrl ?? '', affiliate_url: dealUrl, source: deal.source === 'mercado-livre' ? 'ml' : deal.source === 'shopee' ? 'shopee' : 'amazon' })
    shortUrl = (process.env.BASE_URL || '') + '/r/' + link.code
  } catch (err) { console.warn('[links] createLink failed in sendDealToChat:', err) }

  const text = formatMessage({
    emoji: categoryEmoji,
    title: deal.title,
    originalPrice: deal.originalPrice,
    price: deal.price,
    buyUrl: shortUrl,
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
  let shortUrl = product.originalUrl
  try {
    const link = await createLink({ title: product.name, image_url: product.imageUrl ?? '', affiliate_url: product.originalUrl, source: detectSource(product.originalUrl) })
    shortUrl = (process.env.BASE_URL || '') + '/r/' + link.code
  } catch (err) { console.warn('[links] createLink failed in sendProductToChat:', err) }
  const text = buildTelegramText({ ...product, originalUrl: shortUrl }, coupon, groupUrl)

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
  } else if (deal.source === 'amazon') {
    try {
      dealUrl = await injectAmazonTag(deal.affiliateUrl)
    } catch { /* fallback to original affiliateUrl */ }
  }

  dealCardStore.set(deal.id, { ...deal, affiliateUrl: dealUrl })

  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
  const categoryEmoji = CATEGORY_META[deal.category]?.emoji ?? '🛍️'

  let shortUrl = dealUrl
  try {
    const link = await createLink({ title: deal.title, image_url: deal.imageUrl ?? '', affiliate_url: dealUrl, source: deal.source === 'mercado-livre' ? 'ml' : deal.source === 'shopee' ? 'shopee' : 'amazon' })
    shortUrl = (process.env.BASE_URL || '') + '/r/' + link.code
  } catch (err) { console.warn('[links] createLink failed in sendDealCard:', err) }

  const text = formatMessage({
    emoji: categoryEmoji,
    title: deal.title,
    originalPrice: deal.originalPrice,
    price: deal.price,
    buyUrl: shortUrl,
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
