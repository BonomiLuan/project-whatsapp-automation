import { scrapeProduct } from './productScraper.js'

const url = process.argv[2]
if (!url) {
  console.error('Uso: npm run scrape:test <url-do-produto>')
  process.exit(1)
}

console.log(`\nExtraindo dados de: ${url}\n`)
const product = await scrapeProduct(url)

console.log('Nome:    ', product.name)
console.log('Preço:   ', product.price)
console.log('Imagem:  ', product.imageUrl)
