/**
 * Pure helper: builds the Telegram caption string for a deal announcement.
 * Byte-identical output to the inline formatMessage in TelegramPublisher.ts lines 32-63.
 *
 * No IO imports. All inputs as parameters. No module-level mutable state.
 */
export function formatMessage(args: {
  emoji: string
  title: string
  originalPrice?: string
  price?: string
  coupon?: string
  buyUrl: string
  groupUrl: string
}): string {
  const { emoji, title, originalPrice, price, coupon, buyUrl, groupUrl } = args

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
