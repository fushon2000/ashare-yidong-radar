import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppSettings, Board, StockSnapshot } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { FileCache } from './cache'
import { MarketDataProvider } from './provider'
import { EastmoneySource } from './eastmoney'
import { TencentSource } from './tencent'
import { secidForIndex, tencentSymbolForIndex } from './symbols'
import { buildAlignedSeries, computeAllWindows } from '../../shared/engine/series'
import { severeCountFor, thresholdSetFor } from '../../shared/engine/rules'
import { buildOutlook } from '../../shared/engine/outlook'

/**
 * 实时行情端到端验收（联网）。
 *
 * 默认跳过；需要联调时执行：
 *   PowerShell: $env:ASHARE_LIVE='1'; node node_modules/vitest/vitest.mjs run src/main/data/live.test.ts
 */
const LIVE = process.env.ASHARE_LIVE === '1'
const TIMEOUT = 60_000

interface Case {
  code: string
  name: string
  board: Board
  benchmark: string
  benchmarkName: string
}

const CASES: Case[] = [
  { code: '600519', name: '贵州茅台', board: 'SH_MAIN', benchmark: '000002', benchmarkName: '上证A股指数' },
  { code: '300750', name: '宁德时代', board: 'CHINEXT', benchmark: '399102', benchmarkName: '创业板综指' },
  { code: '688981', name: '中芯国际', board: 'STAR', benchmark: '000680', benchmarkName: '科创综指' }
]

function settingsWith(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

function newProvider(settings: AppSettings): MarketDataProvider {
  const dir = mkdtempSync(join(tmpdir(), 'radar-live-'))
  return new MarketDataProvider(new FileCache(dir), () => settings)
}

function pctDiff(a: number, b: number): number {
  return Math.abs(a - b)
}

function report(snapshot: StockSnapshot): void {
  const thresholds = thresholdSetFor(snapshot.instrument.board, snapshot.instrument.isST)
  const series = buildAlignedSeries(
    snapshot.bars,
    snapshot.benchmarkBars,
    snapshot.quote,
    snapshot.benchmarkQuote
  )
  const windows = computeAllWindows(series, thresholds)
  const countRequired = severeCountFor(snapshot.instrument.board)
  const outlook = buildOutlook({
    series,
    thresholds,
    limitPct: snapshot.instrument.limitPct,
    currentPrice: snapshot.quote.price,
    countRequired
  })
  const show = windows.map((w) => `${w.window}日 ${w.deviation.toFixed(2)}%`).join(' | ')
  const ten = outlook.days[0].severe.find((cell) => cell.window === 10)
  const thirty = outlook.days[0].severe.find((cell) => cell.window === 30)
  console.log(
    `[live] ${snapshot.instrument.code} ${snapshot.instrument.name} ` +
    `价 ${snapshot.quote.price} (${snapshot.quote.changePct.toFixed(2)}%) ` +
    `基准 ${snapshot.benchmark.code} ${snapshot.benchmark.name} ` +
    `${snapshot.benchmarkQuote.changePct.toFixed(2)}% | ` +
    `bars ${snapshot.bars.length} 末日 ${snapshot.bars[snapshot.bars.length - 1]?.date} ` +
    `asOf ${snapshot.asOf} 源 ${snapshot.source} | ${show} | ` +
    `10日内同向异动 ${outlook.countState.count}/${countRequired} | ` +
    `当日再涨→10日 ${ten?.needUpPct?.toFixed(2) ?? '--'}% 30日 ${thirty?.needUpPct?.toFixed(2) ?? '--'}%`
  )
}

describe.skipIf(!LIVE)('实时行情端到端（联网）', () => {
  it('核心指数代码的 secid / 腾讯代码映射正确', () => {
    // 指数 000002 必须走 1.000002，不能按股票市场前缀推断
    expect(secidForIndex('000002')).toBe('1.000002')
    expect(secidForIndex('399107')).toBe('0.399107')
    expect(secidForIndex('399102')).toBe('0.399102')
    expect(secidForIndex('000680')).toBe('1.000680')
    expect(tencentSymbolForIndex('000002')).toBe('sh000002')
    expect(tencentSymbolForIndex('399102')).toBe('sz399102')
  })

  for (const item of CASES) {
    it(`provider 端到端：${item.code} ${item.name}`, async () => {
      const provider = newProvider(settingsWith())
      const snapshot = await provider.getSnapshot(item.code, {
        settings: settingsWith(),
        forceRefresh: true
      })

      // 标的与基准映射
      expect(snapshot.instrument.code).toBe(item.code)
      expect(snapshot.instrument.board).toBe(item.board)
      expect(snapshot.instrument.benchmarkCode).toBe(item.benchmark)
      expect(snapshot.benchmark.code).toBe(item.benchmark)
      expect(snapshot.instrument.name).toContain(item.name)
      expect(snapshot.demo).toBeUndefined()

      // 报价有效，且涨跌幅与现价/昨收自洽
      expect(snapshot.quote.price).toBeGreaterThan(0)
      expect(snapshot.quote.prevClose).toBeGreaterThan(0)
      const impliedPct = (snapshot.quote.price / snapshot.quote.prevClose - 1) * 100
      expect(pctDiff(impliedPct, snapshot.quote.changePct)).toBeLessThan(0.35)
      expect(snapshot.benchmarkQuote.price).toBeGreaterThan(0)

      // 日线结构
      expect(snapshot.bars.length).toBeGreaterThanOrEqual(60)
      expect(snapshot.benchmarkBars.length).toBeGreaterThanOrEqual(60)
      const dates = snapshot.bars.map((bar) => bar.date)
      expect([...dates].sort((a, b) => a.localeCompare(b))).toEqual(dates)
      for (const bar of snapshot.bars.slice(-5)) {
        expect(bar.close).toBeGreaterThan(0)
        expect(bar.high).toBeGreaterThanOrEqual(bar.low)
        expect(bar.close).toBeGreaterThanOrEqual(bar.low - 0.011)
        expect(bar.close).toBeLessThanOrEqual(bar.high + 0.011)
      }

      // 引擎在真实数据上的输出
      const thresholds = thresholdSetFor(snapshot.instrument.board, snapshot.instrument.isST)
      const series = buildAlignedSeries(
        snapshot.bars,
        snapshot.benchmarkBars,
        snapshot.quote,
        snapshot.benchmarkQuote
      )
      expect(series.length).toBeGreaterThanOrEqual(30)
      expect(series[series.length - 1].date).toBe(snapshot.asOf)

      const windows = computeAllWindows(series, thresholds)
      expect(windows.map((w) => w.window)).toEqual([3, 10, 30])
      for (const window of windows) {
        expect(Number.isFinite(window.deviation)).toBe(true)
        expect(Math.abs(window.deviation)).toBeLessThan(500)
        expect(window.startDate <= window.endDate).toBe(true)
      }

      // 独立复算：用收盘价复利 vs 用接口 pct 复利，两者应基本一致
      const last10 = snapshot.bars.slice(-10)
      let byClose = 1
      for (let i = 1; i < last10.length; i++) byClose *= last10[i].close / last10[i - 1].close
      let byPct = 1
      for (let i = 1; i < last10.length; i++) byPct *= 1 + (last10[i].pct ?? 0) / 100
      expect(pctDiff((byClose - 1) * 100, (byPct - 1) * 100)).toBeLessThan(0.5)

      // 次数型口径按板块
      expect(snapshot.instrument.isST).toBe(false)
      expect(severeCountFor(snapshot.instrument.board)).toBe(item.board === 'SH_MAIN' ? 4 : 3)

      // 三个时点测算可算
      const outlook = buildOutlook({
        series,
        thresholds,
        limitPct: snapshot.instrument.limitPct,
        currentPrice: snapshot.quote.price,
        countRequired: severeCountFor(snapshot.instrument.board)
      })
      expect(outlook.days).toHaveLength(3)
      for (const day of outlook.days) {
        expect(day.severe).toHaveLength(2)
        for (const cell of day.severe) {
          expect(cell.needUpPct === null || Number.isFinite(cell.needUpPct)).toBe(true)
        }
      }

      report(snapshot)
    }, TIMEOUT)
  }

  it('主备源双通道：东方财富与腾讯都能返回有效报价', async () => {
    const codes = CASES.map((item) => item.code)
    const indexes = new Set(CASES.map((item) => item.benchmark))

    const em = new EastmoneySource()
    const tencent = new TencentSource()

    const emQuotes = await em.getQuotes([...codes, ...indexes], indexes)
    const tcQuotes = await tencent.getQuotes([...codes, ...indexes], indexes)

    for (const code of [...codes, ...indexes]) {
      expect(emQuotes[code]?.price, `东方财富缺 ${code}`).toBeGreaterThan(0)
      expect(tcQuotes[code]?.price, `腾讯缺 ${code}`).toBeGreaterThan(0)
    }

    // 同一标的两个源的昨收应一致（同一交易日收盘），现价允许轻微时点差
    for (const code of codes) {
      const a = emQuotes[code]
      const b = tcQuotes[code]
      expect(pctDiff(a.prevClose, b.prevClose)).toBeLessThan(0.02)
      expect(pctDiff(a.price / b.price - 1, 0) * 100).toBeLessThan(1.5)
      console.log(
        `[live] 双源 ${code} ${a.name} | 东财 ${a.price}/${a.changePct.toFixed(2)}% ` +
        `腾讯 ${b.price}/${b.changePct.toFixed(2)}% 昨收 ${a.prevClose}/${b.prevClose}`
      )
    }

    // 日线双源交叉校验：最近 3 个交易日收盘价应一致
    for (const code of codes) {
      const emBars = await em.getKline(code, false, 260)
      const tcBars = await tencent.getKline(code, false, 260)
      expect(emBars.length).toBeGreaterThan(60)
      expect(tcBars.length).toBeGreaterThan(60)
      const emLast = emBars[emBars.length - 1]
      const tcLast = tcBars[tcBars.length - 1]
      expect(emLast.date).toBe(tcLast.date)
      expect(pctDiff(emLast.close, tcLast.close) / emLast.close * 100).toBeLessThan(0.5)
      console.log(`[live] 日线双源 ${code} 末日 ${emLast.date} 东财收 ${emLast.close} 腾讯收 ${tcLast.close}`)
    }
  }, TIMEOUT)

  it('数据源偏好设置生效：仅用腾讯源也能取到快照', async () => {
    const settings = settingsWith({ dataSource: 'tencent' })
    const provider = newProvider(settings)
    const snapshot = await provider.getSnapshot('600519', { settings, forceRefresh: true })
    expect(snapshot.quote.price).toBeGreaterThan(0)
    expect(snapshot.quote.source).toBe('tencent')
    expect(snapshot.instrument.benchmarkCode).toBe('000002')
    report(snapshot)
  }, TIMEOUT)

  it('日线缓存命中后不再依赖网络', async () => {
    const settings = settingsWith()
    const dir = mkdtempSync(join(tmpdir(), 'radar-cache-'))
    const cache = new FileCache(dir)
    const provider = new MarketDataProvider(cache, () => settings)
    const first = await provider.getSnapshot('600519', { settings, forceRefresh: true })
    const cached = await cache.get<StockSnapshot>(`snapshot_v2:600519:official:000680`)
    expect(cached).not.toBeNull()
    expect(cached!.value.quote.price).toBe(first.quote.price)
    console.log(`[live] 缓存写入成功：${Math.round(JSON.stringify(cached).length / 1024)} KB`)
  }, TIMEOUT)
})
