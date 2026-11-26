import type { HistoryReview } from '../../../shared/types'
import { fmtPct, fmtPrice } from '../../../shared/engine/format'
import { historySummary } from '../../../shared/engine/history'

interface Props {
  review: HistoryReview | null
  dates: string[]
  selectedDate: string | null
  onChange: (date: string) => void
  onBack: () => void
}

export function HistoryPanel({ review, dates, selectedDate, onChange, onBack }: Props): React.JSX.Element {
  return (
    <section className="panel history-panel">
      <div className="panel-head">
        <div>
          <h2 className="section-title">历史复盘 · 真实后续 5 日</h2>
          <p className="section-desc">选中过去某一天，看看当时偏离值，以及之后实际发生了什么。</p>
        </div>
        <div className="history-controls">
          <select
            className="date-select"
            value={selectedDate ?? ''}
            onChange={(event) => onChange(event.target.value)}
          >
            {[...dates].reverse().map((date) => <option key={date} value={date}>{date}</option>)}
          </select>
          <button className="ghost-button tiny" onClick={onBack}>返回实时</button>
        </div>
      </div>

      {!review && (
        <div className="history-empty">该日期历史数据不足，无法复盘。</div>
      )}

      {review && (
        <>
          <div className={`history-summary ${review.firstSevereDate ? 'hot' : 'calm'}`}>
            <strong>{historySummary(review)}</strong>
            <span>
              {review.future.length > 0
                ? `已展示 ${review.future.length} / 5 个后续交易日`
                : '后续交易日数据尚未产生'}
            </span>
          </div>

          <div className="history-table">
            <div className="history-head">
              <div>交易日</div>
              <div>个股收盘 / 涨幅</div>
              <div>指数收盘 / 涨幅</div>
              <div>10 日偏离</div>
              <div>30 日偏离</div>
              <div>状态</div>
            </div>
            {review.future.length === 0 && (
              <div className="history-row empty">
                <div>—</div><div>—</div><div>—</div><div>—</div><div>—</div><div>暂无后续数据</div>
              </div>
            )}
            {review.future.map((row) => (
              <div className="history-row" key={row.date}>
                <div className="history-date">T+{row.day} · {row.date}</div>
                <div>
                  <strong>{fmtPrice(row.stockClose)}</strong>
                  <span className={row.stockPct >= 0 ? 'up' : 'down'}>{fmtPct(row.stockPct)}</span>
                </div>
                <div>
                  <strong>{fmtPrice(row.indexClose)}</strong>
                  <span className={row.indexPct >= 0 ? 'up' : 'down'}>{fmtPct(row.indexPct)}</span>
                </div>
                <div className={row.triggered10 ? 'cell-danger' : ''}>
                  {fmtPct(row.deviation10)}
                  {row.triggered10 && <em>触发</em>}
                </div>
                <div className={row.triggered30 ? 'cell-danger' : ''}>
                  {fmtPct(row.deviation30)}
                  {row.triggered30 && <em>触发</em>}
                </div>
                <div>
                  {row.triggered10 || row.triggered30 ? (
                    <span className="status-tag danger">严重异动</span>
                  ) : row.triggered3 ? (
                    <span className="status-tag ordinary">常规异动</span>
                  ) : (
                    <span className="status-tag muted">未触发</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="forecast-footnote">
            <span>历史复盘只使用真实收盘数据，不包含假设路径。</span>
            <span>前复权数据可能因后续除权除息修订，和当时盘中看到的值略有差异。</span>
          </div>
        </>
      )}
    </section>
  )
}
