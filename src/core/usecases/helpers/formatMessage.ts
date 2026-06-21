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

  const lines: (string | null)[] = [
    `${emoji} ${title}`,
    ``,
    coupon ? `🎟️ Use cupom ${coupon}` : null,
    coupon ? `` : null,
    originalPrice ? `💸 De: ${originalPrice}` : null,
    price ? `🔥 Por: ${price}` : null,
    ``,
    `🛒 Compre aqui ⬇️`,
    buyUrl,
    ``,
    groupUrl ? groupUrl : null,
    groupUrl ? `` : null,
    `#Anúncio`,
  ]

  return lines.filter((l): l is string => l !== null).join('\n').trim()
}
