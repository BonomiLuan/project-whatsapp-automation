export type Marketplace = 'pelando' | 'mercadolivre' | 'shopee' | 'amazon'

export type Deal = {
  id: string
  title: string
  price: number
  originalPrice?: number
  url: string
  imageUrl?: string
  couponCode?: string
  marketplace: Marketplace
  category: string
  postedAt: Date
}
