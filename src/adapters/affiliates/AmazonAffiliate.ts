import axios from 'axios'

const ASSOCIATE_TAG = process.env.AMAZON_ASSOCIATE_TAG ?? 'thaisbonomi-20'

function extractAsin(url: string): string | null {
  const match = url.match(/\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/([A-Z0-9]{10})/i)
  return match ? match[1].toUpperCase() : null
}

async function expandShortLink(url: string): Promise<string> {
  try {
    const res = await axios.get(url, {
      maxRedirects: 5,
      timeout: 8000,
      validateStatus: () => true,
    })
    return (res.request as { res?: { responseUrl?: string } }).res?.responseUrl ?? url
  } catch {
    return url
  }
}

export async function injectAmazonTag(url: string): Promise<string> {
  try {
    let resolved = url
    if (url.includes('a.co') || url.includes('amzn.to')) {
      resolved = await expandShortLink(url)
    }
    const asin = extractAsin(resolved)
    if (asin) {
      return `https://www.amazon.com.br/dp/${asin}?tag=${ASSOCIATE_TAG}`
    }
    const parsed = new URL(resolved)
    parsed.searchParams.set('tag', ASSOCIATE_TAG)
    return parsed.toString()
  } catch {
    return url
  }
}

export function isAmazonUrl(url: string): boolean {
  return url.includes('amazon.com.br') || url.includes('amzn.to') || url.includes('a.co')
}
