import type {
  DailyBar,
  Quote,
  ThresholdSet,
  WindowDeviation
} from '../types'

export interface AlignedRow {
  date: string
  stockClose: number
  indexClose: number
  stockPct: number
  indexPct: number
  stockPrevClose: number
  indexPrevClose: number
  suspended?: boolean
}

export function roundPrice(value: number): number {
  return Math.round((value + 1e-9) * 100) / 100
}

export function formatDateCN(timestamp: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestamp))
}

function pctFromBars(bar: DailyBar, prevClose?: number): number {
  if (typeof bar.pct === 'number' && Number.isFinite(bar.pct)) {
    return bar.pct / 100
  }
  if (prevClose && prevClose > 0) {
    return bar.close / prevClose - 1
  }
  return 0
}

function validQuote(quote?: Quote): quote is Quote {
  return !!quote && Number.isFinite(quote.price) && quote.price > 0 &&
    Number.isFinite(quote.prevClose) && quote.prevClose > 0
}

function shanghaiClock(): { weekend: boolean; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date())
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  return {
    weekend: weekday === 'Sat' || weekday === 'Sun',
    minutes: hour * 60 + minute
  }
}

function resolveLiveDate(quote: Quote | undefined, lastIndexDate: string | undefined): string | undefined {
  if (!validQuote(quote)) return undefined
  const quoteDate = quote.tradeDate || formatDateCN(quote.timestamp)
  if (!lastIndexDate) return quoteDate
  if (quoteDate <= lastIndexDate) return quoteDate
  const clock = shanghaiClock()
  if (clock.weekend || clock.minutes < 9 * 60 + 15) {
    // Pre-open and weekend quotes still belong to the previous trading day.
    return lastIndexDate
  }
  return quoteDate
}

/**
 * Align stock and benchmark bars by benchmark trading dates. Suspended stock
 * days carry the previous close and a 0% daily return. A live quote replaces
 * the matching last bar or appends a new trading day when the K-line lags.
 */
export function buildAlignedSeries(
  stockBars: DailyBar[],
  indexBars: DailyBar[],
  stockQuote?: Quote,
  indexQuote?: Quote
): AlignedRow[] {
  const stocks = [...stockBars].sort((a, b) => a.date.localeCompare(b.date))
  const indexes = [...indexBars].sort((a, b) => a.date.localeCompare(b.date))
  if (indexes.length === 0) return []

  const stockMap = new Map(stocks.map((bar) => [bar.date, bar]))
  const indexMap = new Map(indexes.map((bar) => [bar.date, bar]))
  const dates = indexes.map((bar) => bar.date)

  const lastIndexDate = dates[dates.length - 1]
  const quoteDate = resolveLiveDate(stockQuote, lastIndexDate)
  const indexQuoteDate = resolveLiveDate(indexQuote, lastIndexDate)
  const liveDate = quoteDate || indexQuoteDate

  if (liveDate && dates.length > 0) {
    if (liveDate > dates[dates.length - 1]) {
      dates.push(liveDate)
    } else if (liveDate < dates[dates.length - 1]) {
      // Stale quote: ignore it rather than attaching it to the wrong day.
    }
  }

  const rows: AlignedRow[] = []
  let lastStockClose: number | null = null
  let lastIndexClose: number | null = null

  for (const date of dates) {
    const isLive = !!liveDate && date === liveDate
    const stockBar = stockMap.get(date)
    const indexBar = indexMap.get(date)

    let stockClose: number | null = null
    let stockPrevClose: number | null = null
    let stockPct: number | null = null

    if (isLive && validQuote(stockQuote)) {
      stockClose = stockQuote.price
      stockPrevClose = stockQuote.prevClose
      stockPct = stockQuote.changePct / 100
    } else if (stockBar) {
      stockClose = stockBar.close
      const prevBar = stocks[stocks.indexOf(stockBar) - 1]
      stockPrevClose = prevBar?.close ?? null
      stockPct = pctFromBars(stockBar, stockPrevClose ?? undefined)
    } else if (lastStockClose !== null) {
      stockClose = lastStockClose
      stockPrevClose = lastStockClose
      stockPct = 0
    }

    let indexClose: number | null = null
    let indexPrevClose: number | null = null
    let indexPct: number | null = null

    if (isLive && validQuote(indexQuote)) {
      indexClose = indexQuote.price
      indexPrevClose = indexQuote.prevClose
      indexPct = indexQuote.changePct / 100
    } else if (indexBar) {
      indexClose = indexBar.close
      const prevBar = indexes[indexes.indexOf(indexBar) - 1]
      indexPrevClose = prevBar?.close ?? null
      indexPct = pctFromBars(indexBar, indexPrevClose ?? undefined)
    } else if (lastIndexClose !== null) {
      indexClose = lastIndexClose
      indexPrevClose = lastIndexClose
      indexPct = 0
    }

    if (stockClose === null || indexClose === null) {
      continue
    }

    const suspended = !stockBar && !isLive
    rows.push({
      date,
      stockClose,
      indexClose,
      stockPct: stockPct ?? 0,
      indexPct: indexPct ?? 0,
      stockPrevClose: stockPrevClose ?? stockClose,
      indexPrevClose: indexPrevClose ?? indexClose,
      suspended
    })
    lastStockClose = stockClose
    lastIndexClose = indexClose
  }

  return rows
}

export function compoundReturn(rows: AlignedRow[], key: 'stockPct' | 'indexPct'): number {
  return rows.reduce((acc, row) => acc * (1 + row[key]), 1) - 1
}

export function computeWindowDeviation(
  series: AlignedRow[],
  window: 3 | 10 | 30,
  thresholdUp: number,
  thresholdDown: number
): WindowDeviation | null {
  if (series.length < window) return null
  const rows = series.slice(-window)
  if (rows.some((row) => !Number.isFinite(row.stockPct) || !Number.isFinite(row.indexPct))) {
    return null
  }
  const stockReturn = compoundReturn(rows, 'stockPct')
  const indexReturn = compoundReturn(rows, 'indexPct')
  const deviation = (stockReturn - indexReturn) * 100
  const baseRow = series[series.length - window - 1]
  const currentPrice = series[series.length - 1].stockClose
  const baseStockPrice = baseRow?.stockClose ?? currentPrice / (1 + stockReturn)
  const baseIndexPrice = baseRow?.indexClose ?? series[series.length - 1].indexClose / (1 + indexReturn)
  const triggerPriceRaw = baseStockPrice * (1 + thresholdUp / 100 + indexReturn)
  const utilization = deviation >= 0
    ? thresholdUp === 0 ? 0 : deviation / thresholdUp
    : thresholdDown === 0 ? 0 : Math.abs(deviation / thresholdDown)

  return {
    window,
    deviation,
    threshold: thresholdUp,
    thresholdDown,
    utilization,
    triggered: deviation >= thresholdUp,
    triggeredDown: deviation <= thresholdDown,
    triggerPrice: baseStockPrice > 0 ? roundPrice(triggerPriceRaw) : null,
    stockReturn,
    indexReturn,
    startDate: rows[0].date,
    endDate: rows[rows.length - 1].date,
    baseStockPrice: baseStockPrice > 0 ? baseStockPrice : null,
    baseIndexPrice: baseIndexPrice > 0 ? baseIndexPrice : null
  }
}

export function computeAllWindows(
  series: AlignedRow[],
  thresholds: ThresholdSet
): WindowDeviation[] {
  const result: WindowDeviation[] = []
  const three = computeWindowDeviation(series, 3, thresholds.ordinary3, -thresholds.ordinary3)
  const ten = computeWindowDeviation(series, 10, thresholds.severe10, thresholds.severe10Down)
  const thirty = computeWindowDeviation(series, 30, thresholds.severe30, thresholds.severe30Down)
  if (three) result.push(three)
  if (ten) result.push(ten)
  if (thirty) result.push(thirty)
  return result
}

export function lastWindow(
  windows: WindowDeviation[],
  window: 3 | 10 | 30
): WindowDeviation | undefined {
  return windows.find((item) => item.window === window)
}

export function severeUtilization(windows: WindowDeviation[]): number {
  const ten = lastWindow(windows, 10)
  const thirty = lastWindow(windows, 30)
  const values = [ten?.utilization ?? 0, thirty?.utilization ?? 0]
  return Math.max(...values)
}

export function maxSevereDeviation(windows: WindowDeviation[]): number {
  const ten = lastWindow(windows, 10)
  const thirty = lastWindow(windows, 30)
  return Math.max(ten?.deviation ?? -Infinity, thirty?.deviation ?? -Infinity)
}

export function isSevereTriggered(windows: WindowDeviation[]): boolean {
  return windows.some((item) => item.window !== 3 && item.triggered)
}

export function futurePrice(price: number, dailyPct: number, days: number): number {
  return price * Math.pow(1 + dailyPct, days)
}
