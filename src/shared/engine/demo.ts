import type {
  AppSettings,
  DailyBar,
  Instrument,
  Quote,
  StockSnapshot
} from '../types'
import { buildInstrument, benchmarkNameFor } from './rules'

interface DemoProfile {
  name: string
  base: number
  drift: number
  vol: number
  runDays: number
  runDrift: number
}

const PROFILES: Record<string, DemoProfile> = {
  '600519': { name: '贵州茅台', base: 1430, drift: 0.0004, vol: 0.009, runDays: 18, runDrift: 0.018 },
  '300750': { name: '宁德时代', base: 196, drift: 0.0012, vol: 0.018, runDays: 26, runDrift: 0.045 },
  '688981': { name: '中芯国际', base: 108, drift: 0.0008, vol: 0.022, runDays: 22, runDrift: 0.033 }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function dateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function tradingDates(count: number): string[] {
  const dates: string[] = []
  const cursor = new Date()
  cursor.setHours(12, 0, 0, 0)
  while (dates.length < count) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) dates.push(dateString(cursor))
    cursor.setDate(cursor.getDate() - 1)
  }
  return dates.reverse()
}

function generateBars(
  dates: string[],
  profile: DemoProfile,
  seed: number,
  index = false
): DailyBar[] {
  const random = mulberry32(seed)
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
      pct: Math.round(((close / prev) - 1) * 10000) / 100
    }
  })
}

function quoteFromBars(code: string, name: string, bars: DailyBar[]): Quote {
  const last = bars[bars.length - 1]
  const prev = bars[bars.length - 2]
  const change = last.close - prev.close
  return {
    code,
    name,
    price: last.close,
    prevClose: prev.close,
    open: last.open,
    high: last.high,
    low: last.low,
    change,
    changePct: (change / prev.close) * 100,
    timestamp: Date.now(),
    tradeDate: last.date,
    source: 'demo',
    stale: true
  }
}

export function makeDemoSnapshot(
  code: string,
  settings: AppSettings
): StockSnapshot | null {
  const profile = PROFILES[code]
  if (!profile) return null
  const instrument = buildInstrument(code, profile.name, settings)
  const dates = tradingDates(160)
  const bars = generateBars(dates, profile, Number(code) + 17)
  const benchmarkProfile: DemoProfile = {
    name: benchmarkNameFor(instrument.benchmarkCode),
    base: instrument.benchmarkCode.startsWith('399') ? 1900 : 3500,
    drift: 0.0002,
    vol: 0.006,
    runDays: 0,
    runDrift: 0
  }
  const benchmarkBars = generateBars(dates, benchmarkProfile, Number(code) + 991, true)
  const benchmark: Instrument = {
    code: instrument.benchmarkCode,
    name: benchmarkProfile.name,
    board: instrument.board,
    market: instrument.market,
    isST: false,
    limitPct: 0,
    benchmarkCode: instrument.benchmarkCode,
    benchmarkName: benchmarkProfile.name,
    isIndex: true
  }
  const quote = quoteFromBars(instrument.code, instrument.name, bars)
  const benchmarkQuote = quoteFromBars(benchmark.code, benchmark.name, benchmarkBars)
  return {
    instrument,
    quote,
    benchmark,
    benchmarkQuote,
    bars,
    benchmarkBars,
    asOf: bars[bars.length - 1].date,
    fetchedAt: Date.now(),
    source: 'demo',
    stale: true,
    warnings: ['演示数据，仅用于界面体验；请添加真实股票查看实时行情'],
    demo: true
  }
}
