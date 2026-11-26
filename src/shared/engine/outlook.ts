import type {
  CountMode,
  OutlookCell,
  OutlookCountCell,
  OutlookDay,
  OutlookResult,
  ThresholdSet
} from '../types'
import type { AlignedRow } from './series'
import { roundPrice } from './series'
import { countStateOf } from './counting'

export interface OutlookInput {
  series: AlignedRow[]
  thresholds: ThresholdSet
  limitPct: number
  currentPrice: number
  /** 构成严重异动所需的同向异动次数：主板 4 / 双创 3 */
  countRequired: number
  countMode?: CountMode
  /** 未来交易日基准指数涨幅假设（百分比），默认 0 */
  indexFuturePct?: number
  countDirection?: 1 | -1
}

/**
 * 把「从现价起再涨 gain」这个假设拼进序列。
 *
 * - day = 0：只改今日那一行的收益，等价于今日收盘价在现价基础上再涨 gain
 * - day > 0：追加 day 行，每日涨幅按 (1 + gain)^(1/day) - 1 均匀分配
 */
export function projectSeries(
  series: AlignedRow[],
  day: 0 | 1 | 2,
  gain: number,
  indexFuture = 0
): AlignedRow[] {
  if (series.length === 0) return series
  const last = series[series.length - 1]
  if (day === 0) {
    const rows = series.slice()
    rows[rows.length - 1] = {
      ...last,
      stockPct: (1 + last.stockPct) * (1 + gain) - 1
    }
    return rows
  }
  const rows = series.slice()
  const dailyStock = Math.pow(1 + gain, 1 / day) - 1
  for (let i = 1; i <= day; i++) {
    rows.push({
      ...last,
      date: `T+${i}`,
      stockPct: dailyStock,
      indexPct: indexFuture,
      stockClose: last.stockClose * Math.pow(1 + dailyStock, i),
      indexClose: last.indexClose,
      stockPrevClose: i === 1 ? last.stockClose : last.stockClose * Math.pow(1 + dailyStock, i - 1),
      indexPrevClose: last.indexClose,
      suspended: false
    })
  }
  return rows
}

/**
 * 某个时点的涨跌幅额度：从现价起最多还能涨多少。
 *
 * 今日剩余额度 = (1 + limit) / (1 + 今日已实现涨幅) - 1；
 * 到第 d 日共有 d + 1 个额度（今日剩余 + 之后 d 个交易日）。
 */
export function gainBudget(limitPct: number, day: 0 | 1 | 2, todayPct: number): number {
  if (!(limitPct > 0)) return 0
  const base = 1 + todayPct / 100
  if (base <= 0) return 0
  return Math.pow(1 + limitPct, day + 1) / base - 1
}

interface WindowProducts {
  /** 窗口内已知交易日的个股复利乘积 */
  stock: number
  /** 窗口内已知交易日的指数复利乘积 */
  index: number
  /** 窗口内尚未发生的交易日数 */
  futureDays: number
  /** 窗口左端是否越过数据起点（数据不足） */
  truncated: boolean
}

function windowProducts(
  series: AlignedRow[],
  window: 10 | 30,
  day: 0 | 1 | 2,
  indexFuture: number
): WindowProducts {
  const n = series.length
  const end = n - 1 + day
  const start = end - window + 1
  const knownEnd = Math.min(end, n - 1)
  const knownStart = Math.max(start, 0)
  let stock = 1
  let index = 1
  for (let i = knownStart; i <= knownEnd; i++) {
    stock *= 1 + series[i].stockPct
    index *= 1 + series[i].indexPct
  }
  const futureDays = end - knownEnd
  return {
    stock,
    index: index * Math.pow(1 + indexFuture, futureDays),
    futureDays,
    truncated: start < 0
  }
}

function limitUpsFor(needPct: number, limitPct: number): number | null {
  if (limitPct <= 0) return null
  if (needPct <= 0) return 0
  return Math.ceil(Math.log(1 + needPct / 100) / Math.log(1 + limitPct))
}

/**
 * 求解「到该时点收盘累计再涨多少百分比」才会让窗口偏离值越过阈值。
 *
 * 闭式解：偏离值 = P_stk × (1 + R) − P_idx，要求 ≥ θ
 *   ⇒ R = (θ + P_idx) / P_stk − 1
 *
 * 注意 R 不等于「阈值 − 当前偏离值」：再涨的百分比是乘在已膨胀的基期上的。
 */
export function solveNeedUp(
  series: AlignedRow[],
  window: 10 | 30,
  day: 0 | 1 | 2,
  thresholdPct: number,
  indexFuture = 0
): { needUpPct: number; deviationAt: number } | null {
  const products = windowProducts(series, window, day, indexFuture)
  if (products.truncated || products.stock <= 0) return null
  const theta = thresholdPct / 100
  const onePlus = (theta + products.index) / products.stock
  return {
    needUpPct: (onePlus - 1) * 100,
    deviationAt: (products.stock - products.index) * 100
  }
}

/**
 * 次数型路径：求最小累计再涨幅度，使最近 10 个交易日内的同向异动次数达到要求。
 *
 * 计数依赖窗口内每一天的收益分布，因此必须假设日间均匀分配；同时贪心扫描在
 * 理论上不严格单调，这里先粗扫再二分。
 */
function solveCountNeed(
  series: AlignedRow[],
  day: 0 | 1 | 2,
  maxGain: number,
  indexFuture: number,
  hit: (rows: AlignedRow[]) => boolean
): number | null {
  const predicate = (gain: number): boolean =>
    hit(projectSeries(series, day, gain, indexFuture))
  if (maxGain <= 0) return predicate(0) ? 0 : null
  if (predicate(0)) return 0
  const grid = 240
  let previous = 0
  let found: number | null = null
  for (let i = 1; i <= grid; i++) {
    const gain = (maxGain * i) / grid
    if (predicate(gain)) {
      found = gain
      break
    }
    previous = gain
  }
  if (found === null) return null
  let low = previous
  let high = found
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2
    if (predicate(mid)) high = mid
    else low = mid
  }
  return high
}

const DAY_LABELS: Record<0 | 1 | 2, string> = { 0: '当日', 1: '第二日', 2: '第三日' }
const ALL_DAYS = [0, 1, 2] as const
const ALL_WINDOWS = [10, 30] as const

/**
 * 当日 / 第二日 / 第三日 三个时点的严重异动触发测算。
 *
 * 口径（详见 docs/SPEC-v1.1.md）：「再涨 X%」= 相对现价，到该时点收盘为止
 * 累计需要再上涨的百分比。基准指数未来默认不再变动。
 */
export function buildOutlook(input: OutlookInput): OutlookResult {
  const { series, thresholds, limitPct, currentPrice, countRequired } = input
  const mode = input.countMode ?? 'step2'
  const indexFuture = (input.indexFuturePct ?? 0) / 100
  const direction = input.countDirection ?? 1
  const todayPct = series.length > 0 ? series[series.length - 1].stockPct * 100 : 0
  const countState = countStateOf(series, thresholds.ordinary3, countRequired, mode, direction)
  const notes: string[] = []

  if (series.length === 0) {
    notes.push('暂无行情数据，无法测算。')
  } else if (series.length < 30) {
    notes.push(`历史数据仅 ${series.length} 个交易日，30 日窗口暂不可算。`)
  }

  const days: OutlookDay[] = ALL_DAYS.map((day) => {
    const budget = gainBudget(limitPct, day, todayPct)

    const severe: OutlookCell[] = ALL_WINDOWS.map((window) => {
      const threshold = window === 10 ? thresholds.severe10 : thresholds.severe30
      const solved = solveNeedUp(series, window, day, threshold, indexFuture)
      const needUpPct = solved === null ? null : solved.needUpPct
      const rawNeed = needUpPct !== null && needUpPct > 0 ? needUpPct : 0
      return {
        window,
        threshold,
        deviationAt: solved?.deviationAt ?? 0,
        needUpPct,
        targetPrice: rawNeed > 0 ? roundPrice(currentPrice * (1 + rawNeed / 100)) : null,
        limitUpsNeeded: needUpPct === null ? null : limitUpsFor(rawNeed, limitPct),
        feasible: needUpPct !== null && rawNeed / 100 <= budget + 1e-9,
        triggered: needUpPct !== null && needUpPct <= 0
      }
    })

    const countOf = (rows: AlignedRow[]): number =>
      countStateOf(rows, thresholds.ordinary3, countRequired, mode, direction).count
    const countAt = countOf(series.length === 0 ? series : projectSeries(series, day, 0, indexFuture))
    // 次数型的求解上限：额度内的现实值，另外放宽到 300% 以便在“该时点做不到”时
    // 仍能给出一个参考数字，再通过 feasible 标注不可实现。
    const searchCap = Math.max(budget, 3)
    const countGain = solveCountNeed(
      series,
      day,
      searchCap,
      indexFuture,
      (rows) => countOf(rows) >= countRequired
    )
    const countNeedPct = countGain === null ? null : Math.max(0, countGain * 100)
    const count: OutlookCountCell = {
      required: countRequired,
      countAt,
      needUpPct: countNeedPct,
      limitUpsNeeded: countNeedPct === null ? null : limitUpsFor(countNeedPct, limitPct),
      feasible: countNeedPct !== null && countNeedPct / 100 <= budget + 1e-9,
      triggered: countAt >= countRequired
    }

    return {
      day,
      label: DAY_LABELS[day],
      date: day === 0 ? series[series.length - 1]?.date ?? null : null,
      budgetPct: budget * 100,
      severe,
      count
    }
  })

  if (countState.triggered) {
    notes.push(`当前已触及「10 日内 ${countState.required} 次同向异动」的严重异动标准。`)
  }

  return {
    days,
    countState,
    limitPct,
    todayPct,
    notes
  }
}
