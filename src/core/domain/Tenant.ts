import type { Filter } from './Filter.js'

export type Channel = {
  type: 'telegram' | 'whatsapp'
  channelId: string
}

export type AffiliateConfig = {
  amazonTag?: string
  mlAppId?: string
  shopeeSourceId?: string
}

export type Tenant = {
  id: string
  name: string
  channels: Channel[]
  filters: Filter
  affiliates: AffiliateConfig
  active: boolean
}
