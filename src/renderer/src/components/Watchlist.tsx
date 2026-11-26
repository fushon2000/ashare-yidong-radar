import { useMemo, useState } from 'react'
import type { StockEntry, WindowDeviation } from '../../../shared/types'
import { boardLabel } from '../../../shared/engine/rules'
import { fmtPct, fmtPrice, statusClass } from '../../../shared/engine/format'
import { useApp } from '../store/AppStore'
import {
  ChevronDownIcon,
  DownloadIcon,
  DragIcon,
  PlusIcon,
  SparkIcon,
  TrashIcon,
  UploadIcon
} from './Icons'

function miniValue(windows: WindowDeviation[], window: 3 | 10 | 30): string {
  const hit = windows.find((item) => item.window === window)
  return hit ? `${hit.deviation > 0 ? '+' : ''}${hit.deviation.toFixed(1)}` : '--'
}

function WatchRow({
  stock,
  onDragStart
}: {
  stock: StockEntry
  onDragStart: (code: string) => void
}): React.JSX.Element {
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
        onDragStart(stock.code)
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
  const {
    groups,
    stocks,
    activeGroupId,
    setActiveGroup,
    createGroup,
    renameGroup,
    deleteGroup,
    moveStockToGroup,
    loadDemoWatchlist,
    exportCsv,
    importCsv,
    totalStocks
  } = useApp()
  const [dragging, setDragging] = useState<string | null>(null)
  const [groupDrop, setGroupDrop] = useState<string | null>(null)

  const visible = useMemo(
    () => stocks
      .filter((stock) => stock.groupId === activeGroupId)
      .sort((a, b) => a.order - b.order),
    [stocks, activeGroupId]
  )
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0]

  const addGroup = (): void => {
    const name = window.prompt('新分组名称', `分组 ${groups.length + 1}`)
    if (name?.trim()) createGroup(name)
  }

  const rename = (): void => {
    if (!activeGroup) return
    const name = window.prompt('重命名分组', activeGroup.name)
    if (name?.trim()) renameGroup(activeGroup.id, name)
  }

  const removeGroup = (): void => {
    if (!activeGroup) return
    if (window.confirm(`删除分组“${activeGroup.name}”？组内股票会移动到第一个分组。`)) {
      deleteGroup(activeGroup.id)
    }
  }

  const focusSearch = (): void => {
    const input = document.querySelector<HTMLInputElement>('.search-input')
    input?.focus()
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div>
          <div className="sidebar-title">关注池</div>
          <div className="sidebar-sub">{totalStocks} 只股票 · 自动刷新</div>
        </div>
        <div className="sidebar-tools">
          <button className="tiny-icon" title="导入 CSV" onClick={() => void importCsv()}>
            <UploadIcon size={15} />
          </button>
          <button className="tiny-icon" title="导出 CSV" onClick={() => void exportCsv()}>
            <DownloadIcon size={15} />
          </button>
          <button className="tiny-icon" title="新建分组" onClick={addGroup}>
            <PlusIcon size={15} />
          </button>
        </div>
      </div>

      <div className="group-tabs">
        {groups.map((group) => (
          <button
            key={group.id}
            className={`group-tab ${group.id === activeGroupId ? 'active' : ''} ${groupDrop === group.id ? 'drop' : ''}`}
            onClick={() => setActiveGroup(group.id)}
            onDoubleClick={() => {
              const name = window.prompt('重命名分组', group.name)
              if (name?.trim()) renameGroup(group.id, name)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setGroupDrop(group.id)
            }}
            onDragLeave={() => setGroupDrop(null)}
            onDrop={(event) => {
              event.preventDefault()
              setGroupDrop(null)
              const code = event.dataTransfer.getData('text/plain') || dragging
              if (code) moveStockToGroup(code, group.id)
              setDragging(null)
            }}
          >
            <span>{group.name}</span>
            <em>{stocks.filter((stock) => stock.groupId === group.id).length}</em>
          </button>
        ))}
      </div>

      <div className="group-actions">
        <button className="group-name-button" onClick={rename} title="点击重命名">
          {activeGroup?.name ?? '默认分组'}
          <ChevronDownIcon size={13} />
        </button>
        {groups.length > 1 && (
          <button className="link-danger" onClick={removeGroup}>删除分组</button>
        )}
      </div>

      <div className="watch-list">
        {visible.length === 0 && (
          <div className="sidebar-empty">
            {totalStocks === 0 ? (
              <>
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
              </>
            ) : (
              <>
                <h3>这个分组是空的</h3>
                <p>把其他分组的股票拖到这里，或添加新股票。</p>
                <button className="primary-button small" onClick={focusSearch}>
                  <PlusIcon size={15} />添加股票
                </button>
              </>
            )}
          </div>
        )}
        {visible.map((stock) => (
          <WatchRow key={stock.code} stock={stock} onDragStart={setDragging} />
        ))}
      </div>

      <div className="sidebar-foot">
        <span className="foot-dot" />
        红涨绿跌 · 数据仅供规则测算
      </div>
    </aside>
  )
}
