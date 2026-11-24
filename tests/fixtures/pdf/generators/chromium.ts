import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('file://' + process.argv[2])
await page.evaluate(() => document.fonts.ready)
await page.pdf({ path: process.argv[3], preferCSSPageSize: true, printBackground: true })
await browser.close()
