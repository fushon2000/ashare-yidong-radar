import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

export interface TrendPoint {
  date: string
  d3: number
  d10: number
  d30: number
}

interface Props {
  points: TrendPoint[]
  historyDate?: string | null
  onSelectDate?: (date: string) => void
}

export function TrendChart({ points, historyDate, onSelectDate }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const pointsRef = useRef(points)
  const selectRef = useRef(onSelectDate)
  useEffect(() => { pointsRef.current = points }, [points])
  useEffect(() => { selectRef.current = onSelectDate }, [onSelectDate])

  useEffect(() => {
    if (!containerRef.current) return
    const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' })
    chartRef.current = chart
    chart.on('click', (params) => {
      const index = typeof params.dataIndex === 'number' ? params.dataIndex : -1
      const date = pointsRef.current[index]?.date
      if (date && selectRef.current) selectRef.current(date)
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const dates = points.map((point) => point.date.slice(5))
    const markLines: Array<Record<string, unknown>> = [
      { yAxis: 0, lineStyle: { color: '#c6c6c6', type: 'solid', width: 1 }, label: { show: false } },
      { yAxis: 20, lineStyle: { color: '#e0e0e0', type: 'dashed', width: 1 }, label: { show: false } },
      { yAxis: 30, lineStyle: { color: '#e0e0e0', type: 'dashed', width: 1 }, label: { show: false } },
      { yAxis: 100, lineStyle: { color: '#ffb3b8', type: 'dashed', width: 1 }, label: { show: false } },
      { yAxis: 200, lineStyle: { color: '#ffb3b8', type: 'dashed', width: 1 }, label: { show: false } }
    ]
    if (historyDate) {
      markLines.unshift({
        xAxis: historyDate.slice(5),
        lineStyle: { color: '#0f62fe', type: 'solid', width: 1 },
        label: { formatter: '复盘日', color: '#0f62fe', fontSize: 10 },
        silent: true
      })
    }

    chart.setOption({
      animationDuration: 200,
      grid: { left: 44, right: 16, top: 28, bottom: 24 },
      legend: { show: false },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#161616',
        borderWidth: 0,
        padding: [8, 10],
        textStyle: { color: '#f4f4f4', fontSize: 11 },
        axisPointer: { type: 'line', lineStyle: { color: '#8d8d8d', width: 1 } },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params as Array<{ axisValue: string; marker: string; seriesName: string; data: number }> : []
          if (list.length === 0) return ''
          const date = list[0].axisValue
          const lines = list.map((item) => `${item.marker}${item.seriesName}  <b>${Number(item.data).toFixed(2)}%</b>`)
          return [`<div style="margin-bottom:4px">${date}</div>`, ...lines].join('<br/>')
        }
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: dates,
        axisLine: { lineStyle: { color: '#e0e0e0' } },
        axisTick: { show: false },
        axisLabel: { color: '#8d8d8d', fontSize: 10, interval: Math.max(0, Math.floor(points.length / 8)) }
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#f4f4f4' } },
        axisLabel: { color: '#8d8d8d', fontSize: 10, formatter: '{value}%' }
      },
      series: [
        {
          name: '3日',
          type: 'line',
          data: points.map((point) => Number(point.d3.toFixed(2))),
          smooth: false,
          showSymbol: false,
          lineStyle: { width: 1, color: '#6f6f6f' },
          itemStyle: { color: '#6f6f6f' },
          markLine: { symbol: 'none', silent: true, data: markLines }
        },
        {
          name: '10日',
          type: 'line',
          data: points.map((point) => Number(point.d10.toFixed(2))),
          smooth: false,
          showSymbol: false,
          lineStyle: { width: 1.5, color: '#0f62fe' },
          itemStyle: { color: '#0f62fe' }
        },
        {
          name: '30日',
          type: 'line',
          data: points.map((point) => Number(point.d30.toFixed(2))),
          smooth: false,
          showSymbol: false,
          lineStyle: { width: 1.5, color: '#8a3ffc' },
          itemStyle: { color: '#8a3ffc' }
        }
      ]
    }, true)
  }, [points, historyDate])

  return (
    <div className="chart-wrap">
      {points.length === 0 && <div className="chart-empty">历史数据不足，暂无趋势</div>}
      <div ref={containerRef} className="chart-canvas" />
    </div>
  )
}
