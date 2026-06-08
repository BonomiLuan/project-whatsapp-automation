const ASSOCIATE_TAG = 'thaisbonomi-20'

function extractAsin(url: string): string | null {
  const match = url.match(/\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/([A-Z0-9]{10})/i)
  return match ? match[1].toUpperCase() : null
}

export function injectAmazonTag(url: string): string {
  try {
    const asin = extractAsin(url)
    if (asin) {
      return `https://www.amazon.com.br/dp/${asin}?tag=${ASSOCIATE_TAG}`
    }
    // Fallback: keep original URL, just add/replace tag
    const parsed = new URL(url)
    parsed.searchParams.set('tag', ASSOCIATE_TAG)
    return parsed.toString()
  } catch {
    return url
  }
}

export function isAmazonUrl(url: string): boolean {
  return url.includes('amazon.com.br') || url.includes('amzn.to')
}
