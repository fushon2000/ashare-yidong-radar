import type {
  ForecastResult,
  ForecastRow,
  Scenario,
  ThresholdSet,
  WindowDeviation
} from '../types'
import type { AlignedRow } from './series'
import { computeAllWindows, lastWindow, roundPrice } from './series'

export interface ForecastOptions {
  thresholds: ThresholdSet
  limitPct: number
  currentPrice: number
  indexDailyPct?: number
  days?: number
}

interface PathHit {
  day: number
  windows: Array<10 | 30>
}

function pctAt(
  histStock: number[],
  histIndex: number[],
  futureStock: number[],
  futureIndex: number[],
  day: number,
  window: 3 | 10 | 30
): number | null {
  const allStock = histStock.concat(futureStock.slice(0, day))
  const allIndex = histIndex.concat(futureIndex.slice(0, day))
  if (allStock.length < window) return null
  let s = 1
  let i = 1
  for (const pct of allStock.slice(-window)) s *= 1 + pct
  for (const pct of allIndex.slice(-window)) i *= 1 + pct
  return (s - i) * 100
}

function firstHitForWindow(
  histStock: number[],
  histIndex: number[],
  futureStock: number[],
  futureIndex: number[],
  window: 3 | 10 | 30,
  threshold: number
): number | null {
  for (let day = 1; day <= futureStock.length; day++) {
    const value = pctAt(histStock, histIndex, futureStock, futureIndex, day, window)
    if (value !== null && value >= threshold) return day
  }
  return null
}

function firstSevereHit(
  histStock: number[],
  histIndex: number[],
  futureStock: number[],
  futureIndex: number[],
  thresholds: ThresholdSet
): PathHit | null {
  for (let day = 1; day <= futureStock.length; day++) {
    const ten = pctAt(histStock, histIndex, futureStock, futureIndex, day, 10)
    const thirty = pctAt(histStock, histIndex, futureStock, futureIndex, day, 30)
    const windows: Array<10 | 30> = []
    if (ten !== null && ten >= thresholds.severe10) windows.push(10)
    if (thirty !== null && thirty >= thresholds.severe30) windows.push(30)
    if (windows.length > 0) return { day, windows }
  }
  return null
}

function makeFuture(
  days: number,
  stockDaily: number,
  indexDaily: number
): { stock: number[]; index: number[] } {
  return {
    stock: Array.from({ length: days }, () => stockDaily),
    index: Array.from({ length: days }, () => indexDaily)
  }
}

function maxLimitGain(limitPct: number, days: number): number {
  if (limitPct <= 0) return 2
  return Math.pow(1 + limitPct, days) - 1
}

function ordinaryThreshold(thresholds: ThresholdSet): number {
  return thresholds.ordinary3
}

function rowForWindow(
  window: 3 | 10 | 30,
  scenario: Scenario,
  threshold: number,
  current: WindowDeviation | undefined,
  currentPrice: number,
  firstDay: number | null,
  gainAtTrigger: number | null,
  gainAtT5: number | null,
  maxFiveDayGain: number,
  limitPct: number,
  limitUpsNeeded: number | null
): ForecastRow {
  return {
    window,
    scenario,
    threshold,
    currentDeviation: current?.deviation ?? 0,
    triggeredNow: !!current?.triggered,
    firstTriggerDay: firstDay,
    gainAtTrigger,
    gainAtT5,
    triggerPrice: gainAtTrigger === null ? null : roundPrice(currentPrice * (1 + gainAtTrigger / 100)),
    limitUpsNeeded,
    maxFiveDayGain,
    possible: firstDay !== null
  }
}

/** Solve the smallest 5-day cumulative stock gain that triggers a specific window. */
function solveUniformWindow(
  histStock: number[],
  histIndex: number[],
  window: 3 | 10 | 30,
  threshold: number,
  maxGain: number,
  indexDailyPct: number
): { day: number; r5: number } | null {
  const days = 5
  const check = (r5: number): number | null => {
    const daily = Math.pow(1 + r5, 1 / days) - 1
    const future = makeFuture(days, daily, indexDailyPct / 100)
    return firstHitForWindow(histStock, histIndex, future.stock, future.index, window, threshold)
  }
  if (check(0) !== null) return { day: 0, r5: 0 }
  if (check(maxGain) === null) return null
  let low = 0
  let high = maxGain
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2
    if (check(mid) !== null) high = mid
    else low = mid
  }
  const day = check(high)
  return day === null ? null : { day, r5: high }
}

/** Solve the smallest 5-day gain that triggers either 10-day or 30-day severe. */
function solveUniformSevere(
  histStock: number[],
  histIndex: number[],
  thresholds: ThresholdSet,
  maxGain: number,
  indexDailyPct: number
): { day: number; r5: number; windows: Array<10 | 30> } | null {
  const days = 5
  const check = (r5: number): PathHit | null => {
    const daily = Math.pow(1 + r5, 1 / days) - 1
    const future = makeFuture(days, daily, indexDailyPct / 100)
    return firstSevereHit(histStock, histIndex, future.stock, future.index, thresholds)
  }
  if (check(0) !== null) {
    const hit = check(0)!
    return { day: 0, r5: 0, windows: hit.windows }
  }
  if (check(maxGain) === null) return null
  let low = 0
  let high = maxGain
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2
    if (check(mid) !== null) high = mid
    else low = mid
  }
  const hit = check(high)
  return hit === null ? null : { day: hit.day, r5: high, windows: hit.windows }
}

function summaryText(
  scenario: Scenario,
  current: WindowDeviation[],
  severe: { day: number; r5: number; windows: Array<10 | 30> } | null
): string {
  const currentSevere = current.filter((item) => item.window !== 3 && item.triggered)
  if (currentSevere.length > 0) {
    return `当前已触发严重异动：${currentSevere.map((item) => `${item.window}日`).join('、')}`
  }
  if (!severe) {
    return scenario === 'UNIFORM'
      ? '5 日内均匀上涨无法触发严重异动'
      : '5 个涨停内无法触发严重异动'
  }
  if (severe.day === 0) {
    return `当前已触发严重异动：${severe.windows.map((w) => `${w}日`).join('、')}`
  }
  const label = scenario === 'UNIFORM' ? '均匀上涨' : '连续涨停'
  const gainLabel = scenario === 'UNIFORM' ? '5 日累计' : '触发时累计'
  return `${label}：${severe.windows.map((w) => `${w}日`).join(' / ')} 于 T+${severe.day} 先触发，${gainLabel}约 ${severe.r5 * 100 >= 0 ? '+' : ''}${(severe.r5 * 100).toFixed(2)}%`
}

export function forecastAll(
  series: AlignedRow[],
  options: ForecastOptions
): ForecastResult {
  const days = options.days ?? 5
  const indexDailyPct = options.indexDailyPct ?? 0
  const current = computeAllWindows(series, options.thresholds)
  const histStock = series.map((row) => row.stockPct)
  const histIndex = series.map((row) => row.indexPct)
  const limitPct = options.limitPct
  const maxGain = maxLimitGain(limitPct, days)
  const maxFiveDayGain = maxGain * 100

  const windowConfigs: Array<{ window: 3 | 10 | 30; threshold: number }> = [
    { window: 3, threshold: ordinaryThreshold(options.thresholds) },
    { window: 10, threshold: options.thresholds.severe10 },
    { window: 30, threshold: options.thresholds.severe30 }
  ]

  // Uniform scenario: each row solves its own minimum 5-day gain.
  const uniform: ForecastRow[] = windowConfigs.map(({ window, threshold }) => {
    const currentRow = lastWindow(current, window)
    if (currentRow?.triggered) {
      return rowForWindow(
        window, 'UNIFORM', threshold, currentRow, options.currentPrice,
        0, 0, 0, maxFiveDayGain, limitPct, 0
      )
    }
    const solved = solveUniformWindow(
      histStock, histIndex, window, threshold, maxGain, indexDailyPct
    )
    if (!solved) {
      return rowForWindow(
        window, 'UNIFORM', threshold, currentRow, options.currentPrice,
        null, null, null, maxFiveDayGain, limitPct, null
      )
    }
    const daily = Math.pow(1 + solved.r5, 1 / days) - 1
    const gainAtTrigger = (Math.pow(1 + daily, solved.day) - 1) * 100
    const limitUps = limitPct > 0 && solved.r5 > 0
      ? Math.ceil(Math.log(1 + solved.r5) / Math.log(1 + limitPct))
      : solved.r5 === 0 ? 0 : null
    return rowForWindow(
      window, 'UNIFORM', threshold, currentRow, options.currentPrice,
      solved.day, gainAtTrigger, solved.r5 * 100, maxFiveDayGain, limitPct, limitUps
    )
  })

  const uniformSevere = solveUniformSevere(
    histStock, histIndex, options.thresholds, maxGain, indexDailyPct
  )

  // Limit-up scenario: a single fixed path, then each window reports its own hit.
  const limitFuture = makeFuture(days, limitPct > 0 ? limitPct : 0, indexDailyPct / 100)
  const limitUp: ForecastRow[] = windowConfigs.map(({ window, threshold }) => {
    const currentRow = lastWindow(current, window)
    if (currentRow?.triggered) {
      return rowForWindow(
        window, 'LIMIT_UP', threshold, currentRow, options.currentPrice,
        0, 0, 0, maxFiveDayGain, limitPct, 0
      )
    }
    if (limitPct <= 0) {
      return rowForWindow(
        window, 'LIMIT_UP', threshold, currentRow, options.currentPrice,
        null, null, null, maxFiveDayGain, limitPct, null
      )
    }
    const day = firstHitForWindow(
      histStock, histIndex, limitFuture.stock, limitFuture.index, window, threshold
    )
    if (day === null) {
      return rowForWindow(
        window, 'LIMIT_UP', threshold, currentRow, options.currentPrice,
        null, null, null, maxFiveDayGain, limitPct, null
      )
    }
    const gainAtTrigger = (Math.pow(1 + limitPct, day) - 1) * 100
    return rowForWindow(
      window, 'LIMIT_UP', threshold, currentRow, options.currentPrice,
      day, gainAtTrigger, maxFiveDayGain, maxFiveDayGain, limitPct, day
    )
  })

  const limitSevereHit = firstSevereHit(
    histStock, histIndex, limitFuture.stock, limitFuture.index, options.thresholds
  )
  const limitSevere = limitSevereHit
    ? {
        day: limitSevereHit.day,
        r5: Math.pow(1 + (limitPct > 0 ? limitPct : 0), limitSevereHit.day) - 1,
        windows: limitSevereHit.windows
      }
    : null

  return {
    uniform,
    limitUp,
    severeSummary: {
      uniform: summaryText('UNIFORM', current, uniformSevere),
      limitUp: summaryText('LIMIT_UP', current, limitSevere)
    }
  }
}

/** Preview a user-chosen 5-day cumulative gain under a uniform daily path. */
export function previewUniformGain(
  series: AlignedRow[],
  thresholds: ThresholdSet,
  totalGainPct: number,
  indexDailyPct = 0,
  days = 5
): { max10: number; max30: number; max3: number; triggered: boolean } {
  const daily = Math.pow(1 + totalGainPct / 100, 1 / days) - 1
  const future = makeFuture(days, daily, indexDailyPct / 100)
  const histStock = series.map((row) => row.stockPct)
  const histIndex = series.map((row) => row.indexPct)
  let max10 = -Infinity
  let max30 = -Infinity
  let max3 = -Infinity
  for (let day = 1; day <= days; day++) {
    const ten = pctAt(histStock, histIndex, future.stock, future.index, day, 10)
    const thirty = pctAt(histStock, histIndex, future.stock, future.index, day, 30)
    const three = pctAt(histStock, histIndex, future.stock, future.index, day, 3)
    if (ten !== null) max10 = Math.max(max10, ten)
    if (thirty !== null) max30 = Math.max(max30, thirty)
    if (three !== null) max3 = Math.max(max3, three)
  }
  return {
    max10: Number.isFinite(max10) ? max10 : 0,
    max30: Number.isFinite(max30) ? max30 : 0,
    max3: Number.isFinite(max3) ? max3 : 0,
    triggered: max10 >= thresholds.severe10 || max30 >= thresholds.severe30
  }
}
