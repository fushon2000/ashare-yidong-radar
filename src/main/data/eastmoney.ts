import type { DailyBar, Quote, SearchHit } from '../../shared/types'
import { inferBoard, normalizeCode } from '../../shared/engine/rules'
import { fetchJson } from './http'
import { searchHitFromCode, secidForCode, secidForIndex } from './symbols'

interface EmQuoteDiff {
  f2?: number
  f3?: number
  f4?: number
  f12?: string
  f13?: number
  f14?: string
  f15?: number
  f16?: number
  f17?: number
  f18?: number
}

interface EmQuoteResponse {
  rc?: number
  data?: {
    total?: number
    diff?: EmQuoteDiff[]
  } | null
}

interface EmKlineResponse {
  rc?: number
  data?: {
    code?: string
    name?: string
    klines?: string[]
  } | null
}

interface EmSuggestResponse {
  QuotationCodeTable?: {
    Data?: Array<{
      Code?: string
      Name?: string
      Classify?: string
      MarketType?: string
      SecurityTypeName?: string
      QuoteID?: string
      MktNum?: string
    }>
  }
}

function n(value: number | undefined, divisor = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return value / divisor
}

export function parseEmQuote(item: EmQuoteDiff): Quote | null {
  const code = item.f12 ? normalizeCode(item.f12) : ''
  if (!code) return null
  const price = n(item.f2, 100)
  const prevClose = n(item.f18, 100)
  if (!(price > 0) || !(prevClose > 0)) return null
  const change = n(item.f4, 100)
  const changePct = n(item.f3, 100)
  return {
    code,
    name: item.f14 ?? code,
    price,
    prevClose,
    open: n(item.f17, 100),
    high: n(item.f15, 100),
    low: n(item.f16, 100),
    change,
    changePct,
    timestamp: Date.now(),
    source: 'eastmoney'
  }
}

export class EastmoneySource {
  readonly name = 'eastmoney'

  async search(query: string): Promise<SearchHit[]> {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=20`
    const data = await fetchJson<EmSuggestResponse>(url)
    const rows = data.QuotationCodeTable?.Data ?? []
    const seen = new Set<string>()
    const hits: SearchHit[] = []
    for (const row of rows) {
      if (!row.Code || !row.Name) continue
      if (row.Classify && row.Classify !== 'AStock') continue
      const code = normalizeCode(row.Code)
      if (!inferBoard(code) || seen.has(code)) continue
      seen.add(code)
      hits.push(searchHitFromCode(code, row.Name))
    }
    return hits
  }

  async getQuotes(codes: string[], indexCodes: Set<string> = new Set()): Promise<Record<string, Quote>> {
    const normalized = [...new Set(codes.map(normalizeCode).filter(Boolean))]
    if (normalized.length === 0) return {}
    const result: Record<string, Quote> = {}
    for (let i = 0; i < normalized.length; i += 40) {
      const chunk = normalized.slice(i, i + 40)
      const secids = chunk
        .map((code) => indexCodes.has(code)
          ? secidForIndex(code)
          : (inferBoard(code) === 'SH_MAIN' || inferBoard(code) === 'STAR' ? `1.${code}` : `0.${code}`))
        .join(',')
      const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${encodeURIComponent(secids)}&fields=f2,f3,f4,f12,f13,f14,f15,f16,f17,f18`
      const data = await fetchJson<EmQuoteResponse>(url)
      for (const item of data.data?.diff ?? []) {
        const quote = parseEmQuote(item)
        if (quote) result[quote.code] = quote
      }
    }
    if (Object.keys(result).length === 0) {
      throw new Error('东方财富报价为空')
    }
    return result
  }

  async getKline(code: string, isIndex: boolean, limit = 240): Promise<DailyBar[]> {
    const secid = isIndex ? secidForIndex(code) : secidForCode(code)
    const fqt = isIndex ? 0 : 1
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=${fqt}&lmt=${limit}&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`
    const data = await fetchJson<EmKlineResponse>(url)
    const rows = data.data?.klines ?? []
    if (rows.length === 0) throw new Error('东方财富日线为空')
    const bars: DailyBar[] = []
    for (const row of rows) {
      const parts = row.split(',')
      if (parts.length < 9) continue
      const close = Number(parts[2])
      if (!(close > 0)) continue
      bars.push({
        date: parts[0],
        open: Number(parts[1]),
        close,
        high: Number(parts[3]),
        low: Number(parts[4]),
        volume: Number(parts[5]),
        amount: Number(parts[6]),
        pct: Number(parts[8])
      })
    }
    if (bars.length === 0) throw new Error('东方财富日线解析失败')
    return bars.slice(-limit)
  }
}
