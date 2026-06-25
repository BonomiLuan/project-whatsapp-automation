export function formatMessage(args: {
  emoji: string
  title: string
  originalPrice?: string
  price?: string
  coupon?: string
  couponUrl?: string
  couponLabel?: string
  buyUrl?: string
  groupUrl: string
}): string {
  const { emoji, title, originalPrice, price, coupon, couponUrl, couponLabel, buyUrl, groupUrl } = args

  const couponLine = couponUrl
    ? `🎟️ Resgate cupom ${couponLabel ?? 'de desconto'} aqui:`
    : coupon
    ? `🎟️ Use cupom ${coupon}`
    : null

  const lines: (string | null)[] = [
    `${emoji} ${title}`,
    ``,
    couponLine,
    couponUrl ? couponUrl : null,
    couponLine ? `` : null,
    originalPrice ? `💸 De: ~${originalPrice}~` : null,
    price ? `🔥 Por: *${price}*` : null,
    ``,
    buyUrl ? `🛒 Compre aqui ⬇️` : null,
    buyUrl ? buyUrl : null,
    buyUrl ? `` : null,
    `💬 Link do grupo ⬇️`,
    groupUrl ? groupUrl : null,
    groupUrl ? `` : null,
    ``,
    `⏰ Aproveite enquanto durar!`,
    `#Anúncio`,
  ]

  return lines.filter((l): l is string => l !== null).join('\n').trim()
}
