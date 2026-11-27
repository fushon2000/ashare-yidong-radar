import { app, BrowserWindow, ipcMain } from 'electron'
import type {
  AppSettings,
  NotifyPayload,
  PersistedState
} from '../shared/types'
import type { MarketDataProvider } from './data/provider'
import type { StateStore } from './store'
import { showNotification } from './notifications'

interface IpcContext {
  getWindow: () => BrowserWindow | null
  provider: MarketDataProvider
  store: StateStore
}

export function registerIpc(context: IpcContext): void {
  const { provider, store } = context

  ipcMain.handle('market:search', async (_event, query: string) => {
    if (typeof query !== 'string') return []
    return provider.search(query.slice(0, 40))
  })

  ipcMain.handle('market:get-snapshot', async (_event, request: {
    code: string
    demo?: boolean
    forceRefresh?: boolean
    settings?: AppSettings
  }) => {
    if (!request || typeof request.code !== 'string') {
      throw new Error('股票代码无效')
    }
    const settings = request.settings ?? store.get().settings
    return provider.getSnapshot(request.code, {
      settings,
      demo: !!request.demo,
      forceRefresh: !!request.forceRefresh
    })
  })

  ipcMain.handle('market:get-quotes', async (_event, codes: string[]) => {
    if (!Array.isArray(codes)) return {}
    return provider.getQuotes(codes.filter((code) => typeof code === 'string').slice(0, 120))
  })

  ipcMain.handle('market:clear-cache', async () => {
    await provider.clearCache()
    return true
  })

  ipcMain.handle('state:load', async () => store.load())
  ipcMain.handle('state:save', async (_event, state: PersistedState) => store.save(state))

  ipcMain.handle('notify:show', async (_event, payload: NotifyPayload) => {
    if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string') {
      return false
    }
    return showNotification({
      title: payload.title.slice(0, 80),
      body: payload.body.slice(0, 300),
      code: typeof payload.code === 'string' ? payload.code : undefined
    })
  })

  ipcMain.handle('app:quit', async () => {
    app.quit()
  })
}
