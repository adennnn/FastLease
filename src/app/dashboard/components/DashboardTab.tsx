'use client'

import { useState, useEffect } from 'react'

function CircleChart({ value, max, color, size = 100, stroke = 8 }: { value: number; max: number; color: string; size?: number; stroke?: number }) {
  const [animated, setAnimated] = useState(false)
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  useEffect(() => {
    // Small delay so the initial render shows empty, then animates
    const t = setTimeout(() => setAnimated(true), 100)
    return () => clearTimeout(t)
  }, [])

  // If value is 0: animate a full spin then settle to empty
  // Otherwise: animate from empty to the correct position
  const target = max > 0 && value > 0 ? (value / max) * circumference : 0
  const offset = animated ? circumference - target : circumference

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-gray-200 dark:text-zinc-800" />
      {/* Animated progress arc */}
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)' }}
      />
      {/* Zero-value sweep: grows from empty to full, then fades out */}
      {value === 0 && (
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={animated ? 0 : circumference}
          strokeLinecap="round"
          style={{
            transition: 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease 1s',
            opacity: animated ? 0 : 0.5,
          }}
        />
      )}
    </svg>
  )
}

function AnimatedNumber({ value, duration = 1200 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (value === 0) return
    const start = performance.now()
    const tick = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(eased * value))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [value, duration])

  return <>{display}</>
}

const cards = [
  { label: 'SMS', sublabel: 'Texts Sent', value: 0, max: 50, color: '#10b981' },
  { label: 'Email', sublabel: 'Emails Sent', value: 0, max: 50, color: '#6366f1' },
  { label: 'Phone', sublabel: 'Cold Calls Made', value: 0, max: 50, color: '#f59e0b' },
]

const columns = ['Name', 'Email', 'Phone Number', 'Business Type', 'Status', 'Date']

export default function DashboardTab() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="text-3xl font-extrabold tracking-tight mb-1 dark:text-zinc-50">Dashboard</h1>
      <p className="text-sm text-gray-500 dark:text-zinc-500 mb-8">Outreach overview</p>

      {/* Three cards */}
      <div className="grid grid-cols-3 gap-5 mb-8">
        {cards.map((card, i) => (
          <div
            key={card.label}
            className="border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 flex flex-col items-center opacity-0 animate-[fadeSlideUp_0.5s_ease-out_forwards]"
            style={{ animationDelay: `${i * 120}ms` }}
          >
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-1">{card.label}</h2>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mb-4">{card.sublabel}</p>
            <div className="relative">
              <CircleChart value={card.value} max={card.max} color={card.color} size={100} stroke={8} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-extrabold dark:text-zinc-50">
                  <AnimatedNumber value={card.value} />
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Spreadsheet-style table */}
      <div className="border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden opacity-0 animate-[fadeSlideUp_0.5s_ease-out_0.4s_forwards]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-zinc-800">
              {columns.map(col => (
                <th key={col} className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 bg-gray-50 dark:bg-zinc-900/80">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-gray-100 dark:border-zinc-800/60">
                {columns.map(col => (
                  <td key={col} className="px-5 py-3.5">&nbsp;</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
