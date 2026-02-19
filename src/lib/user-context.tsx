'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'

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
  const fetchInFlightRef = useRef<Promise<void> | null>(null)

  const isAuthPath = useCallback((pathname: string) => {
    return pathname === '/login'
      || pathname === '/'
      || pathname.startsWith('/share')
      || pathname.startsWith('/magic-link')
      || pathname.startsWith('/verify-email')
  }, [])

  const fetchUser = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (fetchInFlightRef.current) {
      return fetchInFlightRef.current
    }

    const requestPromise = (async () => {
      if (!background) {
        setIsLoading(true)
      }

      try {
        const res = await fetch('/api/auth/me', {
          cache: 'no-store',
          credentials: 'include',
        })

        if (res.ok) {
          const data = await res.json()
          setUser(data.user)
          setError(null)
          return
        }

        if (res.status === 401) {
          setUser(null)
          if (!isAuthPath(window.location.pathname)) {
            try {
              await fetch('/api/auth/logout', { method: 'POST' })
            } catch {
              // 로그아웃 API 실패 시에도 클라이언트 리다이렉트는 진행
            }
            window.location.href = '/login'
          }
          return
        }

        setError('세션 확인에 실패했습니다. 잠시 후 다시 시도해주세요.')
      } catch {
        // 일시적인 네트워크 오류로 로그인 상태를 강제로 해제하지 않음
        setError('네트워크 상태를 확인해주세요. 세션은 유지됩니다.')
      } finally {
        if (!background) {
          setIsLoading(false)
        }
        fetchInFlightRef.current = null
      }
    })()

    fetchInFlightRef.current = requestPromise
    return requestPromise
  }, [isAuthPath])

  useEffect(() => {
    void fetchUser()
  }, [fetchUser])

  useEffect(() => {
    if (isAuthPath(window.location.pathname) && !user) {
      return
    }

    const syncSession = () => {
      if (document.visibilityState === 'visible') {
        void fetchUser({ background: true })
      }
    }

    const intervalId = window.setInterval(syncSession, 3 * 60 * 1000)
    window.addEventListener('focus', syncSession)
    document.addEventListener('visibilitychange', syncSession)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', syncSession)
      document.removeEventListener('visibilitychange', syncSession)
    }
  }, [fetchUser, isAuthPath, user])

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
    await fetchUser({ background: true })
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
