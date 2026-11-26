import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = process.cwd()
const rendererDir = path.join(root, 'out', 'renderer')
const port = 4173

function dateString(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function tradingDates(count) {
  const dates = []
  const cursor = new Date()
  cursor.setHours(12, 0, 0, 0)
  while (dates.length < count) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) dates.push(dateString(cursor))
    cursor.setDate(cursor.getDate() - 1)
  }
  return dates.reverse()
}

function generateBars(dates, profile, seed, index = false) {
  let state = seed >>> 0
  const random = () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let close = profile.base
  return dates.map((date, i) => {
    const inRun = i >= dates.length - profile.runDays
    const drift = inRun ? profile.runDrift : profile.drift
    const noise = (random() - 0.5) * 2 * profile.vol
    const pct = index ? 0.001 + noise * 0.25 : drift + noise
    const prev = close
    close = Math.max(1, close * (1 + pct))
    const open = prev * (1 + (random() - 0.5) * 0.006)
    const high = Math.max(open, close) * (1 + random() * 0.008)
    const low = Math.min(open, close) * (1 - random() * 0.008)
    return {
      date,
      open: Math.round(open * 100) / 100,
      close: Math.round(close * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      volume: Math.round(30000 + random() * 90000),
      pct: Math.round((close / prev - 1) * 10000) / 100
    }
  })
}

function quote(code, name, bars) {
  const last = bars[bars.length - 1]
  const prev = bars[bars.length - 2]
  return {
    code,
    name,
    price: last.close,
    prevClose: prev.close,
    open: last.open,
    high: last.high,
    low: last.low,
    change: last.close - prev.close,
    changePct: (last.close / prev.close - 1) * 100,
    timestamp: Date.now(),
    tradeDate: last.date,
    source: 'demo',
    stale: true
  }
}

function snapshot(code, name, board, benchmarkCode, benchmarkName, profile, benchmarkProfile) {
  const dates = tradingDates(90)
  const bars = generateBars(dates, profile, Number(code) + 17)
  const benchmarkBars = generateBars(dates, benchmarkProfile, Number(code) + 991, true)
  return {
    instrument: {
      code,
      name,
      board,
      market: board === 'SH_MAIN' || board === 'STAR' ? 'SH' : 'SZ',
      isST: false,
      limitPct: board === 'CHINEXT' || board === 'STAR' ? 0.2 : 0.1,
      benchmarkCode,
      benchmarkName
    },
    quote: quote(code, name, bars),
    benchmark: {
      code: benchmarkCode,
      name: benchmarkName,
      board,
      market: board === 'SH_MAIN' || board === 'STAR' ? 'SH' : 'SZ',
      isST: false,
      limitPct: 0,
      benchmarkCode,
      benchmarkName,
      isIndex: true
    },
    benchmarkQuote: quote(benchmarkCode, benchmarkName, benchmarkBars),
    bars,
    benchmarkBars,
    asOf: bars[bars.length - 1].date,
    fetchedAt: Date.now(),
    source: 'demo',
    stale: true,
    warnings: ['演示数据，仅用于界面体验'],
    demo: true
  }
}

const snapshots = {
  '600519': snapshot(
    '600519', '贵州茅台', 'SH_MAIN', '000002', '上证A股指数',
    // 近 6 日加速上涨：主板 3 日偏离越过 20%，用来展示「10 日内同向异动」的计数状态。
    { base: 1430, drift: 0.0004, vol: 0.003, runDays: 6, runDrift: 0.095 },
    { base: 3500, drift: 0.0002, vol: 0.006, runDays: 0, runDrift: 0 }
  ),
  '300750': snapshot(
    '300750', '宁德时代', 'CHINEXT', '399102', '创业板综指',
    { base: 196, drift: 0.0012, vol: 0.004, runDays: 4, runDrift: 0.1 },
    { base: 1900, drift: 0.0002, vol: 0.006, runDays: 0, runDrift: 0 }
  ),
  '688981': snapshot(
    '688981', '中芯国际', 'STAR', '000680', '科创综指',
    { base: 108, drift: 0.0008, vol: 0.022, runDays: 22, runDrift: 0.033 },
    { base: 1200, drift: 0.0002, vol: 0.006, runDays: 0, runDrift: 0 }
  )
}

const state = {
  version: 2,
  groups: [{ id: 'default', name: '默认分组', order: 0 }],
  stocks: [],
  selectedCode: null,
  settings: {
    refreshMs: 60000,
    dataSource: 'auto',
    alertEnabled: true,
    alertCooldownMs: 600000,
    closeToTray: true,
    benchmarkMode: 'official',
    starBenchmark: '000680',
    countMode: 'step2',
    thresholds: {
      main3: 20,
      growth3: 30,
      st3: 20,
      severe10: 100,
      severe30: 200,
      severe10Down: -50,
      severe30Down: -70,
      countMain: 4,
      countGrowth: 3
    }
  }
}

const server = http.createServer((req, res) => {
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0])
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '')
  const filePath = path.join(rendererDir, relative)
  if (!filePath.startsWith(rendererDir) || !fs.existsSync(filePath)) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  const ext = path.extname(filePath)
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  }
  res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
})

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
console.log('server', `http://127.0.0.1:${port}`)

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu']
})
const page = await browser.newPage({ viewport: { width: 1460, height: 920 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})

await page.addInitScript(({ snapshots, state }) => {
  const api = {
    market: {
      search: async () => [],
      getSnapshot: async (request) => {
        const hit = snapshots[request.code]
        if (!hit) throw new Error('没有演示数据')
        return hit
      },
      getQuotes: async (codes) => {
        const result = {}
        for (const code of codes) {
          if (snapshots[code]) result[code] = snapshots[code].quote
        }
        return result
      },
      clearCache: async () => true
    },
    state: {
      load: async () => state,
      save: async (next) => next
    },
    notify: { show: async () => true },
    csv: {
      export: async () => ({ canceled: true }),
      import: async () => ({ canceled: true })
    },
    app: {
      quit: async () => undefined,
      onSelectStock: () => () => undefined,
      onRefresh: () => () => undefined
    }
  }
  window.api = api
}, { snapshots, state })

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' })
const shotDir = path.join(root, 'docs', 'screenshots')
fs.mkdirSync(shotDir, { recursive: true })
const shot = (name) => path.join(shotDir, name)
await page.screenshot({ path: shot('ui-empty.png'), fullPage: true })
await page.getByRole('button', { name: /先看演示数据/ }).click()
await page.getByText('贵州茅台').first().waitFor({ timeout: 8000 })
await page.waitForTimeout(800)

const dismissToasts = async () => {
  const closes = page.locator('.toast-close')
  const count = await closes.count()
  for (let i = 0; i < count; i++) await closes.nth(i).click().catch(() => {})
  await page.waitForTimeout(150)
}

await dismissToasts()
await page.screenshot({ path: shot('ui-demo.png'), fullPage: true })

// 新的「当日 / 第二日 / 第三日」测算面板：在真实（未拖动）状态下整块截图。
const outlook = page.locator('.outlook-panel')
await outlook.scrollIntoViewIfNeeded()
await page.waitForTimeout(300)
await outlook.screenshot({ path: shot('ui-outlook-main.png') })

// 切换创业板，核对「3 次」口径与 20% 涨停幅度。
await page.getByText('宁德时代').first().click()
await page.waitForTimeout(900)
await page.locator('.outlook-panel').scrollIntoViewIfNeeded()
await page.waitForTimeout(300)
await page.locator('.outlook-panel').screenshot({ path: shot('ui-outlook-chinext.png') })
await page.getByText('贵州茅台').first().click()
await page.waitForTimeout(900)
await page.locator('.main-panel').evaluate((el) => { el.scrollTop = 0 })

const sliders = page.locator('input[type="range"]')
await sliders.first().evaluate((el) => {
  const input = el
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '5')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.waitForTimeout(600)
await page.screenshot({ path: shot('ui-sim.png'), fullPage: true })
await page.locator('.main-panel').evaluate((el) => { el.scrollTop = el.scrollHeight })
await page.waitForTimeout(400)
await page.screenshot({ path: shot('ui-trend.png'), fullPage: true })
await page.locator('.main-panel').evaluate((el) => { el.scrollTop = 0 })

await page.getByRole('button', { name: /历史复盘/ }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: shot('ui-history.png'), fullPage: true })

// 设置弹窗
await page.getByRole('button', { name: '设置' }).click()
await page.waitForTimeout(400)
await page.locator('.settings-modal').screenshot({ path: shot('ui-settings.png') })
await page.keyboard.press('Escape').catch(() => {})
await page.locator('.modal-overlay').click({ position: { x: 8, y: 8 } }).catch(() => {})

console.log('errors', errors)
await browser.close()
server.close()
