// 校验线上 PWA：直接访问 GitHub Pages 地址，按 iPhone 15 Pro Max 视口渲染
// 用法：node tools/web-check-live.mjs
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const url = process.env.ASHARE_WEB_URL || 'https://fushon2000.github.io/ashare-yidong-radar/'
const root = process.cwd()
const shotDir = path.join(root, 'docs', 'screenshots')
fs.mkdirSync(shotDir, { recursive: true })

const state = {
  version: 2,
  groups: [{ id: 'default', name: '默认分组', order: 0 }],
  stocks: [
    { code: '600519', name: '贵州茅台', groupId: 'default', order: 0 },
    { code: '300750', name: '宁德时代', groupId: 'default', order: 1 },
    { code: '688981', name: '中芯国际', groupId: 'default', order: 2 }
  ],
  selectedCode: '600519',
  settings: {
    refreshMs: 30000,
    dataSource: 'auto',
    alertEnabled: true,
    alertCooldownMs: 600000,
    closeToTray: false,
    benchmarkMode: 'official',
    starBenchmark: '000680',
    countMode: 'step2',
    thresholds: {
      main3: 20, growth3: 30, st3: 20,
      severe10: 100, severe30: 200,
      severe10Down: -50, severe30Down: -70,
      countMain: 4, countGrowth: 3
    }
  }
}

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu']
})
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
await page.addInitScript((seed) => {
  localStorage.setItem('ashare-radar:state:v1', JSON.stringify(seed))
}, state)

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.getByText('贵州茅台').first().waitFor({ timeout: 30000 })
await page.waitForTimeout(6000)

const report = await page.evaluate(() => {
  const text = document.body.innerText
  const priceLine = text.match(/\d{2,4}\.\d{2}/)
  return {
    title: document.title,
    hasApi: typeof window.api === 'object',
    stock: text.includes('贵州茅台'),
    deviation: /3 日偏离/.test(text) && /10 日偏离/.test(text),
    outlook: /当日 \/ 第二日 \/ 第三日 触发测算/.test(text),
    loadError: /行情加载失败/.test(text),
    demoNotice: /当前为演示数据/.test(text),
    price: priceLine ? priceLine[0] : null,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    serviceWorker: 'serviceWorker' in navigator,
    panels: document.querySelectorAll('.panel').length,
    outlookPanel: document.querySelectorAll('.outlook-panel').length,
    excerpt: text.replace(/\s+/g, ' ').slice(0, 320)
  }
})
console.log('report', JSON.stringify(report, null, 2))
console.log('errors', errors)

await page.screenshot({ path: path.join(shotDir, 'web-live-iphone.png') })
try {
  const outlook = page.locator('.outlook-panel').first()
  if (await outlook.count()) {
    await outlook.scrollIntoViewIfNeeded({ timeout: 8000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(shotDir, 'web-live-outlook.png') })
    console.log('outlook screenshot ok')
  } else {
    console.log('outlook panel missing, skipped')
  }
} catch (e) {
  console.log('outlook screenshot failed:', e.message)
}

await browser.close()
