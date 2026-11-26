import type { Board, Instrument, Market, SearchHit } from '../../shared/types'
import {
  benchmarkCodeFor,
  benchmarkNameFor,
  buildInstrument,
  inferBoard,
  marketForBoard,
  normalizeCode
} from '../../shared/engine/rules'

export function secidForCode(code: string): string {
  const normalized = normalizeCode(code)
  const board = inferBoard(normalized)
  return `${board && (board === 'SH_MAIN' || board === 'STAR') ? 1 : 0}.${normalized}`
}

export function secidForIndex(code: string): string {
  const normalized = normalizeCode(code)
  return `${normalized.startsWith('000') || normalized.startsWith('88') ? 1 : 0}.${normalized}`
}

export function tencentSymbolForCode(code: string): string {
  const normalized = normalizeCode(code)
  const board = inferBoard(normalized)
  return `${board && (board === 'SH_MAIN' || board === 'STAR') ? 'sh' : 'sz'}${normalized}`
}

export function tencentSymbolForIndex(code: string): string {
  const normalized = normalizeCode(code)
  return `${normalized.startsWith('000') || normalized.startsWith('88') ? 'sh' : 'sz'}${normalized}`
}

export function codeFromTencentKey(key: string): string {
  return key.replace(/^[a-z]{2}/i, '')
}

export function searchHitFromCode(code: string, name: string): SearchHit {
  const instrument = buildInstrument(code, name)
  return {
    code: instrument.code,
    name: instrument.name,
    board: instrument.board,
    market: instrument.market,
    isST: instrument.isST
  }
}

export function indexInstrument(
  code: string,
  name: string,
  board: Board,
  market: Market
): Instrument {
  return {
    code,
    name: name || benchmarkNameFor(code),
    board,
    market,
    isST: false,
    limitPct: 0,
    benchmarkCode: code,
    benchmarkName: name || benchmarkNameFor(code),
    isIndex: true
  }
}

export function benchmarkCodeForBoard(
  board: Board,
  settings: Parameters<typeof benchmarkCodeFor>[1]
): string {
  return benchmarkCodeFor(board, settings)
}

export function marketFor(code: string): Market | null {
  const board = inferBoard(code)
  return board ? marketForBoard(board) : null
}
