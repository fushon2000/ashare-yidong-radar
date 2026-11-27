import { useMemo, useState } from 'react'
import type { StockEntry, WindowDeviation } from '../../../shared/types'
import { boardLabel } from '../../../shared/engine/rules'
import { fmtPct, fmtPrice, statusClass } from '../../../shared/engine/format'
import { useApp } from '../store/AppStore'
import {
  ChevronDownIcon,
  DragIcon,
  PlusIcon,
  SparkIcon,
  TrashIcon
} from './Icons'

function miniValue(windows: WindowDeviation[], window: 3 | 10 | 30): string {
  const hit = windows.find((item) => item.window === window)
  return hit ? `${hit.deviation > 0 ? '+' : ''}${hit.deviation.toFixed(1)}` : '--'
}

function WatchRow({ stock }: { stock: StockEntry }): React.JSX.Element {
  const { selectedCode, selectStock, removeStock, metrics, views, reorderStock } = useApp()
  const [dropTarget, setDropTarget] = useState(false)
  const view = views[stock.code]
  const snapshot = view?.snapshot
  const metric = metrics[stock.code]
  const utilization = metric?.utilization ?? 0
  const severity = utilization >= 0.95 ? 'danger' : utilization >= 0.8 ? 'warn' : ''
  const active = selectedCode === stock.code

  return (
    <div
      className={`watch-row ${active ? 'active' : ''} ${severity} ${dropTarget ? 'drop-target' : ''}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', stock.code)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDropTarget(true)
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDropTarget(false)
        const code = event.dataTransfer.getData('text/plain')
        if (code && code !== stock.code) reorderStock(code, stock.code)
      }}
      onClick={() => selectStock(stock.code)}
    >
      <div className="watch-drag"><DragIcon size={14} /></div>
      <div className="watch-main">
        <div className="watch-line">
          <span className="watch-name">{stock.name}</span>
          {snapshot?.instrument.isST && <span className="tag tag-st">ST</span>}
          {snapshot && <span className="watch-board">{boardLabel(snapshot.instrument.board)}</span>}
        </div>
        <div className="watch-code-line">
          <span className="watch-code">{stock.code}</span>
          {metric?.severe && <span className="alert-text">严重异动</span>}
        </div>
      </div>
      <div className="watch-quote">
        {snapshot ? (
          <>
            <span className={`watch-price ${statusClass(snapshot.quote.changePct)}`}>
              {fmtPrice(snapshot.quote.price)}
            </span>
            <span className={`watch-change ${statusClass(snapshot.quote.changePct)}`}>
              {fmtPct(snapshot.quote.changePct)}
            </span>
          </>
        ) : view?.loading ? (
          <span className="watch-loading">加载中</span>
        ) : (
          <span className="watch-loading">--</span>
        )}
      </div>
      <div className="watch-minis">
        {([3, 10, 30] as const).map((window) => {
          const hit = metric?.windows.find((item) => item.window === window)
          const cls = hit
            ? hit.triggered ? 'hit' : hit.utilization >= 0.8 ? 'near' : ''
            : ''
          return (
            <span
              key={window}
              className={`mini-badge ${cls}`}
              title={`${window}日偏离 ${hit ? fmtPct(hit.deviation) : '--'} / 阈值 ${hit?.threshold ?? '--'}%`}
            >
              <em>{window}日</em>
              {miniValue(metric?.windows ?? [], window)}
            </span>
          )
        })}
      </div>
      <button
        className="row-delete"
        title="移除"
        onClick={(event) => {
          event.stopPropagation()
          removeStock(stock.code)
        }}
      >
        <TrashIcon size={14} />
      </button>
    </div>
  )
}

export function Watchlist(): React.JSX.Element {
  const { stocks, loadDemoWatchlist, totalStocks } = useApp()
  // 手机竖屏默认折叠列表，把区域留给详情；桌面端默认展开。
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.innerWidth < 760 && window.innerHeight > window.innerWidth
  )

  const visible = useMemo(
    () => [...stocks].sort((a, b) => a.order - b.order),
    [stocks]
  )

  const focusSearch = (): void => {
    const input = document.querySelector<HTMLInputElement>('.search-input')
    input?.focus()
  }

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-head">
        <div>
          <div className="sidebar-title">个股列表</div>
          <div className="sidebar-sub">{totalStocks} 只股票 · 自动刷新</div>
        </div>
        <div className="sidebar-tools">
          <button
            className="tiny-icon collapse-toggle"
            title={collapsed ? '展开个股列表' : '折叠个股列表'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((current) => !current)}
          >
            <span className="collapse-icon"><ChevronDownIcon size={15} /></span>
          </button>
        </div>
      </div>

      <div className="watch-list">
        {visible.length === 0 && (
          <div className="sidebar-empty">
            <div className="empty-orbit">
              <span />
              <span />
              <span />
            </div>
            <h3>还没有关注股票</h3>
            <p>搜索代码或名称，添加第一只股票。</p>
            <button className="primary-button small" onClick={focusSearch}>
              <PlusIcon size={15} />添加股票
            </button>
            <button className="ghost-button small" onClick={() => void loadDemoWatchlist()}>
              <SparkIcon size={15} />先看演示数据
            </button>
          </div>
        )}
        {visible.map((stock) => (
          <WatchRow key={stock.code} stock={stock} />
        ))}
      </div>

      <div className="sidebar-foot">
        <span className="foot-dot" />
        红涨绿跌 · 数据仅供规则测算
      </div>
    </aside>
  )
}
