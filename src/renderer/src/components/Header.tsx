import { useState } from 'react'
import { fmtTime } from '../../../shared/engine/format'
import { useApp } from '../store/AppStore'
import { marketStatus, useNow } from '../utils/time'
import { LogoMark, RefreshIcon, SettingsIcon, SparkIcon } from './Icons'
import { SearchBox } from './SearchBox'

export function Header(): React.JSX.Element {
  const { selectedView, totalStocks, refreshAll, openSettings } = useApp()
  const now = useNow(15000)
  const [refreshing, setRefreshing] = useState(false)
  const status = marketStatus()
  const snapshot = selectedView?.snapshot ?? null

  const refresh = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshAll()
    } finally {
      setTimeout(() => setRefreshing(false), 450)
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <LogoMark />
        <div className="brand-copy">
          <div className="brand-title">A股异动雷达</div>
          <div className="brand-sub">滚动偏离值 · 严重异动测算</div>
        </div>
      </div>

      <SearchBox />

      <div className="top-actions">
        <div className={`market-pill ${status.tone}`}>
          <span className="status-dot" />
          {status.label}
        </div>
        <div className="top-divider" />
        <div className="data-meta">
          <span className="data-time">{fmtTime(now.getTime())}</span>
          <span className="data-sub">
            {snapshot
              ? `数据 ${fmtTime(snapshot.fetchedAt)} · ${snapshot.demo ? '演示' : snapshot.source}`
              : `${totalStocks} 只关注`}
          </span>
        </div>
        {snapshot?.stale && <span className="stale-chip">缓存</span>}
        {snapshot?.demo && (
          <span className="demo-chip"><SparkIcon size={13} />演示</span>
        )}
        <button
          className={`icon-button ${refreshing ? 'spinning' : ''}`}
          onClick={() => void refresh()}
          title="刷新行情"
          aria-label="刷新行情"
        >
          <RefreshIcon size={18} />
        </button>
        <button
          className="icon-button"
          onClick={() => openSettings(true)}
          title="设置"
          aria-label="设置"
        >
          <SettingsIcon size={18} />
        </button>
      </div>
    </header>
  )
}
