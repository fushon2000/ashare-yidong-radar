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
  StockGroup,
  StockSnapshot,
  WindowDeviation
} from '../../../shared/types'
import { DEFAULT_SETTINGS, DEFAULT_STATE } from '../../../shared/types'
import {
  buildInstrument,
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
  groups: StockGroup[]
  stocks: StockEntry[]
  settings: AppSettings
  selectedCode: string | null
  activeGroupId: string
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
  createGroup(name: string): void
  renameGroup(id: string, name: string): void
  deleteGroup(id: string): void
  moveStockToGroup(code: string, groupId: string): void
  reorderStock(code: string, targetCode: string | null): void
  setActiveGroup(id: string): void
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
  exportCsv(): Promise<void>
  importCsv(): Promise<void>
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
  const groups = state.groups?.length ? state.groups : DEFAULT_STATE.groups
  const ids = new Set(groups.map((group) => group.id))
  const settings = mergeSettings(state.settings)
  const savedVersion = typeof state.version === 'number' ? state.version : 1
  if (savedVersion < 2 && settings.thresholds.st3 === 12) {
    // v1 的「主板 ST 3 日 12%」基于 2026-07-06 前的旧规（ST 涨跌幅 ±5%）。
    // 新《交易规则》将主板 ST 涨跌幅放宽到 ±10%，对应异常波动阈值同步为 20%。
    settings.thresholds = { ...settings.thresholds, st3: 20 }
  }
  return {
    version: DEFAULT_STATE.version,
    groups,
    stocks: (state.stocks ?? []).filter((stock) => ids.has(stock.groupId)),
    selectedCode: state.selectedCode ?? null,
    settings
  }
}

function nextGroupId(groups: StockGroup[]): string {
  let index = groups.length + 1
  let id = `group-${index}`
  while (groups.some((group) => group.id === id)) {
    index += 1
    id = `group-${index}`
  }
  return id
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [groups, setGroups] = useState<StockGroup[]>(DEFAULT_STATE.groups)
  const [stocks, setStocks] = useState<StockEntry[]>([])
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [activeGroupId, setActiveGroupId] = useState('default')
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
        setGroups(state.groups)
        setStocks(state.stocks)
        setSettings(state.settings)
        setSelectedCode(state.selectedCode ?? state.stocks[0]?.code ?? null)
        setActiveGroupId(state.groups[0]?.id ?? 'default')
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
        groups,
        stocks,
        selectedCode,
        settings
      }
      void window.api.state.save(state).catch(() => undefined)
    }, 350)
    return () => clearTimeout(timer)
  }, [ready, groups, stocks, selectedCode, settings])

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
      toast(`${hit.name} 已在关注池中`, 'info')
      return
    }
    const groupId = groups.some((group) => group.id === activeGroupId)
      ? activeGroupId
      : groups[0]?.id ?? 'default'
    const maxOrder = Math.max(-1, ...stocksRef.current.filter((stock) => stock.groupId === groupId).map((stock) => stock.order))
    const entry: StockEntry = {
      code,
      name: hit.name,
      groupId,
      order: maxOrder + 1
    }
    setStocks((current) => [...current, entry])
    setSelectedCode(code)
    setMode('live')
    setHistoryDateState(null)
    void loadSnapshot(code)
    toast(`已添加 ${hit.name}`, 'success')
  }, [activeGroupId, groups, loadSnapshot, toast])

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
    toast('已从关注池移除', 'info')
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

  const createGroup = useCallback((name: string) => {
    const clean = name.trim() || '新分组'
    const group: StockGroup = {
      id: nextGroupId(groups),
      name: clean,
      order: groups.length
    }
    setGroups((current) => [...current, group])
    setActiveGroupId(group.id)
    toast(`已创建分组“${clean}”`, 'success')
  }, [groups, toast])

  const renameGroup = useCallback((id: string, name: string) => {
    const clean = name.trim()
    if (!clean) return
    setGroups((current) => current.map((group) => group.id === id ? { ...group, name: clean } : group))
  }, [])

  const deleteGroup = useCallback((id: string) => {
    if (groups.length <= 1) {
      toast('至少保留一个分组', 'error')
      return
    }
    const remaining = groups.filter((group) => group.id !== id)
    const fallback = remaining[0]
    setGroups(remaining)
    setStocks((current) => current.map((stock) =>
      stock.groupId === id ? { ...stock, groupId: fallback.id } : stock
    ))
    if (activeGroupId === id) setActiveGroupId(fallback.id)
  }, [activeGroupId, groups, toast])

  const moveStockToGroup = useCallback((code: string, groupId: string) => {
    setStocks((current) => {
      const maxOrder = Math.max(-1, ...current.filter((stock) => stock.groupId === groupId).map((stock) => stock.order))
      return current.map((stock) => stock.code === code
        ? { ...stock, groupId, order: maxOrder + 1 }
        : stock)
    })
    setActiveGroupId(groupId)
  }, [])

  const reorderStock = useCallback((code: string, targetCode: string | null) => {
    setStocks((current) => {
      const moving = current.find((stock) => stock.code === code)
      if (!moving) return current
      const groupStocks = current
        .filter((stock) => stock.groupId === moving.groupId && stock.code !== code)
        .sort((a, b) => a.order - b.order)
      const targetIndex = targetCode
        ? groupStocks.findIndex((stock) => stock.code === targetCode)
        : groupStocks.length
      const insertAt = targetIndex < 0 ? groupStocks.length : targetIndex
      groupStocks.splice(insertAt, 0, moving)
      const orderMap = new Map(groupStocks.map((stock, index) => [stock.code, index]))
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
    const groupId = groups[0]?.id ?? 'default'
    const existing = new Set(stocksRef.current.map((stock) => stock.code))
    const additions = demoStocks
      .filter((item) => !existing.has(item.code))
      .map((item, index) => ({
        code: item.code,
        name: item.name,
        groupId,
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
  }, [groups, loadSnapshot, toast])

  const exportCsv = useCallback(async () => {
    const header = '分组,代码,名称,备注'
    const lines = [header]
    const sorted = [...stocksRef.current].sort((a, b) => a.order - b.order)
    for (const stock of sorted) {
      const group = groups.find((item) => item.id === stock.groupId)?.name ?? ''
      const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`
      lines.push([escape(group), escape(stock.code), escape(stock.name), escape(stock.note ?? '')].join(','))
    }
    const result = await window.api.csv.export(`\uFEFF${lines.join('\r\n')}`, '关注池.csv')
    if (!result.canceled) toast('关注池已导出', 'success')
  }, [groups, toast])

  const importCsv = useCallback(async () => {
    const result = await window.api.csv.import()
    if (result.canceled || !result.content) return
    const text = result.content.replace(/^\uFEFF/, '')
    const rows: string[][] = []
    let current = ''
    let cell = ''
    let quoted = false
    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          cell += '"'
          i++
        } else if (char === '"') {
          quoted = false
        } else {
          cell += char
        }
      } else if (char === '"') {
        quoted = true
      } else if (char === ',') {
        current += `${cell}\u0000`
        cell = ''
      } else if (char === '\n') {
        current += cell
        rows.push(current.split('\u0000'))
        current = ''
        cell = ''
      } else if (char !== '\r') {
        cell += char
      }
    }
    if (cell || current) {
      current += cell
      rows.push(current.split('\u0000'))
    }
    if (rows.length < 2) {
      toast('CSV 内容为空', 'error')
      return
    }
    const header = rows[0].map((item) => item.trim())
    const codeIndex = header.findIndex((item) => item.includes('代码'))
    const nameIndex = header.findIndex((item) => item.includes('名称'))
    const groupIndex = header.findIndex((item) => item.includes('分组'))
    const noteIndex = header.findIndex((item) => item.includes('备注'))
    if (codeIndex < 0) {
      toast('CSV 缺少“代码”列', 'error')
      return
    }
    const nextGroups = [...groups]
    const nextStocks = [...stocksRef.current]
    let added = 0
    for (const row of rows.slice(1)) {
      const rawCode = row[codeIndex]?.trim()
      if (!rawCode) continue
      const code = normalizeCode(rawCode)
      try {
        const instrument = buildInstrument(code, row[nameIndex] ?? code, settingsRef.current)
        if (nextStocks.some((stock) => stock.code === code)) continue
        const groupName = row[groupIndex]?.trim() || '导入分组'
        let group = nextGroups.find((item) => item.name === groupName)
        if (!group) {
          group = { id: nextGroupId(nextGroups), name: groupName, order: nextGroups.length }
          nextGroups.push(group)
        }
        nextStocks.push({
          code,
          name: instrument.name,
          groupId: group.id,
          order: nextStocks.length,
          note: noteIndex >= 0 ? row[noteIndex]?.trim() : undefined
        })
        added++
      } catch {
        // skip unsupported rows
      }
    }
    setGroups(nextGroups)
    setStocks(nextStocks)
    toast(added > 0 ? `已导入 ${added} 只股票` : '没有新增股票', added > 0 ? 'success' : 'info')
    for (const stock of nextStocks) {
      if (!viewsRef.current[stock.code]?.snapshot) void loadSnapshot(stock.code)
    }
  }, [groups, loadSnapshot, toast])

  const value: AppContextValue = {
    ready,
    groups,
    stocks,
    settings,
    selectedCode,
    activeGroupId,
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
    createGroup,
    renameGroup,
    deleteGroup,
    moveStockToGroup,
    reorderStock,
    setActiveGroup: setActiveGroupId,
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
    exportCsv,
    importCsv,
    dismissAllToasts: () => setToasts([])
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}
