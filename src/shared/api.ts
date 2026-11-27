import type {
  AppSettings,
  NotifyPayload,
  PersistedState,
  Quote,
  SearchHit,
  StockSnapshot
} from './types'

export interface SnapshotRequest {
  code: string
  demo?: boolean
  forceRefresh?: boolean
  settings?: AppSettings
}

export interface AppApi {
  market: {
    search(query: string): Promise<SearchHit[]>
    getSnapshot(request: SnapshotRequest): Promise<StockSnapshot>
    getQuotes(codes: string[]): Promise<Record<string, Quote>>
    clearCache(): Promise<boolean>
  }
  state: {
    load(): Promise<PersistedState>
    save(state: PersistedState): Promise<PersistedState>
  }
  notify: {
    show(payload: NotifyPayload): Promise<boolean>
  }
  app: {
    quit(): Promise<void>
    onSelectStock(callback: (code: string) => void): () => void
    onRefresh(callback: () => void): () => void
  }
}
