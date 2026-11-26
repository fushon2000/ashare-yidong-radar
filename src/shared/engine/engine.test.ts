import { describe, expect, it } from 'vitest'
import type { AppSettings, DailyBar } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { buildInstrument, thresholdSetFor } from './rules'
import {
  buildAlignedSeries,
  computeAllWindows,
  computeWindowDeviation,
  roundPrice
} from './series'
import { forecastAll, previewUniformGain } from './forecast'
import { reviewHistory } from './history'

function dateAt(index: number): string {
  const date = new Date(Date.UTC(2026, 0, 1))
  date.setUTCDate(date.getUTCDate() + index)
  return date.toISOString().slice(0, 10)
}

function barsFromPcts(pcts: number[], start = 100): DailyBar[] {
  let close = start
  return pcts.map((pct, index) => {
    const prev = close
    close = +(close * (1 + pct)).toFixed(4)
    return {
      date: dateAt(index),
      open: prev,
      close,
      high: Math.max(prev, close),
      low: Math.min(prev, close),
      volume: 1000,
      pct: pct * 100
    }
  })
}

function flatBars(count: number, start = 100): DailyBar[] {
  return barsFromPcts(Array.from({ length: count }, () => 0), start)
}

describe('deviation engine', () => {
  it('uses compounded interval returns, not summed daily returns', () => {
    const stock = [0.1, 0.1, 0.1]
    const index = [0, 0, 0]
    const series = buildAlignedSeries(barsFromPcts(stock), barsFromPcts(index))
    const result = computeWindowDeviation(series, 3, 20, -20)!
    expect(result.stockReturn).toBeCloseTo(0.331, 6)
    expect(result.deviation).toBeCloseTo(33.1, 2)
  })

  it('computes 10-day deviation as the difference of both interval returns', () => {
    const stock = Array.from({ length: 10 }, () => 0.01)
    const index = Array.from({ length: 10 }, () => 0.002)
    const series = buildAlignedSeries(barsFromPcts(stock), barsFromPcts(index))
    const result = computeWindowDeviation(series, 10, 100, -50)!
    const expected = (Math.pow(1.01, 10) - 1) * 100 - (Math.pow(1.002, 10) - 1) * 100
    expect(result.deviation).toBeCloseTo(expected, 2)
    expect(result.startDate).toBe(series[0].date)
    expect(result.endDate).toBe(series[9].date)
  })

  it('marks a threshold as triggered and computes the theoretical trigger price', () => {
    const stock = Array.from({ length: 10 }, () => 0.08)
    const index = Array.from({ length: 10 }, () => 0)
    const series = buildAlignedSeries(barsFromPcts(stock), barsFromPcts(index))
    const result = computeWindowDeviation(series, 10, 100, -50)!
    expect(result.triggered).toBe(true)
    expect(result.triggerPrice).toBeGreaterThan(0)
  })

  it('rounds prices to the nearest cent', () => {
    expect(roundPrice(2.675)).toBe(2.68)
    expect(roundPrice(10.004)).toBe(10)
    expect(roundPrice(10.005)).toBe(10.01)
  })

  it('maps boards and benchmarks correctly', () => {
    const settings: AppSettings = { ...DEFAULT_SETTINGS }
    expect(buildInstrument('600519', '贵州茅台', settings).benchmarkCode).toBe('000002')
    expect(buildInstrument('000001', '平安银行', settings).benchmarkCode).toBe('399107')
    expect(buildInstrument('300750', '宁德时代', settings).benchmarkCode).toBe('399102')
    expect(buildInstrument('688981', '中芯国际', settings).benchmarkCode).toBe('000680')
    // 2026-07-06 新《交易规则》：主板风险警示股涨跌幅由 ±5% 放宽至 ±10%。
    expect(buildInstrument('600519', '*ST测试', settings).limitPct).toBe(0.1)
    expect(buildInstrument('300750', '*ST测试', settings).limitPct).toBe(0.2)
    // 对应异常波动阈值由 ±12% 调整为 ±20%，与主板一致。
    expect(thresholdSetFor('SH_MAIN', true, settings.thresholds).ordinary3).toBe(20)
  })
})

describe('forecast engine', () => {
  it('is impossible for a main-board stock to reach 30-day 200% in five limit-ups', () => {
    const series = buildAlignedSeries(flatBars(40), flatBars(40))
    const instrument = buildInstrument('600519', '贵州茅台')
    const thresholds = thresholdSetFor('SH_MAIN', false)
    const result = forecastAll(series, {
      thresholds,
      limitPct: instrument.limitPct,
      currentPrice: 100
    })
    const ten = result.limitUp.find((row) => row.window === 10)!
    const thirty = result.limitUp.find((row) => row.window === 30)!
    expect(ten.possible).toBe(false)
    expect(thirty.possible).toBe(false)
    expect(thirty.maxFiveDayGain).toBeCloseTo(61.051, 2)
  })

  it('can trigger 10-day severe with four 20% limit-ups on ChiNext', () => {
    const series = buildAlignedSeries(flatBars(40), flatBars(40))
    const instrument = buildInstrument('300750', '宁德时代')
    const thresholds = thresholdSetFor('CHINEXT', false)
    const result = forecastAll(series, {
      thresholds,
      limitPct: instrument.limitPct,
      currentPrice: 100
    })
    const ten = result.limitUp.find((row) => row.window === 10)!
    expect(ten.possible).toBe(true)
    expect(ten.firstTriggerDay).toBe(4)
    expect(ten.gainAtTrigger).toBeCloseTo(107.36, 1)
  })

  it('returns a per-window uniform gain and a preview', () => {
    const series = buildAlignedSeries(flatBars(40), flatBars(40))
    const thresholds = thresholdSetFor('SH_MAIN', false)
    const result = forecastAll(series, {
      thresholds,
      limitPct: 0.2,
      currentPrice: 100
    })
    const ten = result.uniform.find((row) => row.window === 10)!
    expect(ten.possible).toBe(true)
    expect(ten.gainAtT5).toBeGreaterThan(99)
    const preview = previewUniformGain(series, thresholds, 80)
    expect(preview.max10).toBeGreaterThan(60)
  })
})

describe('history review', () => {
  it('finds the first actual severe trigger in the following five days', () => {
    const before = Array.from({ length: 45 }, () => 0)
    const run = Array.from({ length: 5 }, () => 0.2)
    const after = Array.from({ length: 10 }, () => 0)
    const series = buildAlignedSeries(
      barsFromPcts([...before, ...run, ...after]),
      flatBars(60)
    )
    const thresholds = thresholdSetFor('SH_MAIN', false)
    const review = reviewHistory(series, thresholds, series[44].date)!
    expect(review.future).toHaveLength(5)
    expect(review.firstSevereWindow).toBe(10)
    expect(review.firstSevereDate).toBe(series[48].date)
  })

  it('reports incomplete when there are fewer than five future bars', () => {
    const series = buildAlignedSeries(flatBars(40), flatBars(40))
    const review = reviewHistory(series, thresholdSetFor('SH_MAIN', false), series[38].date)!
    expect(review.complete).toBe(false)
    expect(review.future).toHaveLength(1)
  })
})
