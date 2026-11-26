import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import type {
  AppSettings,
  FileResult,
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
  const { getWindow, provider, store } = context

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

  ipcMain.handle('csv:export', async (_event, content: string, filename: string): Promise<FileResult> => {
    const window = getWindow()
    if (!window) return { canceled: true }
    const result = await dialog.showSaveDialog(window, {
      title: '导出关注池',
      defaultPath: filename,
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    await fs.writeFile(result.filePath, content, 'utf8')
    return { canceled: false, path: result.filePath }
  })

  ipcMain.handle('csv:import', async (): Promise<FileResult> => {
    const window = getWindow()
    if (!window) return { canceled: true }
    const result = await dialog.showOpenDialog(window, {
      title: '导入关注池',
      properties: ['openFile'],
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return { canceled: true }
    const content = await fs.readFile(path, 'utf8')
    return { canceled: false, path, content }
  })

  ipcMain.handle('app:quit', async () => {
    app.quit()
  })
}
