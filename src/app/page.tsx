'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const GRID_SIZE = 60 // px per cell

function GridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: -1, y: -1 })
  const animRef = useRef<number>(0)
  const isDarkRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    isDarkRef.current = mq.matches
    const onScheme = (e: MediaQueryListEvent) => { isDarkRef.current = e.matches }
    mq.addEventListener('change', onScheme)

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      const dark = isDarkRef.current
      const lineRGB = dark ? '255, 255, 255' : '0, 0, 0'
      const lineAlpha = dark ? 0.04 : 0.06

      ctx.strokeStyle = `rgba(${lineRGB}, ${lineAlpha})`
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x <= w; x += GRID_SIZE) {
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, h)
      }
      for (let y = 0; y <= h; y += GRID_SIZE) {
        ctx.moveTo(0, y + 0.5)
        ctx.lineTo(w, y + 0.5)
      }
      ctx.stroke()

      // Hover highlight
      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      if (mx >= 0 && my >= 0) {
        const hoverCol = Math.floor(mx / GRID_SIZE)
        const hoverRow = Math.floor(my / GRID_SIZE)
        for (let dc = -2; dc <= 2; dc++) {
          for (let dr = -2; dr <= 2; dr++) {
            const dist = Math.sqrt(dc * dc + dr * dr)
            if (dist > 2.5) continue
            const base = dark ? 0.06 : 0.12
            const falloff = dark ? 0.025 : 0.05
            const alpha = dist === 0 ? base : (falloff / (dist * 1.2))
            ctx.fillStyle = `rgba(${lineRGB}, ${alpha})`
            ctx.fillRect(
              (hoverCol + dc) * GRID_SIZE,
              (hoverRow + dr) * GRID_SIZE,
              GRID_SIZE,
              GRID_SIZE
            )
          }
        }
      }

      animRef.current = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      mq.removeEventListener('change', onScheme)
      cancelAnimationFrame(animRef.current)
    }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    mouseRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = { x: -1, y: -1 }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-auto z-0"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  )
}

function useCountUp(target: number, duration: number = 1500) {
  const [value, setValue] = useState(0)
  const startTime = useRef<number | null>(null)

  useEffect(() => {
    let raf: number
    const animate = (ts: number) => {
      if (!startTime.current) startTime.current = ts
      const elapsed = ts - startTime.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.floor(eased * target))
      if (progress < 1) raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return value
}

function StatsBar() {
  const LEAD_BASE = 100000
  const APPT_BASE = 24380
  const LEASE_BASE = 1002

  const [leadExtra, setLeadExtra] = useState(0)
  const [leaseExtra, setLeaseExtra] = useState(0)

  const leadCount = useCountUp(LEAD_BASE, 1800)
  const apptCount = useCountUp(APPT_BASE, 1600)
  const leaseCount = useCountUp(LEASE_BASE, 1400)

  const [initialDone, setInitialDone] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setInitialDone(true), 2000)
    return () => clearTimeout(t)
  }, [])

  const leadTickStart = useRef<number>(0)
  useEffect(() => {
    if (!initialDone) return
    leadTickStart.current = Date.now()
    let timeout: NodeJS.Timeout
    const tick = () => {
      setLeadExtra(prev => prev + Math.floor(Math.random() * 3) + 1)
      const elapsed = (Date.now() - leadTickStart.current) / 1000
      const delay = Math.min(300 + elapsed * 300, 4000) + Math.random() * 500
      timeout = setTimeout(tick, delay)
    }
    timeout = setTimeout(tick, 300)
    return () => clearTimeout(timeout)
  }, [initialDone])

  useEffect(() => {
    if (!initialDone) return
    const leaseInterval = setInterval(() => {
      setLeaseExtra(prev => prev + 1)
    }, 8000 + Math.random() * 4000)
    return () => clearInterval(leaseInterval)
  }, [initialDone])

  const leads = initialDone ? LEAD_BASE + leadExtra : leadCount
  const leased = initialDone ? LEASE_BASE + leaseExtra : leaseCount

  return (
    <div className="max-w-2xl flex items-center justify-center gap-10 mt-10 text-xs text-black/40 dark:text-white/40 font-mono uppercase tracking-wider">
      <div className="flex flex-col items-start gap-1">
        <span className="text-2xl text-black/80 dark:text-white/80 font-semibold tabular-nums font-sans normal-case tracking-normal">{leads.toLocaleString()}</span>
        <span>Leads generated</span>
      </div>
      <div className="w-px h-8 bg-black/10 dark:bg-white/10" />
      <div className="flex flex-col items-start gap-1">
        <span className="text-2xl text-black/80 dark:text-white/80 font-semibold tabular-nums font-sans normal-case tracking-normal">{apptCount.toLocaleString()}+</span>
        <span>Appointments booked</span>
      </div>
      <div className="w-px h-8 bg-black/10 dark:bg-white/10" />
      <div className="flex flex-col items-start gap-1">
        <span className="text-2xl text-black/80 dark:text-white/80 font-semibold tabular-nums font-sans normal-case tracking-normal">{leased.toLocaleString()}+</span>
        <span>Units leased</span>
      </div>
    </div>
  )
}

const NAV_LINKS = ['Product', 'Enterprise', 'Pricing', 'News', 'Company', 'Docs']

export default function LandingPage() {
  const [address, setAddress] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const router = useRouter()
  const debounceRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    if (address.length < 3) { setSuggestions([]); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&countrycodes=us&limit=5&addressdetails=1`
        )
        const data = await res.json()
        setSuggestions(data)
        setShowSuggestions(true)
      } catch { setSuggestions([]) }
    }, 300)
  }, [address])

  const handleSelect = (item: any) => {
    const formatted = item.display_name
    setAddress(formatted)
    setShowSuggestions(false)
    localStorage.setItem('leasely_address', formatted)
    router.push('/dashboard')
  }

  const handleSearch = () => {
    if (address.trim()) {
      localStorage.setItem('leasely_address', address)
      router.push('/dashboard')
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] text-black dark:text-white relative overflow-hidden transition-colors">
      <GridBackground />

      {/* Top Nav */}
      <nav className="relative z-50 flex items-center justify-between px-8 py-5 max-w-[1600px] mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-sm bg-gradient-to-br from-[#3b82f6] to-[#60a5fa] flex items-center justify-center">
            <div className="w-2 h-2 bg-white rounded-full" />
          </div>
          <span className="text-lg font-bold tracking-tight uppercase">FastLease</span>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/dashboard"
            className="px-4 py-2 rounded-lg bg-[#3b82f6] text-white text-xs font-mono uppercase tracking-wider font-medium hover:bg-[#2563eb] transition"
          >
            Log In
          </a>
          <a
            href="/dashboard"
            className="px-4 py-2 rounded-lg border border-black/15 dark:border-white/20 bg-black/[0.02] dark:bg-white/[0.03] text-black dark:text-white text-xs font-mono uppercase tracking-wider font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition"
          >
            Dashboard
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-[1600px] mx-auto px-8 pt-20 pb-16">
        {/* Vision tag */}
        <div className="flex items-center gap-2 mb-10 text-xs font-mono uppercase tracking-widest text-black/60 dark:text-white/60">
          <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6]" />
          <span>Vision</span>
        </div>

        {/* Headline */}
        <h1 className="text-6xl md:text-7xl font-medium tracking-tight leading-[1.05] mb-10 max-w-4xl">
          CRE Leasing<br />on Autopilot
        </h1>

        {/* Subhead */}
        <p className="font-mono text-sm md:text-base text-black/60 dark:text-white/60 leading-relaxed max-w-2xl mb-12">
          CRE leasing, on autopilot.<br />
          From listing to signed lease — without changing your workflow.
        </p>

        {/* Search bar — styled like the download card */}
        <div className="max-w-2xl relative">
          <div className="rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2 flex items-center gap-2">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              placeholder="Enter a property address..."
              className="flex-1 px-4 py-3 text-sm font-mono outline-none bg-transparent placeholder:text-black/30 dark:placeholder:text-white/30 text-black dark:text-white"
            />
            <button
              onClick={handleSearch}
              className="px-5 py-3 rounded-lg bg-[#3b82f6] text-white text-xs font-mono uppercase tracking-wider font-medium hover:bg-[#2563eb] transition"
            >
              Search
            </button>
          </div>

          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-2 rounded-lg bg-white dark:bg-[#111] border border-black/10 dark:border-white/10 max-h-64 overflow-y-auto shadow-lg">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSelect(s)}
                  className="w-full text-left px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5 border-b border-black/5 dark:border-white/5 last:border-b-0 text-sm text-black/70 dark:text-white/70 font-mono"
                >
                  {s.display_name}
                </button>
              ))}
            </div>
          )}
        </div>

        <StatsBar />

        {/* Trusted by */}
        <div className="mt-24 flex items-center gap-6 text-xs font-mono uppercase tracking-widest text-black/40 dark:text-white/40">
          <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6]" />
          <span>Trusted by teams at</span>
        </div>
      </section>
    </div>
  )
}
