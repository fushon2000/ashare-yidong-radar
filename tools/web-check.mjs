// 网页版（PWA）在 iPhone 视口下的真实渲染检查
// 用法：node tools/web-check.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = process.cwd()
const distDir = path.join(root, 'dist-web')
const BASE = '/ashare-yidong-radar'
const port = 4188
const shotDir = path.join(root, 'docs', 'screenshots')
fs.mkdirSync(shotDir, { recursive: true })

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
}

const server = http.createServer((req, res) => {
  const raw = decodeURIComponent((req.url || '/').split('?')[0])
  let relative = raw.startsWith(BASE) ? raw.slice(BASE.length) : raw
  if (relative === '' || relative === '/') relative = '/index.html'
  const filePath = path.join(distDir, relative.replace(/^\/+/, ''))
  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
})
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))

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
// iPhone 15 Pro Max: 430 x 932 CSS px
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
await page.addInitScript((seed) => {
  localStorage.setItem('ashare-radar:state:v1', JSON.stringify(seed))
}, state)

await page.goto(`http://127.0.0.1:${port}${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
await page.screenshot({ path: path.join(shotDir, 'web-loading.png') })

// 等真实行情到位（出现股票名与偏离值）
await page.getByText('贵州茅台').first().waitFor({ timeout: 25000 })
await page.waitForTimeout(6000)

const report = await page.evaluate(() => {
  const txt = document.body.innerText
  return {
    hasApi: typeof window.api === 'object',
    hasStock: txt.includes('贵州茅台'),
    hasDeviation: /3 日偏离/.test(txt),
    hasOutlook: /当日 \/ 第二日 \/ 第三日 触发测算/.test(txt),
    hasError: /行情加载失败|加载失败/.test(txt),
    demoTag: txt.includes('演示'),
    bodyWidth: document.body.scrollWidth,
    viewport: window.innerWidth,
    overflowX: document.documentElement.scrollWidth > window.innerWidth
  }
})
console.log('report', report)

await page.screenshot({ path: path.join(shotDir, 'web-iphone-top.png') })

// 逐段截图：卡片 / 模拟 / 测算表 / 设置
const shotSection = async (selector, name, offset = 0) => {
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) return
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  if (offset) await page.locator('.main-panel').evaluate((node, y) => { node.scrollTop += y }, offset)
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(shotDir, name) })
}

await shotSection('.cards-grid', 'web-iphone-cards.png')
await shotSection('.sim-panel', 'web-iphone-sim.png')
await shotSection('.outlook-panel', 'web-iphone-outlook.png')
await shotSection('.trend-panel', 'web-iphone-trend.png')

// 设置弹窗（顶栏齿轮按钮，aria-label = 设置）
await page.getByRole('button', { name: '设置' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: path.join(shotDir, 'web-iphone-settings.png') })
await page.locator('.settings-modal').screenshot({ path: path.join(shotDir, 'web-iphone-settings-panel.png') }).catch(() => {})

console.log('errors', errors)
await browser.close()
server.close()
