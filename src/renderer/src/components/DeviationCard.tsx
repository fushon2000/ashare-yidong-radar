import type { WindowDeviation } from '../../../shared/types'
import { fmtPct, fmtPctPlain, fmtPrice } from '../../../shared/engine/format'

interface Props {
  window: 3 | 10 | 30
  data?: WindowDeviation
  historical?: boolean
  /** 当前价（实时模式）或当时收盘价（复盘模式），显示在百分比下方 */
  price?: number | null
}

export function DeviationCard({ window, data, historical = false, price }: Props): React.JSX.Element {
  const label = window === 3 ? '3 日偏离' : window === 10 ? '10 日偏离' : '30 日偏离'
  const kind = window === 3 ? '常规异动' : '严重异动'
  const utilization = data ? Math.min(1, Math.max(0, data.utilization)) : 0
  const danger = !!data?.triggered
  const near = !!data && data.utilization >= 0.8
  const tone = danger ? 'danger' : near ? 'warn' : window === 3 ? 'ordinary' : 'safe'
  const gap = data ? data.threshold - data.deviation : null

  return (
    <article className={`deviation-card ${tone}`}>
      <div className="deviation-head">
        <div>
          <div className="deviation-title">{label}</div>
          <div className={`deviation-kind ${window === 3 ? 'ordinary' : ''}`}>{kind}</div>
        </div>
        <div className={`deviation-chip ${danger ? 'danger' : near ? 'warn' : ''}`}>
          {data ? `${Math.max(0, data.utilization * 100).toFixed(0)}%` : '--'}
        </div>
      </div>

      <div className="deviation-value-row">
        <span className={`deviation-value ${data && data.deviation > 0 ? 'up' : data && data.deviation < 0 ? 'down' : ''}`}>
          {data ? fmtPct(data.deviation) : '--'}
        </span>
        <span className="deviation-threshold">阈值 {data ? fmtPctPlain(data.threshold) : '--'}</span>
      </div>

      <div className="deviation-prices">
        <span>{historical ? '当时价' : '现价'} ¥{price !== undefined && price !== null ? fmtPrice(price) : '--'}</span>
        <span>{historical ? '当时触发价' : '触发价'} ¥{data ? fmtPrice(data.triggerPrice) : '--'}</span>
      </div>

      <div className="progress-track" title={data ? `当前 ${fmtPct(data.deviation)} / 阈值 ${fmtPctPlain(data.threshold)}` : '数据不足'}>
        <span className={`progress-fill ${tone}`} style={{ width: `${utilization * 100}%` }} />
        {data && data.utilization > 1 && <span className="progress-over" />}
      </div>

      <div className="deviation-meta">
        <span>{danger ? '已触发' : gap !== null ? `还差 ${gap.toFixed(2)} 个百分点` : '数据不足'}</span>
      </div>

      {data && (
        <details className="calc-details">
          <summary>计算明细</summary>
          <div className="calc-grid">
            <span>窗口</span><strong>{data.startDate} → {data.endDate}</strong>
            <span>个股区间</span><strong className={data.stockReturn >= 0 ? 'up' : 'down'}>{fmtPct(data.stockReturn * 100)}</strong>
            <span>指数区间</span><strong className={data.indexReturn >= 0 ? 'up' : 'down'}>{fmtPct(data.indexReturn * 100)}</strong>
            <span>起始价</span><strong>{fmtPrice(data.baseStockPrice)}</strong>
            <span>指数起点</span><strong>{fmtPrice(data.baseIndexPrice)}</strong>
          </div>
        </details>
      )}
    </article>
  )
}
