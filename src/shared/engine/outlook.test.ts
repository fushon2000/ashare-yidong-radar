import { describe, expect, it } from 'vitest'
import type { DailyBar } from '../types'
import { buildInstrument, severeCountFor, thresholdSetFor } from './rules'
import { buildAlignedSeries, computeAllWindows } from './series'
import { countStateOf, scanOccurrences, threeDayDeviation } from './counting'
import { buildOutlook, gainBudget, projectSeries, solveNeedUp } from './outlook'

function dateAt(index: number): string {
  const date = new Date(Date.UTC(2026, 0, 1))
  date.setUTCDate(date.getUTCDate() + index)
  return date.toISOString().slice(0, 10)
}

function barsFromPcts(pcts: number[], start = 100): DailyBar[] {
  let close = start
  return pcts.map((pct, index) => {
    const prev = close
    close = +(close * (1 + pct)).toFixed(6)
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

function flat(count: number): number[] {
  return Array.from({ length: count }, () => 0)
}

function seriesOf(pcts: number[]): ReturnType<typeof buildAlignedSeries> {
  return buildAlignedSeries(barsFromPcts(pcts), barsFromPcts(flat(pcts.length)))
}

describe('主板 ST 规则（2026-07-06 新《交易规则》）', () => {
  it('gives main-board ST the same 10% limit as ordinary main-board stocks', () => {
    expect(buildInstrument('600519', '*ST测试').limitPct).toBe(0.1)
    expect(buildInstrument('600519', '贵州茅台').limitPct).toBe(0.1)
  })

  it('uses a 20% 3-day threshold for main-board ST instead of the obsolete 12%', () => {
    expect(thresholdSetFor('SH_MAIN', true).ordinary3).toBe(20)
    expect(thresholdSetFor('SZ_MAIN', true).ordinary3).toBe(20)
  })

  it('keeps ChiNext / STAR ST at 20% limit and 30% threshold', () => {
    expect(buildInstrument('300750', '*ST测试').limitPct).toBe(0.2)
    expect(thresholdSetFor('CHINEXT', true).ordinary3).toBe(30)
    expect(thresholdSetFor('STAR', true).ordinary3).toBe(30)
  })
})

describe('10 日内同向异动次数', () => {
  it('requires 4 occurrences on the main board and 3 on ChiNext', () => {
    expect(severeCountFor('SH_MAIN')).toBe(4)
    expect(severeCountFor('SZ_MAIN')).toBe(4)
    expect(severeCountFor('CHINEXT')).toBe(3)
    expect(severeCountFor('STAR')).toBe(3)
  })

  it('computes the 3-day deviation from compounded interval returns', () => {
    const series = seriesOf([0.1, 0.1, 0.1])
    expect(threeDayDeviation(series, 2)).toBeCloseTo(33.1, 2)
  })

  // 实盘反推基准：浙江华生科技 2024-04-02「连续 9 个交易日涨停，发生四次异常波动」。
  it('counts a nine-day 10% streak as 4 occurrences under the default step2 mode', () => {
    const series = seriesOf([...flat(40), ...Array.from({ length: 9 }, () => 0.1)])
    const state = countStateOf(series, 20, 4, 'step2')
    expect(state.count).toBe(4)
    expect(state.triggered).toBe(true)
  })

  it('cannot fit 4 occurrences into 10 trading days with non-overlapping windows', () => {
    const series = seriesOf([...flat(40), ...Array.from({ length: 9 }, () => 0.1)])
    const state = countStateOf(series, 20, 4, 'step3')
    expect(state.count).toBe(3)
    expect(state.triggered).toBe(false)
  })

  it('counts a seven-day 20% streak as 3 occurrences on ChiNext', () => {
    const series = seriesOf([...flat(40), ...Array.from({ length: 7 }, () => 0.2)])
    const state = countStateOf(series, 30, 3, 'step2')
    expect(state.count).toBe(3)
    expect(state.triggered).toBe(true)
  })

  it('counts every qualifying window in rolling mode', () => {
    const series = seriesOf([...flat(40), ...Array.from({ length: 9 }, () => 0.1)])
    const rolling = scanOccurrences(series, 20, 'rolling')
    const step2 = scanOccurrences(series, 20, 'step2')
    expect(rolling.length).toBeGreaterThan(step2.length)
  })
})

describe('当日 / 第二日 / 第三日 / 第四日 / 第五日 测算', () => {
  it('needs +100% to reach the 10-day 100% threshold from a flat base', () => {
    const solved = solveNeedUp(seriesOf(flat(40)), 10, 0, 100)!
    expect(solved.needUpPct).toBeCloseTo(100, 6)
    expect(solved.deviationAt).toBeCloseTo(0, 6)
  })

  it('does not equal threshold minus current deviation', () => {
    // 30 天横盘后单日 +33%：当前 10 日偏离 33.0%，但再涨幅度不是 100 - 33.0。
    const pcts = flat(40)
    pcts[30] = 0.33
    const series = seriesOf(pcts)
    const solved = solveNeedUp(series, 10, 0, 100)!
    const naive = 100 - solved.deviationAt
    expect(solved.deviationAt).toBeCloseTo(33.0, 1)
    expect(naive).toBeCloseTo(67.0, 1)
    expect(solved.needUpPct).toBeLessThan(naive)
    expect(solved.needUpPct).toBeCloseTo((2 / 1.33 - 1) * 100, 4)
  })

  it('raises the required gain once the big up day rolls out of the window', () => {
    const pcts = flat(50)
    pcts[40] = 0.33
    const series = seriesOf(pcts)
    const today = solveNeedUp(series, 10, 0, 100)!
    const tomorrow = solveNeedUp(series, 10, 1, 100)!
    // 当日窗口含那根 +33% 阳线，第二日它滑出窗口，要求因此变高。
    expect(tomorrow.needUpPct).toBeGreaterThan(today.needUpPct)
    expect(tomorrow.needUpPct).toBeCloseTo(100, 6)
  })

  it('reports already-triggered when the window deviation is over the threshold', () => {
    const series = seriesOf([...flat(30), ...Array.from({ length: 10 }, () => 0.1)])
    const solved = solveNeedUp(series, 10, 0, 100)!
    expect(solved.deviationAt).toBeGreaterThan(100)
    expect(solved.needUpPct).toBeLessThanOrEqual(0)
  })

  it('computes the per-day gain budget from today\u2019s realised change', () => {
    expect(gainBudget(0.1, 0, 0)).toBeCloseTo(0.1, 6)
    expect(gainBudget(0.1, 1, 0)).toBeCloseTo(0.21, 6)
    // 今日已涨 5%，当日只剩约 4.76% 的额度
    expect(gainBudget(0.1, 0, 5)).toBeCloseTo(1.1 / 1.05 - 1, 6)
  })

  it('projects an intraday extra gain by rescaling only the last bar', () => {
    const series = seriesOf(flat(40))
    const projected = projectSeries(series, 0, 0.05)
    expect(projected).toHaveLength(series.length)
    expect(projected[projected.length - 1].stockPct).toBeCloseTo(0.05, 6)
    const appended = projectSeries(series, 2, 0.21)
    expect(appended).toHaveLength(series.length + 2)
    expect(appended[appended.length - 1].stockPct).toBeCloseTo(Math.sqrt(1.21) - 1, 6)
  })
})

describe('buildOutlook 输出', () => {
  it('returns five time points with deviation, required gain and price', () => {
    const series = seriesOf(flat(45))
    const result = buildOutlook({
      series,
      thresholds: thresholdSetFor('SH_MAIN', false),
      limitPct: 0.1,
      currentPrice: 100,
      countRequired: 4
    })
    expect(result.days.map((day) => day.label)).toEqual(['当日', '第二日', '第三日', '第四日', '第五日'])
    expect(result.days[0].date).toBe(series[series.length - 1].date)
    expect(result.days[1].date).toBeNull()
    expect(result.days[0].budgetPct).toBeCloseTo(10, 6)
    expect(result.days[1].budgetPct).toBeCloseTo(21, 6)
    const ten = result.days[0].severe.find((cell) => cell.window === 10)!
    expect(ten.needUpPct).toBeCloseTo(100, 6)
    expect(ten.targetPrice).toBe(200)
    // 主板 10% 涨停 → 需要 8 个涨停，当日不可能完成
    expect(ten.limitUpsNeeded).toBe(8)
    expect(ten.feasible).toBe(false)
  })

  it('marks the 10-day severe path as triggered when already over the threshold', () => {
    const series = seriesOf([...flat(35), ...Array.from({ length: 10 }, () => 0.1)])
    const result = buildOutlook({
      series,
      thresholds: thresholdSetFor('SH_MAIN', false),
      limitPct: 0.1,
      currentPrice: 100,
      countRequired: 4
    })
    const ten = result.days[0].severe.find((cell) => cell.window === 10)!
    expect(ten.triggered).toBe(true)
    expect(ten.needUpPct).toBeLessThanOrEqual(0)
  })

  it('shows the same day-0 deviation and trigger price as the deviation cards', () => {
    // 回归：真视通 2026-11-27 收盘，30 日触发价卡片 ¥36.42、测算表当日行
    // ¥36.43 —— 两条代数等价的公式在分位边界上算出了不同结果。当日行必须
    // 与卡片共用同一组窗口值，第二日起才没有卡片对照。
    const pcts = [...flat(35), 0.05, -0.02, 0.08, 0.03, -0.01, 0.07, 0.02, 0.04, -0.03, 0.06]
    const series = seriesOf(pcts)
    const thresholds = thresholdSetFor('SH_MAIN', false)
    const result = buildOutlook({
      series,
      thresholds,
      limitPct: 0.1,
      currentPrice: 100,
      countRequired: 4
    })
    const windows = computeAllWindows(series, thresholds)
    for (const window of [10, 30] as const) {
      const cell = result.days[0].severe.find((item) => item.window === window)!
      const card = windows.find((item) => item.window === window)!
      expect(cell.deviationAt).toBe(card.deviation)
      expect(cell.targetPrice).toBe(card.triggerPrice)
    }
    // 第二日起仍用闭式解，不受当日行复用影响。
    expect(result.days[1].severe.find((cell) => cell.window === 10)!.needUpPct).not.toBeNull()
  })

  it('reaches 4 occurrences at 8 limit-ups because each 3-day window is already 21%', () => {
    const series = seriesOf([...flat(40), ...Array.from({ length: 8 }, () => 0.1)])
    const state = countStateOf(series, 20, 4, 'step2')
    expect(state.count).toBe(4)
    expect(state.triggered).toBe(true)
  })

  it('cannot add a 4th occurrence inside the same day when the next window needs two more bars', () => {
    // 6 连板：已发生 3 次，第 4 次至少要到 T+2 收完一个完整的三日窗口。
    const series = seriesOf([...flat(40), ...Array.from({ length: 6 }, () => 0.1)])
    const result = buildOutlook({
      series,
      thresholds: thresholdSetFor('SH_MAIN', false),
      limitPct: 0.1,
      currentPrice: 100,
      countRequired: 4
    })
    expect(result.countState.count).toBe(3)
    expect(result.countState.triggered).toBe(false)
    expect(result.days[0].count.needUpPct).toBeNull()
    expect(result.days[1].count.needUpPct).toBeNull()
    expect(result.days[2].count.needUpPct).not.toBeNull()
  })
})
