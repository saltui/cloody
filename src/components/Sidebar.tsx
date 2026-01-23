'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { useTheme } from '@/lib/theme'

export type FileCategory = 'all' | 'photos' | 'videos' | 'documents'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  storageUsed?: number
}

const categories = [
  { id: 'all' as FileCategory, label: '모든 파일', icon: 'home' },
  { id: 'photos' as FileCategory, label: '사진', icon: 'photo' },
  { id: 'videos' as FileCategory, label: '동영상', icon: 'video' },
  { id: 'documents' as FileCategory, label: '문서', icon: 'document' },
]

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export default function Sidebar({ isOpen, onClose, storageUsed = 0 }: SidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { user, logout } = useUser()
  const { theme, toggleTheme } = useTheme()

  const currentCategory = (searchParams.get('category') as FileCategory) || 'all'

  const handleCategoryClick = (category: FileCategory) => {
    const params = new URLSearchParams(searchParams.toString())
    if (category === 'all') {
      params.delete('category')
    } else {
      params.set('category', category)
    }
    // 폴더 파라미터 초기화 (카테고리 변경 시)
    params.delete('folder')

    const queryString = params.toString()
    router.push(`/drive${queryString ? `?${queryString}` : ''}`)
    onClose()
  }

  const handleLogout = async () => {
    await logout()
    router.push('/login')
  }

  const getIcon = (icon: string) => {
    switch (icon) {
      case 'home':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        )
      case 'photo':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )
      case 'video':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )
      case 'document':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )
      default:
        return null
    }
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 bottom-0 w-64 z-50
          transform transition-transform duration-300 ease-out
          lg:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{
          background: 'rgba(5, 5, 8, 0.95)',
          borderRight: '1px solid var(--glass-border)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)'
        }}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b" style={{ borderColor: 'var(--glass-border)' }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-gradient-subtle)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
                <svg className="w-4 h-4" style={{ color: 'var(--accent-tertiary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
              </div>
              <div>
                <h1 className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>Cloody</h1>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-3 overflow-y-auto">
            <p className="px-2.5 py-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
              파일
            </p>
            <div className="space-y-0.5 mt-1">
              {categories.map((category) => {
                const isActive = currentCategory === category.id
                return (
                  <button
                    key={category.id}
                    onClick={() => handleCategoryClick(category.id)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150"
                    style={{
                      background: isActive ? 'var(--accent-gradient-subtle)' : 'transparent',
                      color: isActive ? 'var(--accent-tertiary)' : 'var(--foreground-secondary)',
                    }}
                  >
                    <span style={{ opacity: isActive ? 1 : 0.7 }}>{getIcon(category.icon)}</span>
                    <span className="text-sm">{category.label}</span>
                  </button>
                )
              })}
            </div>

            <div className="divider my-3" />

            <p className="px-2.5 py-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
              설정
            </p>
            {/* Quick Actions */}
            <div className="space-y-0.5 mt-1">
              <button
                onClick={() => router.push('/settings')}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150"
                style={{ color: 'var(--foreground-secondary)' }}
              >
                <svg className="w-4 h-4" style={{ opacity: 0.7 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm">환경설정</span>
              </button>
            </div>
          </nav>

          {/* Footer */}
          <div className="p-3 border-t" style={{ borderColor: 'var(--glass-border)' }}>
            {/* Storage */}
            <div className="mb-3 p-2.5 rounded-lg" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              <div className="flex justify-between text-xs mb-1.5">
                <span style={{ color: 'var(--foreground-muted)' }}>저장공간</span>
                <span style={{ color: 'var(--foreground-secondary)' }}>{formatBytes(storageUsed)}</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${Math.min((storageUsed / (10 * 1024 * 1024 * 1024)) * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* User */}
            <div className="flex items-center gap-2.5 p-2 rounded-lg" style={{ background: 'var(--glass-bg)' }}>
              <div className="avatar avatar-sm">
                {user?.display_name?.[0] || user?.email?.[0] || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-xs truncate" style={{ color: 'var(--foreground)' }}>
                  {user?.display_name || '사용자'}
                </p>
                <p className="text-xs truncate" style={{ color: 'var(--foreground-muted)', fontSize: '10px' }}>
                  {user?.email}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-md transition-colors"
                style={{ color: 'var(--foreground-muted)' }}
                title="로그아웃"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
