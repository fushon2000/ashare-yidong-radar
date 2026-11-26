import type {
  HistoryFutureRow,
  HistoryReview,
  ThresholdSet
} from '../types'
import type { AlignedRow } from './series'
import { computeAllWindows, lastWindow } from './series'

export function selectableHistoryDates(series: AlignedRow[], limit = 60): string[] {
  return series.slice(-limit).map((row) => row.date)
}

export function reviewHistory(
  series: AlignedRow[],
  thresholds: ThresholdSet,
  date: string
): HistoryReview | null {
  const index = series.findIndex((row) => row.date === date)
  if (index < 0) return null

  const prefix = series.slice(0, index + 1)
  const deviations = computeAllWindows(prefix, thresholds)
  const futureRows = series.slice(index + 1, index + 6)
  const future: HistoryFutureRow[] = []
  let firstSevereDate: string | null = null
  let firstSevereWindow: 10 | 30 | null = null

  for (let i = 0; i < futureRows.length; i++) {
    const row = futureRows[i]
    const through = series.slice(0, index + 1 + i + 1)
    const windows = computeAllWindows(through, thresholds)
    const ten = lastWindow(windows, 10)
    const thirty = lastWindow(windows, 30)
    const three = lastWindow(windows, 3)
    if (!ten || !thirty) continue
    const triggered10 = ten.triggered
    const triggered30 = thirty.triggered
    const triggered3 = !!three?.triggered
    if (!firstSevereDate && (triggered10 || triggered30)) {
      firstSevereDate = row.date
      firstSevereWindow = triggered10 ? 10 : 30
    }
    future.push({
      day: i + 1,
      date: row.date,
      stockClose: row.stockClose,
      indexClose: row.indexClose,
      stockPct: row.stockPct * 100,
      indexPct: row.indexPct * 100,
      deviation10: ten.deviation,
      deviation30: thirty.deviation,
      triggered10,
      triggered30,
      triggered3
    })
  }

  return {
    date,
    deviations,
    future,
    firstSevereDate,
    firstSevereWindow,
    complete: futureRows.length >= 5
  }
}

export function historySummary(review: HistoryReview): string {
  if (!review.complete) {
    return review.future.length === 0
      ? '后续暂无交易日数据，无法复盘'
      : `仅有 ${review.future.length} 个后续交易日数据，复盘不完整`
  }
  if (review.firstSevereDate) {
    return `实际于 ${review.firstSevereDate} 首次触发 ${review.firstSevereWindow} 日严重异动`
  }
  return '后续 5 个交易日未触发 10 日 / 30 日严重异动'
}
