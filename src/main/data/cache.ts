import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

interface CacheEnvelope<T> {
  fetchedAt: number
  value: T
}

export class FileCache {
  private memory = new Map<string, CacheEnvelope<unknown>>()

  constructor(private readonly cacheDir: string) {}

  private pathFor(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_')
    return join(this.cacheDir, `${safe}.json`)
  }

  getMemory<T>(key: string): CacheEnvelope<T> | null {
    const hit = this.memory.get(key)
    return hit ? (hit as CacheEnvelope<T>) : null
  }

  async get<T>(key: string): Promise<CacheEnvelope<T> | null> {
    const memory = this.getMemory<T>(key)
    if (memory) return memory
    try {
      const raw = await fs.readFile(this.pathFor(key), 'utf8')
      const parsed = JSON.parse(raw) as CacheEnvelope<T>
      if (!parsed || typeof parsed.fetchedAt !== 'number') return null
      this.memory.set(key, parsed)
      return parsed
    } catch {
      return null
    }
  }

  async set<T>(key: string, value: T, fetchedAt = Date.now()): Promise<void> {
    const envelope: CacheEnvelope<T> = { fetchedAt, value }
    this.memory.set(key, envelope)
    try {
      const path = this.pathFor(key)
      await fs.mkdir(dirname(path), { recursive: true })
      const temp = `${path}.tmp`
      await fs.writeFile(temp, JSON.stringify(envelope), 'utf8')
      await fs.rm(path, { force: true })
      await fs.rename(temp, path)
    } catch {
      // Cache is best-effort; network data still works without it.
    }
  }

  async clear(): Promise<void> {
    this.memory.clear()
    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}
