'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

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

export default function LandingPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = () => {
    if (email.trim()) setSubmitted(true)
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
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-[1600px] mx-auto px-8 pt-20 pb-16">
        {/* Headline */}
        <h1 className="text-6xl md:text-7xl font-medium tracking-tight leading-[1.05] mb-10 max-w-4xl">
          CRE Leasing<br />on Autopilot
        </h1>

        {/* Subhead */}
        <p className="font-mono text-sm md:text-base text-black/60 dark:text-white/60 leading-relaxed max-w-2xl mb-12">
          CRE leasing, on autopilot.<br />
          From listing to signed lease — all in one place.
        </p>

        {/* Waitlist bar */}
        <div className="max-w-2xl">
          {submitted ? (
            <div className="rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2 flex items-center gap-3 px-5 py-4">
              <svg className="w-4 h-4 text-[#3b82f6] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm font-mono text-black/60 dark:text-white/60">You&apos;re on the list. We&apos;ll be in touch.</span>
            </div>
          ) : (
            <div className="rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2 flex items-center gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="Enter your email to join the waitlist..."
                className="flex-1 px-3 py-3 text-sm font-mono outline-none bg-transparent placeholder:text-black/30 dark:placeholder:text-white/30 text-black dark:text-white"
              />
              <button
                onClick={handleSubmit}
                className="px-5 py-3 rounded-lg bg-[#3b82f6] text-white text-xs font-mono uppercase tracking-wider font-medium hover:bg-[#2563eb] transition"
              >
                Join Waitlist
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
