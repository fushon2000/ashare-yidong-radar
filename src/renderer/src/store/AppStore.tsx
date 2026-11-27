import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  AppSettings,
  CountState,
  PersistedState,
  SearchHit,
  StockEntry,
  StockSnapshot,
  WindowDeviation
} from '../../../shared/types'
import { DEFAULT_SETTINGS, DEFAULT_STATE } from '../../../shared/types'
import {
  normalizeCode,
  severeCountFor,
  thresholdSetFor
} from '../../../shared/engine/rules'
import {
  buildAlignedSeries,
  computeAllWindows,
  isSevereTriggered,
  severeUtilization
} from '../../../shared/engine/series'
import { countStateOf } from '../../../shared/engine/counting'

export type AppMode = 'live' | 'history'
export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

export interface StockView {
  snapshot: StockSnapshot | null
  loading: boolean
  error: string | null
  loadedAt: number
}

export interface SimulationState {
  todayPct: number | null
  indexPct: number | null
  futureGainPct: number
  locked: boolean
}

export interface StockMetric {
  windows: WindowDeviation[]
  utilization: number
  severe: boolean
  todayPct: number
  count: CountState
}

interface AppContextValue {
  ready: boolean
  stocks: StockEntry[]
  settings: AppSettings
  selectedCode: string | null
  views: Record<string, StockView>
  metrics: Record<string, StockMetric>
  simulation: SimulationState
  mode: AppMode
  historyDate: string | null
  toasts: ToastItem[]
  settingsOpen: boolean
  totalStocks: number
  selectedStock: StockEntry | null
  selectedView: StockView | null
  addStock(hit: SearchHit): void
  removeStock(code: string): void
  selectStock(code: string): void
  reorderStock(code: string, targetCode: string | null): void
  updateSettings(next: Partial<AppSettings>): void
  resetSettings(): void
  setSimulation(next: Partial<SimulationState>): void
  resetSimulation(): void
  setMode(mode: AppMode): void
  setHistoryDate(date: string | null): void
  openSettings(open: boolean): void
  toast(message: string, kind?: ToastKind): void
  removeToast(id: number): void
  refreshAll(silent?: boolean): Promise<void>
  loadSnapshot(code: string, options?: { demo?: boolean; forceRefresh?: boolean; settings?: AppSettings }): Promise<void>
  loadDemoWatchlist(): Promise<void>
  dismissAllToasts(): void
}

const AppContext = createContext<AppContextValue | null>(null)

function mergeSettings(input?: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(input ?? {}),
    thresholds: {
      ...DEFAULT_SETTINGS.thresholds,
      ...(input?.thresholds ?? {})
    }
  }
}

function normalizeState(state: PersistedState): PersistedState {
  const settings = mergeSettings(state.settings)
  const savedVersion = typeof state.version === 'number' ? state.version : 1
  if (savedVersion < 2 && settings.thresholds.st3 === 12) {
    // v1 的「主板 ST 3 日 12%」基于 2026-07-06 前的旧规（ST 涨跌幅 ±5%）。
    // 新《交易规则》将主板 ST 涨跌幅放宽到 ±10%，对应异常波动阈值同步为 20%。
    settings.thresholds = { ...settings.thresholds, st3: 20 }
  }
  // 旧数据可能含已删除的 groups / groupId：一律忽略，按 code 去重保留股票。
  const seen = new Set<string>()
  const stocks = (state.stocks ?? []).filter((stock) => {
    if (!stock || typeof stock.code !== 'string' || seen.has(stock.code)) return false
    seen.add(stock.code)
    return true
  }).map((stock, index) => ({
    code: stock.code,
    name: typeof stock.name === 'string' ? stock.name : stock.code,
    order: Number.isFinite(stock.order) ? stock.order : index,
    note: typeof stock.note === 'string' ? stock.note : undefined
  }))
  return {
    version: DEFAULT_STATE.version,
    stocks,
    selectedCode: state.selectedCode ?? null,
    settings
  }
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [stocks, setStocks] = useState<StockEntry[]>([])
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [views, setViews] = useState<Record<string, StockView>>({})
  const [simulation, setSimulationState] = useState<SimulationState>({
    todayPct: null,
    indexPct: null,
    futureGainPct: 0,
    locked: false
  })
  const [mode, setMode] = useState<AppMode>('live')
  const [historyDate, setHistoryDateState] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)

  const selectedRef = useRef<string | null>(null)
  const stocksRef = useRef<StockEntry[]>([])
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS)
  const viewsRef = useRef<Record<string, StockView>>({})
  const simRef = useRef<SimulationState>(simulation)
  const alertRef = useRef(new Map<string, { severe: boolean; lastNotified: number }>())
  const loadingRef = useRef(new Set<string>())
  const bootRef = useRef(false)
  const toastIdRef = useRef(0)

  useEffect(() => { selectedRef.current = selectedCode }, [selectedCode])
  useEffect(() => { stocksRef.current = stocks }, [stocks])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { viewsRef.current = views }, [views])
  useEffect(() => { simRef.current = simulation }, [simulation])

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++toastIdRef.current
    setToasts((current) => [...current, { id, kind, message }])
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
    }, 4200)
  }, [])

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  const loadSnapshot = useCallback(async (
    code: string,
    options?: { demo?: boolean; forceRefresh?: boolean; settings?: AppSettings }
  ): Promise<void> => {
    if (loadingRef.current.has(code)) return
    loadingRef.current.add(code)
    setViews((current) => ({
      ...current,
      [code]: {
        snapshot: current[code]?.snapshot ?? null,
        loading: true,
        error: null,
        loadedAt: current[code]?.loadedAt ?? 0
      }
    }))
    try {
      const snapshot = await window.api.market.getSnapshot({
        code,
        demo: options?.demo,
        forceRefresh: options?.forceRefresh,
        settings: options?.settings ?? settingsRef.current
      })
      setViews((current) => ({
        ...current,
        [code]: { snapshot, loading: false, error: null, loadedAt: Date.now() }
      }))
      if (selectedRef.current === code && !simRef.current.locked) {
        setSimulationState((current) => ({
          ...current,
          todayPct: null,
          indexPct: null
        }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载行情失败'
      setViews((current) => ({
        ...current,
        [code]: {
          snapshot: current[code]?.snapshot ?? null,
          loading: false,
          error: message,
          loadedAt: current[code]?.loadedAt ?? 0
        }
      }))
    } finally {
      loadingRef.current.delete(code)
    }
  }, [])

  const loadAll = useCallback(async (force = false, sourceSettings?: AppSettings): Promise<void> => {
    const list = stocksRef.current
    for (let i = 0; i < list.length; i += 3) {
      const chunk = list.slice(i, i + 3)
      await Promise.all(chunk.map((stock) => {
        const view = viewsRef.current[stock.code]
        const old = !view?.snapshot || Date.now() - (view.loadedAt || 0) > 10 * 60 * 1000
        return (force || old) ? loadSnapshot(stock.code, { forceRefresh: force, settings: sourceSettings }) : Promise.resolve()
      }))
    }
  }, [loadSnapshot])

  const refreshAll = useCallback(async (silent = false): Promise<void> => {
    const list = stocksRef.current
    if (list.length === 0) return
    try {
      const quotes = await window.api.market.getQuotes(list.map((stock) => stock.code))
      setViews((current) => {
        const next = { ...current }
        for (const [code, quote] of Object.entries(quotes)) {
          const view = next[code]
          if (view?.snapshot) {
            next[code] = {
              ...view,
              snapshot: {
                ...view.snapshot,
                quote: { ...quote, tradeDate: undefined },
                stale: false,
                fetchedAt: Date.now()
              },
              loadedAt: Date.now()
            }
          }
        }
        return next
      })
    } catch (error) {
      if (!silent) {
        const message = error instanceof Error ? error.message : '刷新报价失败'
        toast(message, 'error')
      }
    }
    await loadAll(false)
  }, [loadAll, toast])

  // Initial state load.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const state = normalizeState(await window.api.state.load())
        if (cancelled) return
        setStocks(state.stocks)
        setSettings(state.settings)
        setSelectedCode(state.selectedCode ?? state.stocks[0]?.code ?? null)
        setReady(true)
      } catch (error) {
        if (!cancelled) {
          toast(error instanceof Error ? error.message : '读取本地设置失败', 'error')
          setReady(true)
        }
      }
    })()
    return () => { cancelled = true }
  }, [toast])

  // Load snapshots after boot and when new stocks appear.
  useEffect(() => {
    if (!ready) return
    if (!bootRef.current) {
      bootRef.current = true
      void loadAll(false)
    }
  }, [ready, loadAll])

  useEffect(() => {
    if (!ready) return
    if (stocks.length === 0) return
    for (const stock of stocks) {
      if (!viewsRef.current[stock.code]?.snapshot && !loadingRef.current.has(stock.code)) {
        void loadSnapshot(stock.code)
      }
    }
  }, [ready, stocks, loadSnapshot])

  // Save state (debounced), not on every quote tick.
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      const state: PersistedState = {
        version: 1,
        stocks,
        selectedCode,
        settings
      }
      void window.api.state.save(state).catch(() => undefined)
    }, 350)
    return () => clearTimeout(timer)
  }, [ready, stocks, selectedCode, settings])

  // Quote polling.
  useEffect(() => {
    if (!ready) return
    const timer = setInterval(() => { void refreshAll(true) }, Math.max(3000, settings.refreshMs))
    return () => clearInterval(timer)
  }, [ready, refreshAll, settings.refreshMs])

  const metrics = useMemo(() => {
    const result: Record<string, StockMetric> = {}
    for (const stock of stocks) {
      const snapshot = views[stock.code]?.snapshot
      if (!snapshot) continue
      try {
        const thresholds = thresholdSetFor(
          snapshot.instrument.board,
          snapshot.instrument.isST,
          settings.thresholds
        )
        const series = buildAlignedSeries(
          snapshot.bars,
          snapshot.benchmarkBars,
          snapshot.quote,
          snapshot.benchmarkQuote
        )
        const windows = computeAllWindows(series, thresholds)
        const count = countStateOf(
          series,
          thresholds.ordinary3,
          severeCountFor(snapshot.instrument.board, settings.thresholds),
          settings.countMode
        )
        result[stock.code] = {
          windows,
          utilization: severeUtilization(windows),
          severe: isSevereTriggered(windows) || count.triggered,
          todayPct: snapshot.quote.changePct,
          count
        }
      } catch {
        // A malformed snapshot should not take down the watchlist.
      }
    }
    return result
  }, [stocks, views, settings.thresholds, settings.countMode])

  // Transition-based alerts: no startup spam, cooldown per stock.
  useEffect(() => {
    if (!settings.alertEnabled) return
    for (const stock of stocks) {
      const metric = metrics[stock.code]
      if (!metric) continue
      const previous = alertRef.current.get(stock.code)
      if (!previous) {
        alertRef.current.set(stock.code, {
          severe: metric.severe,
          lastNotified: metric.severe ? Date.now() : 0
        })
        continue
      }
      if (
        metric.severe &&
        !previous.severe &&
        Date.now() - previous.lastNotified >= settings.alertCooldownMs
      ) {
        const name = views[stock.code]?.snapshot?.instrument.name ?? stock.name
        const body = metric.count.triggered
          ? `10 日内已 ${metric.count.count} 次同向异动，达到 ${metric.count.required} 次标准；请核对行情与公告。`
          : '10 日 / 30 日累计偏离值已越过阈值，请核对行情与公告。'
        void window.api.notify.show({
          title: `${name} 触发严重异动`,
          body,
          code: stock.code
        })
        previous.lastNotified = Date.now()
      }
      previous.severe = metric.severe
    }
  }, [metrics, settings.alertEnabled, settings.alertCooldownMs, stocks, views])

  const selectedStock = useMemo(
    () => stocks.find((stock) => stock.code === selectedCode) ?? null,
    [stocks, selectedCode]
  )
  const selectedView = selectedCode ? views[selectedCode] ?? null : null

  const addStock = useCallback((hit: SearchHit) => {
    const code = normalizeCode(hit.code)
    const existing = stocksRef.current.find((stock) => stock.code === code)
    if (existing) {
      setSelectedCode(code)
      setMode('live')
      setHistoryDateState(null)
      toast(`${hit.name} 已在列表中`, 'info')
      return
    }
    const maxOrder = Math.max(-1, ...stocksRef.current.map((stock) => stock.order))
    const entry: StockEntry = {
      code,
      name: hit.name,
      order: maxOrder + 1
    }
    setStocks((current) => [...current, entry])
    setSelectedCode(code)
    setMode('live')
    setHistoryDateState(null)
    void loadSnapshot(code)
    toast(`已添加 ${hit.name}`, 'success')
  }, [loadSnapshot, toast])

  const removeStock = useCallback((code: string) => {
    const next = stocksRef.current.filter((stock) => stock.code !== code)
    setStocks(next)
    setViews((current) => {
      const copy = { ...current }
      delete copy[code]
      return copy
    })
    if (selectedRef.current === code) {
      setSelectedCode(next[0]?.code ?? null)
      setMode('live')
      setHistoryDateState(null)
    }
    toast('已移除', 'info')
  }, [toast])

  const selectStock = useCallback((code: string) => {
    setSelectedCode(code)
    setMode('live')
    setHistoryDateState(null)
    const view = viewsRef.current[code]
    if (!view?.snapshot || Date.now() - (view.loadedAt || 0) > 10 * 60 * 1000) {
      void loadSnapshot(code)
    }
  }, [loadSnapshot])

  const reorderStock = useCallback((code: string, targetCode: string | null) => {
    setStocks((current) => {
      const moving = current.find((stock) => stock.code === code)
      if (!moving) return current
      const rest = current
        .filter((stock) => stock.code !== code)
        .sort((a, b) => a.order - b.order)
      const targetIndex = targetCode
        ? rest.findIndex((stock) => stock.code === targetCode)
        : rest.length
      const insertAt = targetIndex < 0 ? rest.length : targetIndex
      rest.splice(insertAt, 0, moving)
      const orderMap = new Map(rest.map((stock, index) => [stock.code, index]))
      return current.map((stock) =>
        orderMap.has(stock.code) ? { ...stock, order: orderMap.get(stock.code)! } : stock
      )
    })
  }, [])

  const updateSettings = useCallback((next: Partial<AppSettings>) => {
    const merged = mergeSettings({ ...settingsRef.current, ...next })
    setSettings(merged)
    const benchmarkChanged =
      merged.benchmarkMode !== settingsRef.current.benchmarkMode ||
      merged.starBenchmark !== settingsRef.current.starBenchmark ||
      merged.dataSource !== settingsRef.current.dataSource
    if (benchmarkChanged) {
      setViews({})
      void loadAll(true, merged)
    }
  }, [loadAll])

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    setViews({})
    void loadAll(true, DEFAULT_SETTINGS)
  }, [loadAll])

  const setSimulation = useCallback((next: Partial<SimulationState>) => {
    setSimulationState((current) => ({ ...current, ...next }))
  }, [])

  const resetSimulation = useCallback(() => {
    setSimulationState((current) => ({
      ...current,
      todayPct: null,
      indexPct: null,
      locked: false,
      futureGainPct: 0
    }))
  }, [])

  const setModeSafe = useCallback((next: AppMode) => {
    setMode(next)
    if (next === 'live') {
      resetSimulation()
      setHistoryDateState(null)
    }
  }, [resetSimulation])

  const setHistoryDate = useCallback((date: string | null) => {
    setHistoryDateState(date)
    setMode(date ? 'history' : 'live')
  }, [])

  const loadDemoWatchlist = useCallback(async () => {
    const demoStocks: Array<{ code: string; name: string }> = [
      { code: '600519', name: '贵州茅台' },
      { code: '300750', name: '宁德时代' },
      { code: '688981', name: '中芯国际' }
    ]
    const existing = new Set(stocksRef.current.map((stock) => stock.code))
    const additions = demoStocks
      .filter((item) => !existing.has(item.code))
      .map((item, index) => ({
        code: item.code,
        name: item.name,
        order: stocksRef.current.length + index
      }))
    if (additions.length > 0) {
      setStocks((current) => [...current, ...additions])
    }
    setSelectedCode('600519')
    for (const item of demoStocks) {
      await loadSnapshot(item.code, { demo: true })
    }
    toast('已载入演示数据，仅用于体验界面', 'info')
  }, [loadSnapshot, toast])

  const value: AppContextValue = {
    ready,
    stocks,
    settings,
    selectedCode,
    views,
    metrics,
    simulation,
    mode,
    historyDate,
    toasts,
    settingsOpen,
    totalStocks: stocks.length,
    selectedStock,
    selectedView,
    addStock,
    removeStock,
    selectStock,
    reorderStock,
    updateSettings,
    resetSettings,
    setSimulation,
    resetSimulation,
    setMode: setModeSafe,
    setHistoryDate,
    openSettings: setSettingsOpen,
    toast,
    removeToast,
    refreshAll,
    loadSnapshot,
    loadDemoWatchlist,
    dismissAllToasts: () => setToasts([])
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}
