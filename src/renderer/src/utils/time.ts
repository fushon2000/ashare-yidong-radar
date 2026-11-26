import { useEffect, useState } from 'react'

export interface MarketStatus {
  label: string
  tone: 'open' | 'closed' | 'break' | 'pre'
}

export function marketStatus(): MarketStatus {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date())
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  if (weekday === 'Sat' || weekday === 'Sun') return { label: '休市', tone: 'closed' }
  const minutes = hour * 60 + minute
  if (minutes < 9 * 60 + 15) return { label: '未开盘', tone: 'pre' }
  if (minutes < 9 * 60 + 25) return { label: '集合竞价', tone: 'pre' }
  if (minutes < 9 * 60 + 30) return { label: '等待开盘', tone: 'pre' }
  if (minutes < 11 * 60 + 30) return { label: '交易中', tone: 'open' }
  if (minutes < 13 * 60) return { label: '午间休市', tone: 'break' }
  if (minutes < 15 * 60) return { label: '交易中', tone: 'open' }
  return { label: '已收盘', tone: 'closed' }
}

export function useNow(intervalMs = 30000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
