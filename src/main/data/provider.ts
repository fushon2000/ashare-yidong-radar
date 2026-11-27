import type {
  AppSettings,
  DailyBar,
  Quote,
  SearchHit,
  StockSnapshot
} from '../../shared/types'
import {
  benchmarkCodeFor,
  buildInstrument,
  inferBoard,
  isSupportedCode,
  normalizeCode
} from '../../shared/engine/rules'
import { makeDemoSnapshot } from '../../shared/engine/demo'
import { formatDateCN } from '../../shared/engine/series'
import { EastmoneySource } from './eastmoney'
import { TencentSource } from './tencent'
import { indexInstrument } from './symbols'

/**
 * 缓存的最小契约。桌面版用 FileCache（fs），网页版用 localStorage 实现，
 * 两者都满足这个结构，因此 provider 本身与运行平台无关。
 */
export interface SnapshotCache {
  get<T>(key: string): Promise<{ fetchedAt: number; value: T } | null>
  set<T>(key: string, value: T, fetchedAt?: number): Promise<void>
  clear(): Promise<void>
}

export interface MarketSource {
  readonly name: string
  search(query: string): Promise<SearchHit[]>
  getQuotes(codes: string[], indexCodes?: Set<string>): Promise<Record<string, Quote>>
  getKline(code: string, isIndex: boolean, limit?: number): Promise<DailyBar[]>
}

interface KlineCacheValue {
  bars: DailyBar[]
  source: string
}

interface SnapshotOptions {
  settings: AppSettings
  demo?: boolean
  forceRefresh?: boolean
}

interface KlineResult {
  bars: DailyBar[]
  source: string
  stale: boolean
  fetchedAt: number
}

const KLINE_TTL = 10 * 60 * 1000

function shanghaiClock(): { weekday: string; minutes: number } {
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
  return { weekday, minutes: hour * 60 + minute }
}

function resolveQuoteDate(quote: Quote, bars: DailyBar[]): void {
  const lastDate = bars[bars.length - 1]?.date
  if (!lastDate) return
  const today = formatDateCN(Date.now())
  const { weekday, minutes } = shanghaiClock()
  if (lastDate >= today) {
    quote.tradeDate = lastDate
    return
  }
  const weekend = weekday === 'Sat' || weekday === 'Sun'
  const beforeOpen = minutes < 9 * 60 + 15
  if (weekend || beforeOpen) {
    quote.tradeDate = lastDate
    return
  }
  // Intraday/after-close and the daily K-line lags: attach the live quote to today.
  quote.tradeDate = today
}

export class MarketDataProvider {
  private readonly sources: MarketSource[]

  constructor(
    private readonly cache: SnapshotCache,
    private readonly settings: () => AppSettings,
    /** 可通过该参数调整主备源顺序：网页版把腾讯放在前面（东财对浏览器屏蔽个股实时价） */
    sources?: MarketSource[]
  ) {
    this.sources = sources ?? [new EastmoneySource(), new TencentSource()]
  }

  private activeSources(preferred = this.settings().dataSource): MarketSource[] {
    if (preferred === 'auto') return this.sources
    // 按来源名称筛选，而不是按下标，避免自定义顺序后语义错乱
    return this.sources.filter((source) => source.name === preferred)
  }

  async search(query: string): Promise<SearchHit[]> {
    const trimmed = query.trim()
    if (!trimmed) return []
    for (const source of this.activeSources()) {
      try {
        const hits = await source.search(trimmed)
        if (hits.length > 0) return hits
      } catch {
        // try next source
      }
    }
    if (/^\d{6}$/.test(trimmed) && isSupportedCode(trimmed)) {
      const instrument = buildInstrument(trimmed, trimmed, this.settings())
      return [{
        code: instrument.code,
        name: instrument.name,
        board: instrument.board,
        market: instrument.market,
        isST: instrument.isST
      }]
    }
    return []
  }

  async getQuotes(codes: string[], indexCodes: Set<string> = new Set()): Promise<Record<string, Quote>> {
    const normalized = [...new Set(codes.map(normalizeCode).filter((code) => isSupportedCode(code) || indexCodes.has(code)))]
    if (normalized.length === 0) return {}
    let lastError: unknown = null
    for (const source of this.activeSources()) {
      try {
        return await source.getQuotes(normalized, indexCodes)
      } catch (error) {
        lastError = error
      }
    }
    throw new Error(`实时报价获取失败：${lastError instanceof Error ? lastError.message : '网络不可用'}`)
  }

  private async getKline(
    code: string,
    isIndex: boolean,
    forceRefresh = false
  ): Promise<KlineResult> {
    const key = `kline_v2:${isIndex ? 'index' : 'stock'}:${code}`
    const cached = await this.cache.get<KlineCacheValue>(key)
    if (cached && !forceRefresh && Date.now() - cached.fetchedAt < KLINE_TTL) {
      return {
        bars: cached.value.bars,
        source: cached.value.source,
        stale: false,
        fetchedAt: cached.fetchedAt
      }
    }

    let lastError: unknown = null
    for (const source of this.activeSources()) {
      try {
        const bars = await source.getKline(code, isIndex, 260)
        await this.cache.set(key, { bars, source: source.name })
        return { bars, source: source.name, stale: false, fetchedAt: Date.now() }
      } catch (error) {
        lastError = error
      }
    }

    if (cached) {
      return {
        bars: cached.value.bars,
        source: cached.value.source,
        stale: true,
        fetchedAt: cached.fetchedAt
      }
    }
    throw new Error(
      `日线获取失败：${lastError instanceof Error ? lastError.message : '网络不可用'}`
    )
  }

  async getSnapshot(code: string, options: SnapshotOptions): Promise<StockSnapshot> {
    const normalized = normalizeCode(code)
    const board = inferBoard(normalized)
    if (!board) throw new Error('暂不支持该代码所属板块（仅支持沪深主板、创业板、科创板）')
    if (options.demo) {
      const demo = makeDemoSnapshot(normalized, options.settings)
      if (!demo) throw new Error('该代码暂无演示数据')
      return demo
    }

    const benchmarkCode = benchmarkCodeFor(board, options.settings)
    const cacheKey = `snapshot_v2:${normalized}:${options.settings.benchmarkMode}:${options.settings.starBenchmark}`
    try {
      const quotes = await this.getQuotes(
        [normalized, benchmarkCode],
        new Set([benchmarkCode])
      )
      const stockQuote = quotes[normalized]
      const benchmarkQuote = quotes[benchmarkCode]
      if (!stockQuote) throw new Error(`未找到股票 ${normalized} 的报价`)
      if (!benchmarkQuote) throw new Error(`未找到基准指数 ${benchmarkCode} 的报价`)

      const instrument = buildInstrument(normalized, stockQuote.name, options.settings)
      const [stockKline, benchmarkKline] = await Promise.all([
        this.getKline(instrument.code, false, options.forceRefresh),
        this.getKline(instrument.benchmarkCode, true, options.forceRefresh)
      ])
      resolveQuoteDate(stockQuote, stockKline.bars)
      resolveQuoteDate(benchmarkQuote, benchmarkKline.bars)

      const benchmark = indexInstrument(
        instrument.benchmarkCode,
        benchmarkQuote.name || instrument.benchmarkName,
        instrument.board,
        instrument.market
      )
      const sources = new Set([
        stockQuote.source,
        benchmarkQuote.source,
        stockKline.source,
        benchmarkKline.source
      ])
      const warnings: string[] = []
      if (stockKline.stale || benchmarkKline.stale) {
        warnings.push('日线使用本地缓存，行情可能不是最新')
      }
      const lastBarDate = stockKline.bars[stockKline.bars.length - 1]?.date
      if (stockQuote.tradeDate && lastBarDate && stockQuote.tradeDate !== lastBarDate) {
        warnings.push('日线尚未包含最新交易日，实时价已单独接入')
      }
      if (stockKline.bars.length < 35) warnings.push('历史交易日不足 35 天，30 日偏离值可能不可用')
      if (benchmarkKline.bars.length < 35) warnings.push('基准指数历史数据不足')

      const snapshot: StockSnapshot = {
        instrument,
        quote: stockQuote,
        benchmark,
        benchmarkQuote,
        bars: stockKline.bars,
        benchmarkBars: benchmarkKline.bars,
        asOf: stockQuote.tradeDate ?? lastBarDate ?? '',
        fetchedAt: Math.max(stockKline.fetchedAt, benchmarkKline.fetchedAt),
        source: sources.size === 1 ? [...sources][0] : 'mixed',
        stale: stockKline.stale || benchmarkKline.stale,
        warnings
      }
      await this.cache.set(cacheKey, snapshot)
      return snapshot
    } catch (error) {
      const cached = await this.cache.get<StockSnapshot>(cacheKey)
      if (cached) {
        return {
          ...cached.value,
          stale: true,
          fetchedAt: cached.fetchedAt,
          source: 'cache',
          warnings: [
            ...cached.value.warnings,
            `离线缓存：${error instanceof Error ? error.message : '网络不可用'}`
          ]
        }
      }
      throw error
    }
  }

  async clearCache(): Promise<void> {
    await this.cache.clear()
  }
}
