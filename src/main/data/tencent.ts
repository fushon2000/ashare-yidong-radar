import type { DailyBar, Quote, SearchHit } from '../../shared/types'
import { inferBoard, normalizeCode } from '../../shared/engine/rules'
import { fetchJson, fetchText } from './http'
import { codeFromTencentKey, searchHitFromCode, tencentSymbolForCode, tencentSymbolForIndex } from './symbols'

interface TencentKlineResponse {
  code?: number
  data?: Record<string, {
    qfqday?: string[][]
    day?: string[][]
    qt?: Record<string, string[]>
  }>
}

function parseTencentQuote(key: string, raw: string): Quote | null {
  const parts = raw.split('~')
  if (parts.length < 35) return null
  const price = Number(parts[3])
  const prevClose = Number(parts[4])
  if (!(price > 0) || !(prevClose > 0)) return null
  const code = codeFromTencentKey(key)
  return {
    code,
    name: parts[1] || code,
    price,
    prevClose,
    open: Number(parts[5]) || prevClose,
    high: Number(parts[33]) || price,
    low: Number(parts[34]) || price,
    change: Number(parts[31]) || price - prevClose,
    changePct: Number(parts[32]) || ((price / prevClose) - 1) * 100,
    timestamp: Date.now(),
    source: 'tencent'
  }
}

export class TencentSource {
  readonly name = 'tencent'

  async search(query: string): Promise<SearchHit[]> {
    const url = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(query)}&t=all`
    const text = await fetchText(url, { encoding: 'gbk' })
    const match = text.match(/v_hint="([^"]*)"/)
    if (!match) return []
    const hits: SearchHit[] = []
    const seen = new Set<string>()
    for (const item of match[1].split('^')) {
      const [market, code, name, , type] = item.split('~')
      if (!code || !name) continue
      if (type && !type.startsWith('GP-A')) continue
      const normalized = normalizeCode(code)
      if (!inferBoard(normalized) || seen.has(normalized)) continue
      seen.add(normalized)
      hits.push(searchHitFromCode(normalized, name))
    }
    return hits
  }

  async getQuotes(codes: string[], indexCodes: Set<string> = new Set()): Promise<Record<string, Quote>> {
    const normalized = [...new Set(codes.map(normalizeCode).filter(Boolean))]
    if (normalized.length === 0) return {}
    const symbols = normalized
      .map((code) => indexCodes.has(code) ? tencentSymbolForIndex(code) : tencentSymbolForCode(code))
      .join(',')
    const text = await fetchText(`https://qt.gtimg.cn/q=${symbols}`, { encoding: 'gbk' })
    const result: Record<string, Quote> = {}
    const regex = /v_([a-z]{2}\d{6})="([^"]*)"/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const quote = parseTencentQuote(match[1], match[2])
      if (quote) result[quote.code] = quote
    }
    if (Object.keys(result).length === 0) throw new Error('腾讯报价为空')
    return result
  }

  async getKline(code: string, isIndex: boolean, limit = 240): Promise<DailyBar[]> {
    const symbol = isIndex ? tencentSymbolForIndex(code) : tencentSymbolForCode(code)
    const adjustment = isIndex ? '' : 'qfq'
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${limit},${adjustment}`
    const data = await fetchJson<TencentKlineResponse>(url)
    const instrument = data.data?.[symbol]
    const rows = instrument?.qfqday ?? instrument?.day ?? []
    if (rows.length === 0) throw new Error('腾讯日线为空')
    const bars: DailyBar[] = []
    for (const row of rows) {
      if (row.length < 5) continue
      const close = Number(row[2])
      if (!(close > 0)) continue
      const prev = bars[bars.length - 1]?.close
      bars.push({
        date: row[0],
        open: Number(row[1]),
        close,
        high: Number(row[3]),
        low: Number(row[4]),
        volume: Number(row[5]) || 0,
        pct: prev ? (close / prev - 1) * 100 : 0
      })
    }
    if (bars.length === 0) throw new Error('腾讯日线解析失败')
    return bars.slice(-limit)
  }
}
