import type { AppApi } from '../shared/api'
import type {
  AppSettings,
  FileResult,
  NotifyPayload,
  PersistedState,
  Quote,
  SearchHit,
  StockSnapshot
} from '../shared/types'
import { DEFAULT_SETTINGS, DEFAULT_STATE } from '../shared/types'
import { MarketDataProvider } from '../main/data/provider'
import { EastmoneySource } from '../main/data/eastmoney'
import { TencentSource } from '../main/data/tencent'
import { searchHitFromCode } from '../main/data/symbols'
import { inferBoard, normalizeCode } from '../shared/engine/rules'

/**
 * 网页版（PWA）的 window.api 实现。
 *
 * 渲染层代码与桌面版完全一致，只是把 Electron IPC 换成浏览器能力：
 * - 缓存：localStorage（桌面版是文件）
 * - 状态：localStorage
 * - 通知：Web Notification
 * - CSV：Blob 下载 / file input
 * - 托盘、退出等桌面专属能力：空实现
 *
 * 浏览器端与桌面端的接口差异（实测结论）：
 * - 东方财富的个股实时报价对浏览器屏蔽价格字段（只返回昨收），指数正常
 * - 腾讯 `qt.gtimg.cn` 报价在浏览器可用（CORS *、GBK 可解码、支持批量）
 * - 东方财富日线、腾讯日线均可用
 * - 两个搜索接口都被 CORS 拦，但腾讯 smartbox 返回 `v_hint=` 赋值，可用 script 标签 JSONP 读取
 *
 * 因此网页版把腾讯放在主源位置，并用 JSONP 做搜索。
 */

const STATE_KEY = 'ashare-radar:state:v1'
const CACHE_PREFIX = 'ashare-radar:cache:'

interface CacheEnvelope<T> {
  fetchedAt: number
  value: T
}

class LocalStorageCache {
  async get<T>(key: string): Promise<CacheEnvelope<T> | null> {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as CacheEnvelope<T>
      if (!parsed || typeof parsed.fetchedAt !== 'number') return null
      return parsed
    } catch {
      return null
    }
  }

  async set<T>(key: string, value: T, fetchedAt = Date.now()): Promise<void> {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ fetchedAt, value }))
    } catch {
      // 超出配额时静默失败：行情仍可在线获取
    }
  }

  async clear(): Promise<void> {
    try {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith(CACHE_PREFIX)) keys.push(key)
      }
      for (const key of keys) localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }
}

function mergeSettings(input?: Partial<AppSettings>): AppSettings {
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...(input ?? {}),
    thresholds: {
      ...DEFAULT_SETTINGS.thresholds,
      ...(input?.thresholds ?? {})
    }
  }
  // 浏览器端东方财富屏蔽个股实时价，强制走「自动」（腾讯优先）
  if (merged.dataSource === 'eastmoney') merged.dataSource = 'auto'
  return merged
}

function readState(): PersistedState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as PersistedState
    return {
      version: DEFAULT_STATE.version,
      groups: parsed.groups?.length ? parsed.groups : DEFAULT_STATE.groups,
      stocks: parsed.stocks ?? [],
      selectedCode: parsed.selectedCode ?? null,
      settings: mergeSettings(parsed.settings)
    }
  } catch {
    return DEFAULT_STATE
  }
}

function writeState(state: PersistedState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

let currentSettings: AppSettings = readState().settings
const cache = new LocalStorageCache()
// 腾讯放在主源：浏览器端东方财富的个股实时价被屏蔽
const provider = new MarketDataProvider(
  cache,
  () => currentSettings,
  [new TencentSource(), new EastmoneySource()]
)

/**
 * 腾讯 smartbox 搜索（JSONP）。
 * 直接 fetch 会被 CORS 拦，但该接口返回 `v_hint="..."` 赋值语句，
 * 用 <script charset="gbk"> 加载即可读到全局 v_hint，中文也能正确解码。
 */
function smartboxSearch(query: string): Promise<SearchHit[]> {
  return new Promise((resolve) => {
    const globalScope = window as unknown as Record<string, unknown>
    const previous = globalScope.v_hint
    const script = document.createElement('script')
    let settled = false
    const finish = (hits: SearchHit[]): void => {
      if (settled) return
      settled = true
      script.remove()
      globalScope.v_hint = previous
      resolve(hits)
    }
    const timer = setTimeout(() => finish([]), 8000)

    script.charset = 'gbk'
    script.src = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(query.trim())}&t=all&v=2`
    script.onerror = () => {
      clearTimeout(timer)
      finish([])
    }
    script.onload = () => {
      clearTimeout(timer)
      const raw = globalScope.v_hint
      if (typeof raw !== 'string' || !raw) {
        finish([])
        return
      }
      const seen = new Set<string>()
      const hits: SearchHit[] = []
      for (const item of raw.split('^')) {
        const [, code, name, , type] = item.split('~')
        if (!code || !name) continue
        if (type && !type.startsWith('GP-A')) continue
        const normalized = normalizeCode(code)
        if (!inferBoard(normalized) || seen.has(normalized)) continue
        seen.add(normalized)
        try {
          hits.push(searchHitFromCode(normalized, name))
        } catch {
          // 不支持的板块直接跳过
        }
      }
      finish(hits)
    }
    document.head.appendChild(script)
  })
}

async function showNotification(payload: NotifyPayload): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  try {
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return false
    }
    if (Notification.permission !== 'granted') return false
    new Notification(payload.title, {
      body: payload.body,
      tag: payload.code ?? 'ashare-radar',
      icon: `${import.meta.env.BASE_URL}icons/icon-192.png`
    })
    return true
  } catch {
    return false
  }
}

function downloadCsv(content: string, filename: string): FileResult {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || '关注池.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { canceled: false, path: filename }
}

function pickCsvFile(): Promise<FileResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,text/csv'
    input.style.display = 'none'
    let settled = false
    const finish = (result: FileResult): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(result)
    }
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        finish({ canceled: true })
        return
      }
      const reader = new FileReader()
      reader.onload = () => finish({ canceled: false, content: String(reader.result ?? '') })
      reader.onerror = () => finish({ canceled: true })
      reader.readAsText(file, 'utf-8')
    })
    // iOS 取消选择时不会触发 change，用窗口重新聚焦兜底
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish({ canceled: true }), 1500),
      { once: true }
    )
    document.body.appendChild(input)
    input.click()
  })
}

const api: AppApi = {
  market: {
    async search(query: string): Promise<SearchHit[]> {
      const trimmed = query.trim()
      if (!trimmed) return []
      const hits = await smartboxSearch(trimmed)
      // JSONP 失败时退回 provider（含 6 位代码直接构造的兜底）
      return hits.length > 0 ? hits : provider.search(trimmed)
    },
    async getSnapshot(request): Promise<StockSnapshot> {
      if (request.settings) currentSettings = mergeSettings(request.settings)
      return provider.getSnapshot(request.code, {
        settings: request.settings ?? currentSettings,
        demo: request.demo,
        forceRefresh: request.forceRefresh
      })
    },
    async getQuotes(codes: string[]): Promise<Record<string, Quote>> {
      return provider.getQuotes(codes)
    },
    async clearCache(): Promise<boolean> {
      await provider.clearCache()
      return true
    }
  },
  state: {
    async load(): Promise<PersistedState> {
      const state = readState()
      currentSettings = state.settings
      return state
    },
    async save(state: PersistedState): Promise<PersistedState> {
      currentSettings = mergeSettings(state.settings)
      writeState({ ...state, settings: currentSettings })
      return state
    }
  },
  notify: {
    show: showNotification
  },
  csv: {
    async export(content: string, filename: string): Promise<FileResult> {
      return downloadCsv(content, filename)
    },
    async import(): Promise<FileResult> {
      return pickCsvFile()
    }
  },
  app: {
    async quit(): Promise<void> {
      window.close()
    },
    onSelectStock: () => () => undefined,
    onRefresh: () => () => undefined
  }
}

/**
 * 在渲染层加载之前注入 window.api。
 * 由 main.ts 以 import 顺序保证先于 @renderer/main 执行。
 */
export function installWebApi(): void {
  ;(window as unknown as { api: AppApi }).api = api

  // iOS 要求在用户手势中申请通知权限
  const requestOnce = (): void => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => undefined)
    }
    document.removeEventListener('pointerdown', requestOnce)
  }
  document.addEventListener('pointerdown', requestOnce, { once: true })

  // 依赖外网行情，提示离线可用性
  window.addEventListener('online', () => undefined)
}

installWebApi()
