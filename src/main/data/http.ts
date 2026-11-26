export interface FetchOptions {
  timeoutMs?: number
  headers?: Record<string, string>
  encoding?: 'utf-8' | 'gbk'
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 6000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://quote.eastmoney.com/',
        ...options.headers
      }
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    if (options.encoding === 'gbk') {
      const buffer = await response.arrayBuffer()
      return new TextDecoder('gbk').decode(buffer)
    }
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, options)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('行情接口返回非 JSON 数据')
  }
}
