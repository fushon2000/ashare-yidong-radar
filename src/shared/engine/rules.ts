import type {
  AppSettings,
  Board,
  Instrument,
  Market,
  RuleThresholds,
  ThresholdSet
} from '../types'
import { DEFAULT_SETTINGS } from '../types'

export const OFFICIAL_BENCHMARKS: Record<Board, string> = {
  SH_MAIN: '000002',
  SZ_MAIN: '399107',
  CHINEXT: '399102',
  STAR: '000680'
}

export const COMMON_BENCHMARKS: Record<Board, string> = {
  SH_MAIN: '000001',
  SZ_MAIN: '399001',
  CHINEXT: '399006',
  STAR: '000688'
}

export const BENCHMARK_NAMES: Record<string, string> = {
  '000001': '上证指数',
  '000002': '上证A股指数',
  '000680': '科创综指',
  '000688': '科创50',
  '399001': '深证成指',
  '399006': '创业板指',
  '399102': '创业板综指',
  '399107': '深证A股指数'
}

export const BOARD_LABELS: Record<Board, string> = {
  SH_MAIN: '沪主板',
  SZ_MAIN: '深主板',
  CHINEXT: '创业板',
  STAR: '科创板'
}

export function normalizeCode(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^(sh|sz|bj)/, '')
    .replace(/[^0-9]/g, '')
    .padStart(6, '0')
    .slice(-6)
}

export function inferBoard(code: string): Board | null {
  const c = normalizeCode(code)
  if (/^(600|601|603|605)/.test(c)) return 'SH_MAIN'
  if (/^(688|689)/.test(c)) return 'STAR'
  if (/^(000|001|002|003)/.test(c)) return 'SZ_MAIN'
  if (/^(300|301)/.test(c)) return 'CHINEXT'
  return null
}

export function marketForBoard(board: Board): Market {
  return board === 'SH_MAIN' || board === 'STAR' ? 'SH' : 'SZ'
}

export function isSTName(name: string | undefined): boolean {
  return !!name && /(^|\*)ST/i.test(name.replace(/\s/g, ''))
}

/**
 * 单日涨跌幅限制。
 *
 * 2026-07-06 起沪深主板风险警示股票（ST / *ST）涨跌幅限制由 ±5% 放宽至 ±10%，
 * 与主板其他股票统一，因此主板 ST 不再有独立档位；创业板 / 科创板保持 20%。
 */
export function limitPctFor(code: string, board: Board, name?: string): number {
  if (board === 'STAR' || board === 'CHINEXT') return 0.2
  // 保留 ST 判断分支：便于后续若某板块重新分档时只改这里。
  if (isSTName(name)) return 0.1
  return 0.1
}

export function benchmarkCodeFor(
  board: Board,
  settings: Pick<AppSettings, 'benchmarkMode' | 'starBenchmark'> = DEFAULT_SETTINGS
): string {
  if (board === 'STAR') {
    return settings.starBenchmark
  }
  return settings.benchmarkMode === 'common'
    ? COMMON_BENCHMARKS[board]
    : OFFICIAL_BENCHMARKS[board]
}

export function benchmarkNameFor(code: string): string {
  return BENCHMARK_NAMES[code] ?? code
}

export function buildInstrument(
  code: string,
  name: string,
  settings: Pick<AppSettings, 'benchmarkMode' | 'starBenchmark'> = DEFAULT_SETTINGS
): Instrument {
  const normalized = normalizeCode(code)
  const board = inferBoard(normalized)
  if (!board) {
    throw new Error(`暂不支持该代码所属板块：${code}`)
  }
  const benchmarkCode = benchmarkCodeFor(board, settings)
  return {
    code: normalized,
    name: name || normalized,
    board,
    market: marketForBoard(board),
    isST: isSTName(name),
    limitPct: limitPctFor(normalized, board, name),
    benchmarkCode,
    benchmarkName: benchmarkNameFor(benchmarkCode)
  }
}

export function thresholdSetFor(
  board: Board,
  isST: boolean,
  thresholds: RuleThresholds = DEFAULT_SETTINGS.thresholds
): ThresholdSet {
  const ordinary3 = isST && (board === 'SH_MAIN' || board === 'SZ_MAIN')
    ? thresholds.st3
    : board === 'CHINEXT' || board === 'STAR'
      ? thresholds.growth3
      : thresholds.main3
  return {
    ordinary3,
    severe10: thresholds.severe10,
    severe30: thresholds.severe30,
    severe10Down: thresholds.severe10Down,
    severe30Down: thresholds.severe30Down
  }
}

/**
 * 「10 个交易日内 N 次同向异动」的 N。
 *
 * 《深圳证券交易所交易规则（2023 年修订）》第 5.4.4 条 / 上交所同构条文：
 * 沪深主板连续 10 个交易日内 4 次，创业板、科创板连续 10 个交易日内 3 次。
 */
export function severeCountFor(
  board: Board,
  thresholds: Pick<RuleThresholds, 'countMain' | 'countGrowth'> = DEFAULT_SETTINGS.thresholds
): number {
  return board === 'CHINEXT' || board === 'STAR'
    ? thresholds.countGrowth
    : thresholds.countMain
}

export function boardLabel(board: Board): string {
  return BOARD_LABELS[board]
}

export function isSupportedCode(code: string): boolean {
  return inferBoard(code) !== null
}
