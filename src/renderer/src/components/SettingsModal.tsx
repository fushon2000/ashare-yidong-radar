import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/types'
import { useApp } from '../store/AppStore'
import { CloseIcon } from './Icons'

function NumberField({
  label,
  value,
  suffix,
  min,
  max,
  onChange
}: {
  label: string
  value: number
  suffix: string
  min: number
  max: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-input-wrap">
        <input
          className="field-input"
          type="number"
          value={value}
          min={min}
          max={max}
          step="0.1"
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
          }}
        />
        <em>{suffix}</em>
      </div>
    </label>
  )
}

export function SettingsModal(): React.JSX.Element | null {
  const { settingsOpen, openSettings, settings, updateSettings, resetSettings, toast } = useApp()
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    if (settingsOpen) setDraft(settings)
  }, [settingsOpen, settings])

  if (!settingsOpen) return null

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const setThreshold = (key: keyof AppSettings['thresholds'], value: number): void => {
    setDraft((current) => ({
      ...current,
      thresholds: { ...current.thresholds, [key]: value }
    }))
  }

  const save = (): void => {
    updateSettings(draft)
    openSettings(false)
    toast('设置已保存', 'success')
  }

  const reset = (): void => {
    setDraft(DEFAULT_SETTINGS)
    resetSettings()
    toast('已恢复默认设置', 'info')
  }

  const clearCache = async (): Promise<void> => {
    setClearing(true)
    try {
      await window.api.market.clearCache()
      toast('本地行情缓存已清理', 'success')
    } catch {
      toast('清理缓存失败', 'error')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={() => openSettings(false)}>
      <div className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-head">
          <div>
            <h2>设置</h2>
          </div>
          <button className="icon-button" onClick={() => openSettings(false)} aria-label="关闭">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3>行情</h3>
            <div className="settings-grid">
              <label className="field">
                <span>刷新间隔</span>
                <select
                  className="field-input"
                  value={draft.refreshMs}
                  onChange={(event) => set('refreshMs', Number(event.target.value))}
                >
                  <option value={3000}>3 秒</option>
                  <option value={5000}>5 秒</option>
                  <option value={10000}>10 秒</option>
                  <option value={30000}>30 秒</option>
                </select>
              </label>
              <label className="field">
                <span>数据源</span>
                <select
                  className="field-input"
                  value={draft.dataSource}
                  onChange={(event) => set('dataSource', event.target.value as AppSettings['dataSource'])}
                >
                  <option value="auto">自动（东财优先，腾讯备用）</option>
                  <option value="eastmoney">东方财富</option>
                  <option value="tencent">腾讯行情</option>
                </select>
              </label>
            </div>
          </section>

          <section className="settings-section">
            <h3>基准指数</h3>
            <div className="settings-grid">
              <label className="field">
                <span>主板 / 创业板口径</span>
                <select
                  className="field-input"
                  value={draft.benchmarkMode}
                  onChange={(event) => set('benchmarkMode', event.target.value as AppSettings['benchmarkMode'])}
                >
                  <option value="official">交易所口径（上证A股 / 深证A股 / 创业板综）</option>
                  <option value="common">大众行情口径（上证指数 / 深证成指 / 创业板指）</option>
                </select>
              </label>
              <label className="field">
                <span>科创板基准</span>
                <select
                  className="field-input"
                  value={draft.starBenchmark}
                  onChange={(event) => set('starBenchmark', event.target.value as AppSettings['starBenchmark'])}
                >
                  <option value="000680">科创综指 000680</option>
                  <option value="000688">科创50 000688</option>
                </select>
              </label>
            </div>
          </section>

          <section className="settings-section">
            <h3>提醒</h3>
            <div className="settings-switches">
              <label className="switch-row">
                <span>
                  <strong>临界提醒</strong>
                  <em>80% 黄色、95% 红色，首次触发弹窗</em>
                </span>
                <input
                  type="checkbox"
                  checked={draft.alertEnabled}
                  onChange={(event) => set('alertEnabled', event.target.checked)}
                />
              </label>
              <label className="switch-row">
                <span>
                  <strong>关闭窗口时最小化到托盘</strong>
                  <em>关闭后提醒仍可工作，从托盘退出</em>
                </span>
                <input
                  type="checkbox"
                  checked={draft.closeToTray}
                  onChange={(event) => set('closeToTray', event.target.checked)}
                />
              </label>
              <NumberField
                label="同一股票通知冷却"
                value={Math.round(draft.alertCooldownMs / 60000)}
                suffix="分钟"
                min={1}
                max={120}
                onChange={(value) => set('alertCooldownMs', Math.round(value * 60000))}
              />
            </div>
          </section>

          <section className="settings-section">
            <h3>规则阈值 <span className="settings-version">2026-07-06 新《交易规则》</span></h3>
            <div className="settings-grid three">
              <NumberField label="主板 3 日" value={draft.thresholds.main3} suffix="%" min={1} max={50} onChange={(value) => setThreshold('main3', value)} />
              <NumberField label="创业/科创 3 日" value={draft.thresholds.growth3} suffix="%" min={1} max={50} onChange={(value) => setThreshold('growth3', value)} />
              <NumberField label="主板 ST 3 日" value={draft.thresholds.st3} suffix="%" min={1} max={50} onChange={(value) => setThreshold('st3', value)} />
              <NumberField label="10 日严重" value={draft.thresholds.severe10} suffix="%" min={10} max={300} onChange={(value) => setThreshold('severe10', value)} />
              <NumberField label="30 日严重" value={draft.thresholds.severe30} suffix="%" min={10} max={500} onChange={(value) => setThreshold('severe30', value)} />
              <NumberField label="10 日下跌" value={draft.thresholds.severe10Down} suffix="%" min={-90} max={-1} onChange={(value) => setThreshold('severe10Down', value)} />
              <NumberField label="30 日下跌" value={draft.thresholds.severe30Down} suffix="%" min={-90} max={-1} onChange={(value) => setThreshold('severe30Down', value)} />
              <NumberField label="主板 同向次数" value={draft.thresholds.countMain} suffix="次" min={1} max={10} onChange={(value) => setThreshold('countMain', Math.round(value))} />
              <NumberField label="创业/科创 同向次数" value={draft.thresholds.countGrowth} suffix="次" min={1} max={10} onChange={(value) => setThreshold('countGrowth', Math.round(value))} />
            </div>
            <div className="settings-grid">
              <label className="field">
                <span>同向异动计数口径</span>
                <select
                  className="field-input"
                  value={draft.countMode}
                  onChange={(event) => set('countMode', event.target.value as AppSettings['countMode'])}
                >
                  <option value="step2">触发当日起算（窗口重叠 1 日）· 默认</option>
                  <option value="step3">触发次一交易日起算（严格不重叠）</option>
                  <option value="rolling">每个达标窗口各计 1 次</option>
                </select>
              </label>
            </div>
            <p className="settings-note">
              主板风险警示股（ST / *ST）自 2026-07-06 起涨跌幅由 ±5% 放宽至 ±10%，
              对应 3 日异常波动阈值由 ±12% 调整为 ±20%，默认值已同步。
              次数型判定只认价格偏离值、不含换手率异动；交易所未公开具体计数算法，
              默认口径为按实盘公告反推，最终以交易所认定为准。
            </p>
          </section>
        </div>

        <div className="settings-foot">
          <div className="settings-foot-left">
            <button className="ghost-button tiny" onClick={() => void clearCache()} disabled={clearing}>
              {clearing ? '清理中…' : '清理行情缓存'}
            </button>
            <button className="ghost-button tiny" onClick={reset}>恢复默认</button>
          </div>
          <div className="settings-foot-right">
            <button className="ghost-button" onClick={() => openSettings(false)}>取消</button>
            <button className="primary-button" onClick={save}>保存设置</button>
          </div>
        </div>
      </div>
    </div>
  )
}
