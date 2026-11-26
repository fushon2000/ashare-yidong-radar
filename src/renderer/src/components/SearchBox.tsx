import { useEffect, useRef, useState } from 'react'
import type { SearchHit } from '../../../shared/types'
import { boardLabel, inferBoard, marketForBoard } from '../../../shared/engine/rules'
import { useApp } from '../store/AppStore'
import { SearchIcon } from './Icons'

export function SearchBox(): React.JSX.Element {
  const { addStock, toast } = useApp()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      void window.api.market.search(trimmed)
        .then((hits) => {
          if (cancelled) return
          setResults(hits)
          setActive(0)
          setOpen(true)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const select = (hit: SearchHit): void => {
    addStock(hit)
    setQuery('')
    setResults([])
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (!open || results.length === 0) {
      if (event.key === 'Enter' && query.trim()) {
        const code = query.trim()
        const board = /^\d{6}$/.test(code) ? inferBoard(code) : null
        const hit: SearchHit | null = board
          ? {
              code,
              name: code,
              board,
              market: marketForBoard(board),
              isST: false
            }
          : null
        if (hit) select(hit)
        else toast('没有找到匹配的股票', 'info')
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => Math.min(results.length - 1, current + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(0, current - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = results[active]
      if (hit) select(hit)
    }
  }

  return (
    <div className="search-wrap" ref={wrapRef}>
      <SearchIcon className="search-icon" size={17} />
      <input
        ref={inputRef}
        className="search-input"
        value={query}
        placeholder="搜索代码 / 名称 / 拼音，按 / 聚焦"
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true) }}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
      {query && (
        <button
          className="search-clear"
          onClick={() => { setQuery(''); setResults([]); setOpen(false); inputRef.current?.focus() }}
          aria-label="清空搜索"
        >
          ×
        </button>
      )}
      {open && (query.trim().length > 0) && (
        <div className="search-results">
          {loading && <div className="search-empty">正在搜索…</div>}
          {!loading && results.length === 0 && (
            <div className="search-empty">没有找到 A 股股票</div>
          )}
          {!loading && results.map((hit, index) => (
            <button
              key={`${hit.code}-${index}`}
              className={`search-result ${index === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => select(hit)}
            >
              <span className="search-result-main">
                <strong>{hit.name}</strong>
                <span>{hit.code}</span>
              </span>
              <span className="search-result-tags">
                {hit.isST && <em className="tag tag-st">ST</em>}
                <em className="tag">{boardLabel(hit.board)}</em>
              </span>
            </button>
          ))}
          <div className="search-hint">仅支持沪深主板、创业板、科创板</div>
        </div>
      )}
    </div>
  )
}
