import type { Instrument, Quote } from '../../../shared/types'
import { fmtPct, fmtPrice, clamp } from '../../../shared/engine/format'
import { roundPrice } from '../../../shared/engine/series'
import { useApp } from '../store/AppStore'
import { RefreshIcon } from './Icons'

interface Preview {
  max3: number
  max10: number
  max30: number
  triggered: boolean
}

interface Props {
  instrument: Instrument
  quote: Quote
  benchmarkQuote: Quote
  preview: Preview
}

export function SimulationPanel({ instrument, quote, benchmarkQuote, preview }: Props): React.JSX.Element {
  const { simulation, setSimulation, resetSimulation } = useApp()
  const limit = instrument.limitPct > 0 ? instrument.limitPct * 100 : 30
  const todayValue = simulation.todayPct ?? quote.changePct
  const indexValue = simulation.indexPct ?? benchmarkQuote.changePct
  const futureMax = Math.max(100, Math.ceil((Math.pow(1 + (instrument.limitPct || 0.1), 3) - 1) * 100))
  const simulatedPrice = roundPrice(quote.prevClose * (1 + todayValue / 100))
  const simulatedIndex = benchmarkQuote.prevClose * (1 + indexValue / 100)
  const active = simulation.locked || simulation.todayPct !== null || simulation.indexPct !== null

  const setToday = (value: number): void => {
    setSimulation({ todayPct: clamp(value, -limit, limit), locked: true })
  }
  const setIndex = (value: number): void => {
    setSimulation({ indexPct: clamp(value, -10, 10), locked: true })
  }

  return (
    <section className="panel sim-panel">
      <div className="panel-head compact">
        <div>
          <h2 className="section-title">盘中拖动模拟</h2>
        </div>
        <div className="sim-status">
          {active ? <span className="sim-badge">模拟中</span> : <span className="live-badge">实时</span>}
          <button className="ghost-button tiny" onClick={resetSimulation} title="恢复实时">
            <RefreshIcon size={14} />恢复实时
          </button>
        </div>
      </div>

      <div className="sim-body">
        <div className="sim-slider-block">
          <div className="slider-label-row">
            <div>
              <span className="slider-label">今日涨幅</span>
              <span className="slider-hint">拖动后立即重算 3 / 10 / 30 日偏离</span>
            </div>
            <div className="number-wrap">
              <input
                className="number-input"
                type="number"
                step="0.01"
                value={todayValue.toFixed(2)}
                onChange={(event) => setToday(Number(event.target.value))}
              />
              <span>%</span>
            </div>
          </div>
          <input
            className="range"
            type="range"
            min={-limit}
            max={limit}
            step={0.01}
            value={todayValue}
            onChange={(event) => setToday(Number(event.target.value))}
            aria-label="今日涨幅模拟"
          />
          <div className="range-ends">
            <span>{fmtPct(-limit)}</span>
            <span className="sim-price">模拟价 {fmtPrice(simulatedPrice)}</span>
            <span>{fmtPct(limit)}</span>
          </div>
        </div>

        <div className="sim-slider-block">
          <div className="slider-label-row">
            <div>
              <span className="slider-label">基准指数今日涨幅</span>
              <span className="slider-hint">偏离值是相对指数，指数也会影响结果</span>
            </div>
            <div className="number-wrap">
              <input
                className="number-input"
                type="number"
                step="0.01"
                value={indexValue.toFixed(2)}
                onChange={(event) => setIndex(Number(event.target.value))}
              />
              <span>%</span>
            </div>
          </div>
          <input
            className="range range-index"
            type="range"
            min={-10}
            max={10}
            step={0.01}
            value={indexValue}
            onChange={(event) => setIndex(Number(event.target.value))}
            aria-label="指数涨幅模拟"
          />
          <div className="range-ends">
            <span>-10.00%</span>
            <span className="sim-price">模拟指数 {simulatedIndex.toFixed(2)}</span>
            <span>+10.00%</span>
          </div>
        </div>

        <div className="sim-slider-block">
          <div className="slider-label-row">
            <div>
              <span className="slider-label">未来 3 日累计涨幅</span>
              <span className="slider-hint">均匀上涨情景预览；与上方「第三日」口径一致</span>
            </div>
            <div className="number-wrap">
              <input
                className="number-input"
                type="number"
                step="0.1"
                value={simulation.futureGainPct.toFixed(1)}
                onChange={(event) => setSimulation({ futureGainPct: clamp(Number(event.target.value), -50, futureMax) })}
              />
              <span>%</span>
            </div>
          </div>
          <input
            className="range range-future"
            type="range"
            min={-30}
            max={futureMax}
            step={0.1}
            value={clamp(simulation.futureGainPct, -30, futureMax)}
            onChange={(event) => setSimulation({ futureGainPct: Number(event.target.value) })}
            aria-label="未来3日累计涨幅情景"
          />
          <div className="range-ends">
            <span>-30%</span>
            <span className={`preview-status ${preview.triggered ? 'danger' : ''}`}>
              {preview.triggered ? '该路径会触发严重异动' : '该路径未触发严重异动'}
            </span>
            <span>+{futureMax}%</span>
          </div>
          <div className="preview-values">
            <span>路径最高 3 日 <strong>{fmtPct(preview.max3)}</strong></span>
            <span>10 日 <strong>{fmtPct(preview.max10)}</strong></span>
            <span>30 日 <strong>{fmtPct(preview.max30)}</strong></span>
          </div>
        </div>
      </div>
      <div className="sim-footnote">
        拖动时不会请求网络；行情刷新不会覆盖已锁定的模拟值。
      </div>
    </section>
  )
}
