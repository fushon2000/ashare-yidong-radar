// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { AppProvider } from '../store/AppStore'
import App from '../App'
import { makeDemoSnapshot } from '../../../shared/engine/demo'
import { DEFAULT_SETTINGS, DEFAULT_STATE } from '../../../shared/types'

vi.mock('echarts', () => ({
  init: () => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn()
  })
}))

class ResizeObserverMock {
  observe(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  const settings = { ...DEFAULT_SETTINGS, refreshMs: 60000 }
  const state = {
    ...DEFAULT_STATE,
    settings,
    stocks: []
  }
  const api = {
    market: {
      search: vi.fn(async () => []),
      getSnapshot: vi.fn(async (request: { code: string; demo?: boolean; settings?: typeof settings }) => {
        if (!request.demo) throw new Error('offline')
        const snapshot = makeDemoSnapshot(request.code, request.settings ?? settings)
        if (!snapshot) throw new Error('no demo')
        return snapshot
      }),
      getQuotes: vi.fn(async () => ({})),
      clearCache: vi.fn(async () => true)
    },
    state: {
      load: vi.fn(async () => state),
      save: vi.fn(async (next: typeof state) => next)
    },
    notify: {
      show: vi.fn(async () => true)
    },
    app: {
      quit: vi.fn(async () => undefined),
      onSelectStock: vi.fn(() => () => undefined),
      onRefresh: vi.fn(() => () => undefined)
    }
  }
  ;(window as unknown as { api: typeof api }).api = api
})

describe('app shell', () => {
  it('renders the empty state and loads demo data', async () => {
    render(
      <React.StrictMode>
        <AppProvider>
          <App />
        </AppProvider>
      </React.StrictMode>
    )

    expect(await screen.findByText('还没有关注股票')).toBeTruthy()
    const demoButtons = screen.getAllByText(/演示数据/)
    fireEvent.click(demoButtons[0])

    await waitFor(() => {
      expect(screen.getAllByText('贵州茅台').length).toBeGreaterThan(0)
    }, { timeout: 5000 })
    expect(screen.getAllByText('10 日偏离').length).toBeGreaterThan(0)
    expect(screen.getAllByText('当日 / 第二日 / 第三日 / 第四日 / 第五日 触发测算').length).toBeGreaterThan(0)
    expect(screen.getAllByText('10 日内同向异动').length).toBeGreaterThan(0)
    expect(screen.getByText('盘中拖动模拟')).toBeTruthy()
  })

  it('switches to simulation when the today slider moves', async () => {
    render(
      <React.StrictMode>
        <AppProvider>
          <App />
        </AppProvider>
      </React.StrictMode>
    )
    const demoButtons = await screen.findAllByText(/演示数据/)
    fireEvent.click(demoButtons[0])
    await screen.findAllByText('贵州茅台', undefined, { timeout: 5000 })
    const sliders = document.querySelectorAll<HTMLInputElement>('input[type="range"]')
    expect(sliders.length).toBeGreaterThan(0)
    fireEvent.change(sliders[0], { target: { value: '5' } })
    await waitFor(() => {
      expect(screen.getAllByText('模拟中').length).toBeGreaterThan(0)
    })
  })
})
