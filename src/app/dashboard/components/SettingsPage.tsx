'use client'

import { useState, useEffect } from 'react'

interface SettingsPageProps {
  open: boolean
  onClose: () => void
}

export default function SettingsPage({ open, onClose }: SettingsPageProps) {
  const [darkMode, setDarkMode] = useState(false)

  useEffect(() => {
    setDarkMode(document.documentElement.classList.contains('dark'))
  }, [open])

  const toggleDark = () => {
    const next = !darkMode
    setDarkMode(next)
    if (next) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('fastlease-theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('fastlease-theme', 'light')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 w-full max-w-sm mx-4 p-6 shadow-lg" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold dark:text-zinc-50">Settings</h2>
          <button onClick={onClose} className="text-2xl text-gray-500 dark:text-zinc-400 hover:text-black dark:hover:text-white">&times;</button>
        </div>

        {/* Dark mode toggle */}
        <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-zinc-700">
          <span className="text-sm font-medium dark:text-zinc-200">Dark mode</span>
          <button
            onClick={toggleDark}
            className={`relative w-12 h-7 rounded-full transition-colors ${darkMode ? 'bg-green-500' : 'bg-gray-300 dark:bg-zinc-600'}`}
            style={{ borderRadius: '9999px' }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-6 h-6 bg-white shadow transition-transform"
              style={{
                borderRadius: '9999px',
                transform: darkMode ? 'translateX(20px)' : 'translateX(0)',
              }}
            />
          </button>
        </div>

        <p className="mt-4 text-xs text-gray-400 dark:text-zinc-500">More settings coming soon.</p>
      </div>
    </div>
  )
}
