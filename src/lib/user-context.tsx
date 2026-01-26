'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

export interface User {
  id: string
  email: string
  email_verified: boolean
  display_name: string | null
  avatar_url: string | null
  wallet_address: string | null
  totp_enabled: boolean
  is_admin: boolean
}

interface UserContextType {
  user: User | null
  isLoading: boolean
  error: string | null
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  updateUser: (updates: Partial<User>) => void
}

const UserContext = createContext<UserContextType | null>(null)

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        setError(null)
      } else if (res.status === 401) {
        setUser(null)
        // 이미 로그인 페이지면 리다이렉트 불필요
        const isAuthPage = window.location.pathname === '/login'
          || window.location.pathname === '/'
          || window.location.pathname.startsWith('/share')
          || window.location.pathname.startsWith('/magic-link')
          || window.location.pathname.startsWith('/verify-email')
        if (!isAuthPage) {
          // 세션 만료 시 로그아웃 API 호출하여 쿠키 삭제 후 로그인 페이지로 이동
          await fetch('/api/auth/logout', { method: 'POST' })
          window.location.href = '/login'
        }
        return
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
      setError('사용자 정보를 불러올 수 없습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      setUser(null)
      window.location.href = '/login'
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }, [])

  const refreshUser = useCallback(async () => {
    setIsLoading(true)
    await fetchUser()
  }, [fetchUser])

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...updates } : null)
  }, [])

  return (
    <UserContext.Provider value={{ user, isLoading, error, logout, refreshUser, updateUser }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const context = useContext(UserContext)
  if (!context) {
    throw new Error('useUser must be used within UserProvider')
  }
  return context
}
