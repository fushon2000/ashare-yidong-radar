import type { CountMode, CountState, OrdinaryOccurrence } from '../types'
import type { AlignedRow } from './series'

/**
 * 每次达标之后，下一个窗口可以在多少天之后才允许再次达标。
 * - step2（默认）：触发当日起算，下一窗口落在 [end, end+1, end+2]，与上一次重叠 1 个交易日
 * - step3：触发次一交易日起算，严格不重叠
 * - rolling：每个达标窗口都计 1 次
 *
 * 交易所只公布「10 个交易日内 N 次」的次数要求，未公布计数算法。默认的 step2
 * 是按实盘公告反推的：浙江华生科技 9 连板 → 4 次、艾艾精工 10 个交易日内 4 次，
 * 只有允许窗口重叠才可能成立。详见 docs/SPEC-v1.1.md。
 */
const STEP: Record<CountMode, number> = { step2: 2, step3: 3, rolling: 1 }

/** 以 end 为最后一日的 3 日区间复利涨幅差（百分点）。 */
export function threeDayDeviation(rows: AlignedRow[], end: number): number {
  let stock = 1
  let index = 1
  for (let i = end - 2; i <= end; i++) {
    stock *= 1 + rows[i].stockPct
    index *= 1 + rows[i].indexPct
  }
  return (stock - index) * 100
}

/**
 * 按给定口径贪心扫描整个序列，返回每一次「3 日内偏离值累计达标」的情形。
 * 只做同向判断：direction = 1 只认上涨方向，-1 只认下跌方向。
 */
export function scanOccurrences(
  rows: AlignedRow[],
  ordinary3: number,
  mode: CountMode = 'step2',
  direction: 1 | -1 = 1
): OrdinaryOccurrence[] {
  if (rows.length < 3) return []
  const step = STEP[mode] ?? STEP.step2
  const result: OrdinaryOccurrence[] = []
  let nextAllowed = 2
  for (let end = 2; end < rows.length; end++) {
    if (end < nextAllowed) continue
    const deviation = threeDayDeviation(rows, end)
    const hit = direction > 0 ? deviation >= ordinary3 : deviation <= -ordinary3
    if (!hit) continue
    result.push({ index: end, date: rows[end].date, deviation, direction })
    nextAllowed = end + step
  }
  return result
}

/**
 * 最近 10 个交易日内的同向异动次数状态。
 * 交易所口径为「连续十个交易日内」，因此只统计落在末尾 10 个交易日窗口内的情形。
 */
export function countStateOf(
  rows: AlignedRow[],
  ordinary3: number,
  required: number,
  mode: CountMode = 'step2',
  direction: 1 | -1 = 1
): CountState {
  const occurrences = scanOccurrences(rows, ordinary3, mode, direction)
  const end = rows.length - 1
  const start = end - 9
  const inWindow = occurrences.filter((item) => item.index >= start && item.index <= end)
  return {
    required,
    count: inWindow.length,
    triggered: inWindow.length >= required,
    windowStart: rows.length > 0 ? rows[Math.max(0, start)].date : null,
    windowEnd: rows.length > 0 ? rows[end].date : null,
    occurrences: inWindow,
    mode,
    ordinary3
  }
}
