import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { PersistedState } from '../shared/types'
import { DEFAULT_SETTINGS, DEFAULT_STATE } from '../shared/types'
import { isSupportedCode } from '../shared/engine/rules'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeState(input: Partial<PersistedState> | null): PersistedState {
  const base = clone(DEFAULT_STATE)
  if (!input || typeof input !== 'object') return base
  const groups = Array.isArray(input.groups) && input.groups.length > 0
    ? input.groups
        .filter((group) => group && typeof group.id === 'string' && typeof group.name === 'string')
        .map((group, index) => ({
          id: group.id,
          name: group.name,
          order: Number.isFinite(group.order) ? group.order : index
        }))
    : base.groups
  const groupIds = new Set(groups.map((group) => group.id))
  const stocks = Array.isArray(input.stocks)
    ? input.stocks
        .filter((stock) =>
          stock &&
          typeof stock.code === 'string' &&
          isSupportedCode(stock.code) &&
          groupIds.has(stock.groupId)
        )
        .map((stock, index) => ({
          code: stock.code,
          name: typeof stock.name === 'string' ? stock.name : stock.code,
          groupId: stock.groupId,
          order: Number.isFinite(stock.order) ? stock.order : index,
          note: typeof stock.note === 'string' ? stock.note : undefined
        }))
    : []
  const settings = {
    ...base.settings,
    ...(input.settings ?? {}),
    thresholds: {
      ...DEFAULT_SETTINGS.thresholds,
      ...(input.settings?.thresholds ?? {})
    }
  }
  return {
    version: 1,
    groups: groups.sort((a, b) => a.order - b.order),
    stocks,
    selectedCode: typeof input.selectedCode === 'string' ? input.selectedCode : null,
    settings
  }
}

export class StateStore {
  private state: PersistedState = clone(DEFAULT_STATE)

  constructor(private readonly filePath: string) {}

  async load(): Promise<PersistedState> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      this.state = normalizeState(JSON.parse(raw) as Partial<PersistedState>)
    } catch {
      try {
        const backup = await fs.readFile(`${this.filePath}.bak`, 'utf8')
        this.state = normalizeState(JSON.parse(backup) as Partial<PersistedState>)
      } catch {
        this.state = clone(DEFAULT_STATE)
      }
    }
    return this.get()
  }

  get(): PersistedState {
    return clone(this.state)
  }

  async save(next: PersistedState): Promise<PersistedState> {
    this.state = normalizeState(next)
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    const body = JSON.stringify(this.state, null, 2)
    await fs.writeFile(temp, body, 'utf8')
    try {
      await fs.copyFile(this.filePath, `${this.filePath}.bak`)
    } catch {
      // first save
    }
    await fs.rm(this.filePath, { force: true })
    await fs.rename(temp, this.filePath)
    return this.get()
  }
}
