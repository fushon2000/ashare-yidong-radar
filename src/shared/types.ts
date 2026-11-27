export type Board = 'SH_MAIN' | 'SZ_MAIN' | 'CHINEXT' | 'STAR'
export type Market = 'SH' | 'SZ'
export type Scenario = 'UNIFORM' | 'LIMIT_UP'
export type DataSource = 'auto' | 'eastmoney' | 'tencent'
export type BenchmarkMode = 'official' | 'common'
export type StarBenchmark = '000680' | '000688'

/**
 * 「10 日内 N 次同向异动」的计数口径。交易所只公布次数要求，没有公布
 * 具体计数算法，因此这里提供三档，默认按实盘公告反推的 step2。
 * - step2：触发当日起算下一窗口（重叠 1 个交易日，每次前进 2 日）
 * - step3：触发次一交易日起算（严格不重叠，贴合“指标自公布次一交易日重新计算”）
 * - rolling：每个达标的三日窗口各计 1 次
 */
export type CountMode = 'step2' | 'step3' | 'rolling'

export interface Instrument {
  code: string
  name: string
  board: Board
  market: Market
  isST: boolean
  limitPct: number
  benchmarkCode: string
  benchmarkName: string
  isIndex?: boolean
}

export interface Quote {
  code: string
  name: string
  price: number
  prevClose: number
  open: number
  high: number
  low: number
  change: number
  changePct: number
  timestamp: number
  tradeDate?: string
  source: string
  stale?: boolean
}

export interface DailyBar {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount?: number
  pct?: number
}

export interface SearchHit {
  code: string
  name: string
  board: Board
  market: Market
  isST: boolean
}

export interface StockSnapshot {
  instrument: Instrument
  quote: Quote
  benchmark: Instrument
  benchmarkQuote: Quote
  bars: DailyBar[]
  benchmarkBars: DailyBar[]
  asOf: string
  fetchedAt: number
  source: string
  stale: boolean
  warnings: string[]
  demo?: boolean
}

export interface RuleThresholds {
  main3: number
  growth3: number
  st3: number
  severe10: number
  severe30: number
  severe10Down: number
  severe30Down: number
  /** 10 个交易日内构成严重异动的同向异动次数，沪深主板 */
  countMain: number
  /** 同上，创业板 / 科创板 */
  countGrowth: number
}

export interface ThresholdSet {
  ordinary3: number
  severe10: number
  severe30: number
  severe10Down: number
  severe30Down: number
}

export interface WindowDeviation {
  window: 3 | 10 | 30
  deviation: number
  threshold: number
  thresholdDown: number
  utilization: number
  triggered: boolean
  triggeredDown: boolean
  triggerPrice: number | null
  stockReturn: number
  indexReturn: number
  startDate: string
  endDate: string
  baseStockPrice: number | null
  baseIndexPrice: number | null
}

export interface ForecastRow {
  window: 3 | 10 | 30
  scenario: Scenario
  threshold: number
  currentDeviation: number
  triggeredNow: boolean
  firstTriggerDay: number | null
  gainAtTrigger: number | null
  gainAtT5: number | null
  triggerPrice: number | null
  limitUpsNeeded: number | null
  maxFiveDayGain: number
  possible: boolean
}

export interface ForecastResult {
  uniform: ForecastRow[]
  limitUp: ForecastRow[]
  severeSummary: {
    uniform: string
    limitUp: string
  }
}

/** 一次「3 日内偏离值累计达标」的常规异动情形。 */
export interface OrdinaryOccurrence {
  /** 达标窗口的结束交易日在该序列中的下标 */
  index: number
  date: string
  /** 3 日区间复利涨幅差（百分点） */
  deviation: number
  direction: 1 | -1
}

/** 「10 日内 N 次同向异动」的当前状态。 */
export interface CountState {
  /** 构成严重异动所需的次数，主板 4 / 双创 3 */
  required: number
  /** 最近 10 个交易日内已出现的同向异动次数 */
  count: number
  triggered: boolean
  /** 计数窗口（最近 10 个交易日）起止日期 */
  windowStart: string | null
  windowEnd: string | null
  /** 落在计数窗口内的达标情形 */
  occurrences: OrdinaryOccurrence[]
  /** 计数口径 */
  mode: CountMode
  /** 3 日常规异动阈值 */
  ordinary3: number
}

/** 某个时点上「再涨多少触发某条严重异动标准」的结果。 */
export interface OutlookCell {
  /** 10 日 +100% 或 30 日 +200% */
  window: 10 | 30
  threshold: number
  /** 该时点若不再上涨的偏离值（用于展示窗口滚动效应） */
  deviationAt: number
  /** 相对现价还需上涨的百分比；0 表示无需上涨；null 表示该时点额度内无法达成 */
  needUpPct: number | null
  /** 到位时的股价 */
  targetPrice: number | null
  /** 约需几个涨停 */
  limitUpsNeeded: number | null
  /** 该时点的涨跌幅额度内能否实现 */
  feasible: boolean
  /** 不再上涨即已达标 */
  triggered: boolean
}

/** 次数型路径在某个时点的「再涨多少触发」。 */
export interface OutlookCountCell {
  required: number
  /** 该时点若不再上涨的累计次数 */
  countAt: number
  needUpPct: number | null
  limitUpsNeeded: number | null
  feasible: boolean
  triggered: boolean
}

export interface OutlookDay {
  /** 0 = 当日，1 = 第二日，2 = 第三日，3 = 第四日，4 = 第五日 */
  day: 0 | 1 | 2 | 3 | 4
  label: string
  /** 该时点窗口滚动后的日期（未来日期未知，仅当日有真实日期） */
  date: string | null
  /** 该时点的涨跌幅额度：从现价起最多还能涨多少（百分点） */
  budgetPct: number
  severe: OutlookCell[]
  count: OutlookCountCell
}

export interface OutlookResult {
  days: OutlookDay[]
  countState: CountState
  /** 个股涨跌幅限制 */
  limitPct: number
  /** 当日实际涨幅（百分比） */
  todayPct: number
  /** 计算说明 */
  notes: string[]
}

export interface HistoryFutureRow {
  day: number
  date: string
  stockClose: number
  indexClose: number
  stockPct: number
  indexPct: number
  deviation10: number
  deviation30: number
  triggered10: boolean
  triggered30: boolean
  triggered3: boolean
}

export interface HistoryReview {
  date: string
  deviations: WindowDeviation[]
  future: HistoryFutureRow[]
  firstSevereDate: string | null
  firstSevereWindow: 10 | 30 | null
  complete: boolean
}

export interface AppSettings {
  refreshMs: number
  dataSource: DataSource
  alertEnabled: boolean
  alertCooldownMs: number
  closeToTray: boolean
  benchmarkMode: BenchmarkMode
  starBenchmark: StarBenchmark
  thresholds: RuleThresholds
  /** 「10 日内 N 次同向异动」计数口径 */
  countMode: CountMode
}

export interface StockEntry {
  code: string
  name: string
  groupId: string
  order: number
  note?: string
}

export interface StockGroup {
  id: string
  name: string
  order: number
}

export interface PersistedState {
  version: number
  groups: StockGroup[]
  stocks: StockEntry[]
  selectedCode: string | null
  settings: AppSettings
}

export interface CsvRow {
  group: string
  code: string
  name: string
  note: string
}

export interface NotifyPayload {
  title: string
  body: string
  code?: string
}

export interface FileResult {
  canceled: boolean
  path?: string
  content?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  refreshMs: 5000,
  dataSource: 'auto',
  alertEnabled: true,
  alertCooldownMs: 10 * 60 * 1000,
  closeToTray: true,
  benchmarkMode: 'official',
  starBenchmark: '000680',
  countMode: 'step2',
  thresholds: {
    main3: 20,
    growth3: 30,
    // 2026-07-06 新《交易规则》：主板风险警示股涨跌幅由 ±5% 放宽至 ±10%，
    // 对应异常波动偏离值阈值由 ±12% 调整为 ±20%，与主板一致。
    st3: 20,
    severe10: 100,
    severe30: 200,
    severe10Down: -50,
    severe30Down: -70,
    countMain: 4,
    countGrowth: 3
  }
}

export const DEFAULT_STATE: PersistedState = {
  version: 2,
  groups: [{ id: 'default', name: '默认分组', order: 0 }],
  stocks: [],
  selectedCode: null,
  settings: DEFAULT_SETTINGS
}
