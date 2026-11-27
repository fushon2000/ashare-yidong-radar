import type { OutlookCell, OutlookDay, OutlookResult } from '../../../shared/types'
import { fmtPct, fmtPctPlain, fmtPrice, statusClass } from '../../../shared/engine/format'

interface Props {
  outlook: OutlookResult
  boardName: string
}

const MODE_LABEL: Record<string, string> = {
  step2: '触发当日起算，窗口重叠 1 个交易日',
  step3: '触发次一交易日起算，严格不重叠',
  rolling: '每个达标的三日窗口各计 1 次'
}

function SevereNeed({ cell, day }: { cell: OutlookCell; day: OutlookDay['day'] }): React.JSX.Element {
  if (cell.triggered) {
    return (
      <div className="need-cell">
        <span className="hit-label">{day === 0 ? '已触发' : '无需上涨即达标'}</span>
        <span className="need-sub"><span>该时点偏离 {fmtPct(cell.deviationAt)}</span></span>
      </div>
    )
  }
  if (cell.needUpPct === null) {
    return <div className="need-cell"><span className="impossible">数据不足</span></div>
  }
  return (
    <div className="need-cell">
      <div className="need-main">
        <span className="need-gain">{fmtPct(cell.needUpPct)}</span>
        {cell.limitUpsNeeded !== null && cell.limitUpsNeeded > 0 && (
          <span className="need-tag">约 {cell.limitUpsNeeded} 个涨停</span>
        )}
      </div>
      <div className="need-sub">
        <span>触发价 {fmtPrice(cell.targetPrice)}</span>
        <span className={cell.feasible ? 'ok' : 'warn'}>{cell.feasible ? '该时点可实现' : '超出该时点额度'}</span>
      </div>
    </div>
  )
}

function CountNeed({ day }: { day: OutlookDay }): React.JSX.Element {
  const cell = day.count
  if (cell.triggered) {
    return (
      <div className="need-cell">
        <span className="hit-label">已触发</span>
        <span className="need-sub"><span>已满 {cell.required} 次</span></span>
      </div>
    )
  }
  if (cell.needUpPct === null) {
    return (
      <div className="need-cell">
        <span className="impossible">该时点无法凑满</span>
        <span className="need-sub"><span>已发生 {cell.countAt} / {cell.required} 次</span></span>
      </div>
    )
  }
  return (
    <div className="need-cell">
      <div className="need-main">
        <span className="need-gain">{fmtPct(cell.needUpPct)}</span>
        {cell.limitUpsNeeded !== null && cell.limitUpsNeeded > 0 && (
          <span className="need-tag">约 {cell.limitUpsNeeded} 个涨停</span>
        )}
      </div>
      <div className="need-sub">
        <span>触发第 {cell.required} 次</span>
        <span className={cell.feasible ? 'ok' : 'warn'}>{cell.feasible ? '该时点可实现' : '超出该时点额度'}</span>
      </div>
    </div>
  )
}

export function OutlookTable({ outlook, boardName }: Props): React.JSX.Element {
  const { countState, days } = outlook
  const ratio = countState.required > 0
    ? Math.min(100, (countState.count / countState.required) * 100)
    : 0
  const modeLabel = MODE_LABEL[countState.mode] ?? countState.mode

  return (
    <section className="panel outlook-panel">
      <div className="panel-head">
        <div>
          <h2 className="section-title">当日 / 第二日 / 第三日 / 第四日 / 第五日 触发测算</h2>
          <p className="section-desc">
            「再涨」指相对现价、到该时点收盘累计还需上涨的幅度；基准指数未来按 0% 处理。
          </p>
        </div>
        <div className="forecast-legend">
          <span><i className="legend-dot d10" />10 日 +100%</span>
          <span><i className="legend-dot d30" />30 日 +200%</span>
          <span><i className="legend-dot count" />同向异动次数</span>
        </div>
      </div>

      <div className={`count-banner ${countState.triggered ? 'hot' : ''}`}>
        <div className="count-head">
          <span className="count-label">10 日内同向异动</span>
          <strong>{countState.count} / {countState.required}</strong>
          <span className="count-target">
            满 {countState.required} 次即构成严重异动（{boardName}）
          </span>
        </div>
        <div className="count-track">
          <span className={`count-fill ${countState.triggered ? 'hot' : ''}`} style={{ width: `${ratio}%` }} />
        </div>
        <div className="count-note">
          <span>计数窗口 {countState.windowStart ?? '--'} → {countState.windowEnd ?? '--'}</span>
          <span>计数口径：{modeLabel}</span>
          <span>只认连续 3 日偏离累计 ≥ {fmtPctPlain(countState.ordinary3)}%，不含换手率异动</span>
        </div>
        <div className="count-caveat">
          交易所未公开「4 次 / 3 次」的具体计数算法，此处按实盘公告反推，可能与其认定不一致。
        </div>
      </div>

      <div className="outlook-table">
        <div className="outlook-head">
          <div>时点</div>
          <div>10 日偏离</div>
          <div>再涨 → 10 日 +100%</div>
          <div>30 日偏离</div>
          <div>再涨 → 30 日 +200%</div>
          <div>再涨 → 第 {countState.required} 次同向异动</div>
        </div>
        {days.map((day) => {
          const ten = day.severe.find((cell) => cell.window === 10)
          const thirty = day.severe.find((cell) => cell.window === 30)
          return (
            <div className="outlook-row" key={day.day}>
              <div className="outlook-when">
                <strong>{day.label}</strong>
                <span>{day.date ?? '收盘日期未知'}</span>
                <em>额度 {fmtPctPlain(day.budgetPct)}</em>
              </div>
              <div className="outlook-dev">
                <strong className={ten ? statusClass(ten.deviationAt) : ''}>
                  {ten ? fmtPct(ten.deviationAt) : '--'}
                </strong>
                <span>{day.day === 0 ? '当前水平' : '窗口滚动后'}</span>
              </div>
              <div className="outlook-need">
                {ten ? <SevereNeed cell={ten} day={day.day} /> : <span className="impossible">数据不足</span>}
              </div>
              <div className="outlook-dev">
                <strong className={thirty ? statusClass(thirty.deviationAt) : ''}>
                  {thirty ? fmtPct(thirty.deviationAt) : '--'}
                </strong>
                <span>{day.day === 0 ? '当前水平' : '窗口滚动后'}</span>
              </div>
              <div className="outlook-need">
                {thirty ? <SevereNeed cell={thirty} day={day.day} /> : <span className="impossible">数据不足</span>}
              </div>
              <div className="outlook-need">
                <CountNeed day={day} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="forecast-footnote">
        <span>「再涨」不是「阈值 − 当前偏离值」：再涨的百分比乘在已膨胀的基期上。</span>
        <span>到第二日、第三日、第四日、第五日，最早的交易日会滑出窗口，所需涨幅可能变大也可能变小。</span>
        <span>「额度」是该时点的涨跌幅上限；超出即该时点无法实现，但仍给出所需幅度供参考。</span>
        <span>次数型前推假设剩余交易日涨幅均匀分配。</span>
      </div>
    </section>
  )
}
