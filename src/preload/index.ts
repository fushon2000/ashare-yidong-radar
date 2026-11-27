import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi } from '../shared/api'
import type {
  AppSettings,
  NotifyPayload,
  PersistedState,
  Quote,
  SearchHit,
  StockSnapshot
} from '../shared/types'

const api: AppApi = {
  market: {
    search: (query: string): Promise<SearchHit[]> => ipcRenderer.invoke('market:search', query),
    getSnapshot: (request: {
      code: string
      demo?: boolean
      forceRefresh?: boolean
      settings?: AppSettings
    }): Promise<StockSnapshot> => ipcRenderer.invoke('market:get-snapshot', request),
    getQuotes: (codes: string[]): Promise<Record<string, Quote>> =>
      ipcRenderer.invoke('market:get-quotes', codes),
    clearCache: (): Promise<boolean> => ipcRenderer.invoke('market:clear-cache')
  },
  state: {
    load: (): Promise<PersistedState> => ipcRenderer.invoke('state:load'),
    save: (state: PersistedState): Promise<PersistedState> =>
      ipcRenderer.invoke('state:save', state)
  },
  notify: {
    show: (payload: NotifyPayload): Promise<boolean> =>
      ipcRenderer.invoke('notify:show', payload)
  },
  app: {
    quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
    onSelectStock: (callback: (code: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, code: string): void => callback(code)
      ipcRenderer.on('app:select-stock', listener)
      return () => ipcRenderer.removeListener('app:select-stock', listener)
    },
    onRefresh: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('app:refresh', listener)
      return () => ipcRenderer.removeListener('app:refresh', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
