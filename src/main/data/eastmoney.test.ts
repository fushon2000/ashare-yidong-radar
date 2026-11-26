import { afterEach, describe, expect, it, vi } from 'vitest'
import { EastmoneySource } from './eastmoney'

const quotePayload = {
  rc: 0,
  data: {
    total: 2,
    diff: [
      {
        f2: 146900,
        f3: -40,
        f4: -584,
        f12: '600519',
        f13: 1,
        f14: '贵州茅台',
        f15: 147300,
        f16: 145600,
        f17: 147000,
        f18: 147484
      },
      {
        f2: 364568,
        f3: 1,
        f4: 35,
        f12: '000002',
        f13: 1,
        f14: 'Ａ股指数',
        f15: 366765,
        f16: 362278,
        f17: 365967,
        f18: 364533
      }
    ]
  }
}

const klinePayload = {
  rc: 0,
  data: {
    code: '600519',
    name: '贵州茅台',
    klines: [
      '2026-11-24,1425.00,1460.00,1463.26,1420.00,42924,6214192454.00,3.01,1.46,21.00,0.34',
      '2026-11-25,1458.00,1474.84,1480.00,1447.00,46674,6842335769.00,2.26,1.02,14.84,0.37',
      '2026-11-26,1470.00,1469.00,1473.00,1456.00,32408,4747727455.00,1.15,-0.40,-5.84,0.26'
    ]
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EastmoneySource', () => {
  it('parses stock and index quotes and uses the index secid for 000002', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify(quotePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }))
    const source = new EastmoneySource()
    const quotes = await source.getQuotes(['600519', '000002'], new Set(['000002']))
    expect(quotes['600519'].price).toBeCloseTo(1469, 2)
    expect(quotes['600519'].changePct).toBeCloseTo(-0.4, 2)
    expect(quotes['000002'].price).toBeCloseTo(3645.68, 2)
    expect(calls[0]).toContain('1.000002')
    expect(calls[0]).not.toContain('0.000002')
  })

  it('parses daily bars with the expected fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(klinePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })))
    const source = new EastmoneySource()
    const bars = await source.getKline('600519', false, 10)
    expect(bars).toHaveLength(3)
    expect(bars[2].date).toBe('2026-11-26')
    expect(bars[2].close).toBeCloseTo(1469, 2)
    expect(bars[2].pct).toBeCloseTo(-0.4, 2)
  })
})
