'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark'
type ViewMode = 'grid' | 'list'

interface ThemeContextType {
  theme: Theme
  viewMode: ViewMode
  setTheme: (theme: Theme) => void
  setViewMode: (mode: ViewMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')
  const [viewMode, setViewModeState] = useState<ViewMode>('list')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem('gallery-theme') as Theme
    const savedViewMode = localStorage.getItem('gallery-view-mode') as ViewMode
    if (savedTheme) setThemeState(savedTheme)
    if (savedViewMode) setViewModeState(savedViewMode)
  }, [])

  useEffect(() => {
    if (mounted) {
      document.documentElement.classList.remove('light', 'dark')
      document.documentElement.classList.add(theme)
      document.documentElement.setAttribute('data-theme', theme)
      localStorage.setItem('gallery-theme', theme)
    }
  }, [theme, mounted])

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
  }

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode)
    localStorage.setItem('gallery-view-mode', mode)
  }

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  if (!mounted) {
    return null
  }

  return (
    <ThemeContext.Provider value={{ theme, viewMode, setTheme, setViewMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
