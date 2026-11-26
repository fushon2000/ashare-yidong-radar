import { useMemo } from 'react'
import type { Quote, StockSnapshot } from '../../../shared/types'
import type { AlignedRow } from '../../../shared/engine/series'
import { boardLabel, severeCountFor, thresholdSetFor } from '../../../shared/engine/rules'
import {
  buildAlignedSeries,
  computeAllWindows,
  roundPrice
} from '../../../shared/engine/series'
import { previewUniformGain } from '../../../shared/engine/forecast'
import { buildOutlook } from '../../../shared/engine/outlook'
import { reviewHistory, selectableHistoryDates } from '../../../shared/engine/history'
import { fmtPct, fmtPrice, statusClass } from '../../../shared/engine/format'
import { useApp } from '../store/AppStore'
import { DeviationCard } from './DeviationCard'
import { OutlookTable } from './OutlookTable'
import { HistoryPanel } from './HistoryPanel'
import { SimulationPanel } from './SimulationPanel'
import { TrendChart, type TrendPoint } from './TrendChart'
import { AlertIcon, HistoryIcon, PlusIcon, RefreshIcon, SparkIcon } from './Icons'

function historyRow(series: AlignedRow[], date: string | null): AlignedRow | undefined {
  if (!date) return undefined
  return series.find((row) => row.date === date)
}

function projectedQuote(quote: Quote, pct: number | null): Quote {
  if (pct === null) return quote
  const price = roundPrice(quote.prevClose * (1 + pct / 100))
  return {
    ...quote,
    price,
    change: price - quote.prevClose,
    changePct: pct
  }
}

function EmptyDetail(): React.JSX.Element {
  const { loadDemoWatchlist, totalStocks } = useApp()
  return (
    <div className="detail-empty">
      <div className="empty-visual">
        <span className="empty-ring ring-1" />
        <span className="empty-ring ring-2" />
        <span className="empty-ring ring-3" />
        <span className="empty-core"><SparkIcon size={24} /></span>
      </div>
      <h2>{totalStocks === 0 ? '把第一只股票加入关注池' : '选择左侧股票开始'}</h2>
      <p>
        计算 3 / 10 / 30 日滚动偏离值，并给出当日、第二日、第三日
        「再涨多少触发严重异动」的测算与 10 日内同向异动次数。
      </p>
      <div className="empty-actions">
        <button
          className="primary-button"
          onClick={() => document.querySelector<HTMLInputElement>('.search-input')?.focus()}
        >
          <PlusIcon size={16} />添加股票
        </button>
        {totalStocks === 0 && (
          <button className="ghost-button" onClick={() => void loadDemoWatchlist()}>
            <SparkIcon size={16} />加载演示数据
          </button>
        )}
      </div>
      <div className="empty-foot">支持沪深主板、创业板、科创板</div>
    </div>
  )
}

function SkeletonDetail(): React.JSX.Element {
  return (
    <div className="detail-skeleton">
      <div className="skeleton-line w40" />
      <div className="skeleton-line w20" />
      <div className="skeleton-cards">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
      <div className="skeleton-line w100 tall" />
      <div className="skeleton-line w100 tall" />
    </div>
  )
}

function ErrorDetail({ message, code }: { message: string; code: string }): React.JSX.Element {
  const { loadSnapshot, toast } = useApp()
  return (
    <div className="detail-error">
      <div className="error-icon"><AlertIcon size={24} /></div>
      <h2>行情加载失败</h2>
      <p>{message}</p>
      <div className="empty-actions">
        <button className="primary-button" onClick={() => void loadSnapshot(code, { forceRefresh: true })}>
          <RefreshIcon size={16} />重试
        </button>
        <button
          className="ghost-button"
          onClick={() => {
            if (['600519', '300750', '688981'].includes(code)) {
              void loadSnapshot(code, { demo: true })
            } else {
              toast('该代码暂无演示数据，请联网后重试', 'info')
            }
          }}
        >
          <SparkIcon size={16} />加载演示数据
        </button>
      </div>
    </div>
  )
}

function SnapshotView({ snapshot }: { snapshot: StockSnapshot }): React.JSX.Element {
  const {
    settings,
    simulation,
    mode,
    historyDate,
    setHistoryDate,
    setMode,
    loadSnapshot,
    toast
  } = useApp()

  const thresholds = useMemo(
    () => thresholdSetFor(snapshot.instrument.board, snapshot.instrument.isST, settings.thresholds),
    [snapshot.instrument.board, snapshot.instrument.isST, settings.thresholds]
  )

  const liveQuote = useMemo(
    () => projectedQuote(snapshot.quote, mode === 'live' ? simulation.todayPct : null),
    [snapshot.quote, simulation.todayPct, mode]
  )
  const liveIndexQuote = useMemo(
    () => projectedQuote(snapshot.benchmarkQuote, mode === 'live' ? simulation.indexPct : null),
    [snapshot.benchmarkQuote, simulation.indexPct, mode]
  )

  const series = useMemo(
    () => buildAlignedSeries(
      snapshot.bars,
      snapshot.benchmarkBars,
      mode === 'live' ? liveQuote : undefined,
      mode === 'live' ? liveIndexQuote : undefined
    ),
    [snapshot.bars, snapshot.benchmarkBars, liveQuote, liveIndexQuote, mode]
  )
  const historicalSeries = useMemo(
    () => buildAlignedSeries(snapshot.bars, snapshot.benchmarkBars),
    [snapshot.bars, snapshot.benchmarkBars]
  )
  const windows = useMemo(() => computeAllWindows(series, thresholds), [series, thresholds])
  const countRequired = useMemo(
    () => severeCountFor(snapshot.instrument.board, settings.thresholds),
    [snapshot.instrument.board, settings.thresholds]
  )
  const outlook = useMemo(() => buildOutlook({
    series,
    thresholds,
    limitPct: snapshot.instrument.limitPct,
    currentPrice: liveQuote.price,
    countRequired,
    countMode: settings.countMode,
    indexFuturePct: 0
  }), [series, thresholds, snapshot.instrument.limitPct, liveQuote.price, countRequired, settings.countMode])
  const preview = useMemo(
    () => previewUniformGain(series, thresholds, simulation.futureGainPct, 0, 3),
    [series, thresholds, simulation.futureGainPct]
  )
  const historyDates = useMemo(() => selectableHistoryDates(historicalSeries, 60), [historicalSeries])
  const review = useMemo(
    () => mode === 'history' && historyDate
      ? reviewHistory(historicalSeries, thresholds, historyDate)
      : null,
    [mode, historyDate, historicalSeries, thresholds]
  )
  const selectedHistoryRow = historyRow(historicalSeries, historyDate)
  const displayWindows = mode === 'history' ? review?.deviations ?? [] : windows
  const displayPrice = mode === 'history' ? selectedHistoryRow?.stockClose ?? liveQuote.price : liveQuote.price
  const displayChange = mode === 'history'
    ? selectedHistoryRow ? selectedHistoryRow.stockPct * 100 : liveQuote.changePct
    : liveQuote.changePct
  const displayIndexChange = mode === 'history'
    ? selectedHistoryRow ? selectedHistoryRow.indexPct * 100 : liveIndexQuote.changePct
    : liveIndexQuote.changePct

  const trendPoints = useMemo<TrendPoint[]>(() => {
    const source = mode === 'history' ? historicalSeries : series
    const start = Math.max(29, source.length - 60)
    const points: TrendPoint[] = []
    for (let i = start; i < source.length; i++) {
      const prefix = source.slice(0, i + 1)
      const current = computeAllWindows(prefix, thresholds)
      const d3 = current.find((item) => item.window === 3)?.deviation ?? 0
      const d10 = current.find((item) => item.window === 10)?.deviation ?? 0
      const d30 = current.find((item) => item.window === 30)?.deviation ?? 0
      points.push({ date: source[i].date, d3, d10, d30 })
    }
    return points
  }, [historicalSeries, series, thresholds, mode])

  const lastBarDate = snapshot.bars[snapshot.bars.length - 1]?.date
  const stale = snapshot.stale || (!!snapshot.quote.tradeDate && !!lastBarDate && snapshot.quote.tradeDate !== lastBarDate)

  return (
    <div className="detail-content">
      <div className="detail-head">
        <div className="stock-heading">
          <div className="stock-heading-line">
            <h1>{snapshot.instrument.name}</h1>
            <span className="stock-code">{snapshot.instrument.code}</span>
            <span className={`board-tag ${snapshot.instrument.isST ? 'st' : ''}`}>
              {boardLabel(snapshot.instrument.board)}{snapshot.instrument.isST ? ' · ST' : ''}
            </span>
            {snapshot.demo && <span className="demo-chip"><SparkIcon size={12} />演示</span>}
            {stale && <span className="stale-chip">缓存 / 延迟</span>}
          </div>
          <div className="benchmark-line">
            <span className="benchmark-label">基准</span>
            <strong>{snapshot.benchmark.name}</strong>
            <span className="benchmark-code">{snapshot.benchmark.code}</span>
            <span className={statusClass(displayIndexChange)}>{fmtPct(displayIndexChange)}</span>
            <span className="dot-sep">·</span>
            <span>{mode === 'history' ? `复盘 ${historyDate ?? '--'}` : `数据 ${snapshot.asOf}`}</span>
            <span className="dot-sep">·</span>
            <span>{snapshot.source}</span>
          </div>
        </div>

        <div className="price-heading">
          <div className={`detail-price ${statusClass(displayChange)}`}>{fmtPrice(displayPrice)}</div>
          <div className={`detail-change ${statusClass(displayChange)}`}>{fmtPct(displayChange)}</div>
        </div>

        <div className="detail-actions">
          {mode === 'history' ? (
            <button className="ghost-button tiny" onClick={() => setMode('live')}>
              <RefreshIcon size={14} />返回实时
            </button>
          ) : (
            <button
              className="ghost-button tiny"
              onClick={() => {
                if (historyDates.length > 0) {
                  setHistoryDate(historyDates[Math.max(0, historyDates.length - 6)])
                }
                else toast('历史数据不足，无法复盘', 'info')
              }}
            >
              <HistoryIcon size={14} />历史复盘
            </button>
          )}
          <button
            className="icon-button small"
            title="刷新该股票"
            onClick={() => void loadSnapshot(snapshot.instrument.code, { forceRefresh: true })}
          >
            <RefreshIcon size={16} />
          </button>
        </div>
      </div>

      {(snapshot.warnings.length > 0 || snapshot.demo) && (
        <div className={`warning-strip ${snapshot.demo ? 'demo' : ''}`}>
          <AlertIcon size={15} />
          <span>
            {snapshot.demo
              ? '当前为演示数据，不代表真实行情；添加真实股票后自动切换。'
              : snapshot.warnings.join('；')}
          </span>
        </div>
      )}

      <div className="cards-grid">
        <DeviationCard window={3} data={displayWindows.find((item) => item.window === 3)} historical={mode === 'history'} />
        <DeviationCard window={10} data={displayWindows.find((item) => item.window === 10)} historical={mode === 'history'} />
        <DeviationCard window={30} data={displayWindows.find((item) => item.window === 30)} historical={mode === 'history'} />
      </div>

      {mode === 'live' && (
        <SimulationPanel
          instrument={snapshot.instrument}
          quote={liveQuote}
          benchmarkQuote={liveIndexQuote}
          preview={preview}
        />
      )}

      {mode === 'live' ? (
        <OutlookTable outlook={outlook} boardName={boardLabel(snapshot.instrument.board)} />
      ) : (
        <HistoryPanel
          review={review}
          dates={historyDates}
          selectedDate={historyDate}
          onChange={(date) => setHistoryDate(date)}
          onBack={() => setMode('live')}
        />
      )}

      <section className="panel trend-panel">
        <div className="panel-head compact">
          <div>
            <h2 className="section-title">偏离值趋势</h2>
            <p className="section-desc">近 60 个交易日，点击任意一天进入历史复盘。</p>
          </div>
          <div className="trend-meta">
            <span><i className="legend-dot d3" />3日</span>
            <span><i className="legend-dot d10" />10日</span>
            <span><i className="legend-dot d30" />30日</span>
          </div>
        </div>
        <TrendChart
          points={trendPoints}
          historyDate={mode === 'history' ? historyDate : null}
          onSelectDate={(date) => setHistoryDate(date)}
        />
      </section>
    </div>
  )
}

export function StockDetail(): React.JSX.Element {
  const { selectedStock, selectedView } = useApp()
  if (!selectedStock) return <EmptyDetail />
  if (!selectedView || (selectedView.loading && !selectedView.snapshot)) {
    return <SkeletonDetail />
  }
  if (!selectedView.snapshot) {
    return <ErrorDetail message={selectedView.error ?? '未知错误'} code={selectedStock.code} />
  }
  return <SnapshotView snapshot={selectedView.snapshot} />
}
