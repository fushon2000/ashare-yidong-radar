import { useEffect } from 'react'
import { Header } from './components/Header'
import { StockDetail } from './components/StockDetail'
import { Watchlist } from './components/Watchlist'
import { SettingsModal } from './components/SettingsModal'
import { ToastStack } from './components/Toast'
import { LogoMark } from './components/Icons'
import { useApp } from './store/AppStore'

export default function App(): React.JSX.Element {
  const { ready, refreshAll, selectStock } = useApp()

  useEffect(() => {
    const offSelect = window.api.app.onSelectStock((code) => selectStock(code))
    const offRefresh = window.api.app.onRefresh(() => { void refreshAll() })
    return () => {
      offSelect()
      offRefresh()
    }
  }, [refreshAll, selectStock])

  if (!ready) {
    return (
      <div className="boot-screen">
        <LogoMark />
        <div className="boot-title">A股异动雷达</div>
        <div className="boot-sub">正在读取本地设置…</div>
        <div className="boot-bar"><span /></div>
      </div>
    )
  }

  return (
    <div className="app-root">
      <Header />
      <div className="workspace">
        <Watchlist />
        <main className="main-panel">
          <StockDetail />
          <footer className="app-footer">
            数据来自公开行情接口，可能存在延迟；本工具仅做规则测算，不构成投资建议。
            最终异动认定以交易所公告和上市公司披露为准。
          </footer>
        </main>
      </div>
      <SettingsModal />
      <ToastStack />
    </div>
  )
}
