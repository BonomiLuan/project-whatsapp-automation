import axios from 'axios'
import type { MessagePayload } from '../adapters/publishers/format.js'

const BASE_URL = 'https://graph.facebook.com/v25.0'

export async function sendOfferMessage(payload: MessagePayload): Promise<string> {
  const token = process.env.ACCESS_TOKEN
  const phoneNumberId = process.env.PHONE_NUMBER_ID
  const to = process.env.MY_PHONE_NUMBER
  const templateName = process.env.TEMPLATE_NAME || 'affiliate_offer'

  if (!token || !phoneNumberId || !to) {
    throw new Error(
      'Credenciais Meta não configuradas. Preencha ACCESS_TOKEN, PHONE_NUMBER_ID e MY_PHONE_NUMBER no .env'
    )
  }

  const isTestTemplate = templateName === 'hello_world'

  // hello_world is Meta's built-in test template: no parameters, language en_US
  // affiliate_offer is our custom template: image header + 5 body variables, language pt_BR
  const template = isTestTemplate
    ? { name: templateName, language: { code: 'en_US' } }
    : {
        name: templateName,
        language: { code: 'pt_BR' },
        components: [
          ...(payload.imageUrl ? [{
            type: 'header',
            parameters: [{ type: 'image', image: { link: payload.imageUrl } }],
          }] : []),
          {
            type: 'body',
            parameters: [
              { type: 'text', text: payload.name },
              { type: 'text', text: payload.price },
              { type: 'text', text: payload.coupon },
              { type: 'text', text: payload.affiliateUrl },
              { type: 'text', text: payload.groupUrl },
            ],
          },
        ],
      }

  const body = { messaging_product: 'whatsapp', to, type: 'template', template }

  const endpoint = `${BASE_URL}/${phoneNumberId}/messages`
  console.log(`[meta] POST ${endpoint}`)
  console.log(`[meta] to=${to} template=${templateName} lang=${template.language.code}`)

  try {
    const response = await axios.post(endpoint, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
    console.log(`[meta] ✓ response:`, JSON.stringify(response.data))
    return response.data.messages?.[0]?.id || 'sent'
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status
      const data = JSON.stringify(err.response?.data)
      console.error(`[meta] ✗ HTTP ${status} — ${data}`)
      throw new Error(`Meta API erro ${status}: ${data}`)
    }
    throw err
  }
}
