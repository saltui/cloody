'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme'
import { useUser } from '@/lib/user-context'

type SettingsTab = 'profile' | 'account' | 'security' | 'preferences'

interface TwoFASetup {
  enabled: boolean
  secret?: string
  qrCode?: string
}

export default function SettingsPage() {
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()
  const { user, logout, updateUser } = useUser()

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // 프로필 상태
  const [displayName, setDisplayName] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 2FA 상태
  const [twoFASetup, setTwoFASetup] = useState<TwoFASetup | null>(null)
  const [totpCode, setTotpCode] = useState('')

  // 스토리지 사용량
  const [storageUsed, setStorageUsed] = useState<number>(0)

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || '')
      setAvatarPreview(user.avatar_url)
    }
  }, [user])

  useEffect(() => {
    // 스토리지 사용량 가져오기
    fetch('/api/storage')
      .then(res => res.json())
      .then(data => setStorageUsed(data.usage || 0))
      .catch(() => {})

    // 2FA 상태 가져오기
    fetch('/api/2fa/setup')
      .then(res => res.json())
      .then(data => setTwoFASetup(data))
      .catch(() => {})
  }, [])

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // 프로필 업데이트
  const handleProfileUpdate = async () => {
    setIsLoading(true)
    setError('')
    setMessage('')

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '업데이트에 실패했습니다.')
      }

      updateUser({ display_name: displayName })
      setMessage('프로필이 업데이트되었습니다.')
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  // 아바타 변경
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setAvatarFile(file)
      setAvatarPreview(URL.createObjectURL(file))
    }
  }

  // 2FA 코드 확인
  const handle2FAVerify = async () => {
    if (totpCode.length !== 6) return

    setIsLoading(true)
    setError('')

    try {
      const res = await fetch('/api/2fa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpCode }),
      })

      const data = await res.json()

      if (data.success) {
        setMessage('2FA 인증이 확인되었습니다.')
        setTotpCode('')
      } else {
        setError(data.error || '잘못된 코드입니다.')
        setTotpCode('')
      }
    } catch {
      setError('확인에 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  const tabs = [
    { id: 'profile' as const, label: '프로필', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    )},
    { id: 'account' as const, label: '계정', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    )},
    { id: 'security' as const, label: '보안', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    )},
    { id: 'preferences' as const, label: '환경설정', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )},
  ]

  return (
    <main className="min-h-screen safe-area-top safe-area-bottom" style={{ background: 'var(--background)' }}>
      {/* 헤더 */}
      <header className="header">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sm:gap-4">
          <button
            onClick={() => router.back()}
            className="btn btn-ghost !p-2"
          >
            <svg className="w-5 h-5" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg sm:text-xl font-semibold">설정</h1>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <div className="flex flex-col md:flex-row gap-4 sm:gap-8">
          {/* 사이드바 탭 */}
          <nav className="md:w-48 flex-shrink-0">
            <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl whitespace-nowrap transition-all text-sm sm:text-base ${
                    activeTab === tab.id
                      ? 'text-white'
                      : ''
                  }`}
                  style={activeTab === tab.id ? {
                    background: 'var(--accent-gradient)',
                  } : {
                    color: 'var(--foreground-secondary)',
                  }}
                >
                  {tab.icon}
                  <span className="font-medium">{tab.label}</span>
                </button>
              ))}
            </div>
          </nav>

          {/* 메인 콘텐츠 */}
          <div className="flex-1 space-y-4 sm:space-y-6">
            {/* 메시지 표시 */}
            {message && (
              <div className="p-3 sm:p-4 rounded-xl animate-fade-in" style={{ background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                <p className="text-sm text-green-500">{message}</p>
              </div>
            )}
            {error && (
              <div className="p-3 sm:p-4 rounded-xl animate-fade-in" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                <p className="text-sm text-red-500">{error}</p>
              </div>
            )}

            {/* 프로필 탭 */}
            {activeTab === 'profile' && (
              <div className="space-y-4 sm:space-y-6 animate-fade-in">
                {/* 아바타 섹션 */}
                <div className="card p-4 sm:p-6">
                  <h2 className="text-base sm:text-lg font-semibold mb-4">프로필 사진</h2>
                  <div className="flex items-center gap-4 sm:gap-6">
                    <div className="relative">
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden" style={{ background: 'var(--background-tertiary)' }}>
                        {avatarPreview ? (
                          <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-8 h-8 sm:w-10 sm:h-10" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarChange}
                        className="hidden"
                      />
                    </div>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="btn btn-secondary"
                    >
                      사진 변경
                    </button>
                  </div>
                </div>

                {/* 기본 정보 */}
                <div className="card p-4 sm:p-6">
                  <h2 className="text-base sm:text-lg font-semibold mb-4">기본 정보</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground-secondary)' }}>
                        이름
                      </label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="이름을 입력하세요"
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground-secondary)' }}>
                        이메일
                      </label>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <input
                          type="email"
                          value={user?.email || ''}
                          disabled
                          className="input flex-1 opacity-60"
                        />
                        {user?.email_verified ? (
                          <span className="badge badge-success">인증됨</span>
                        ) : (
                          <span className="badge badge-warning">미인증</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleProfileUpdate}
                      disabled={isLoading}
                      className="btn btn-primary"
                    >
                      {isLoading ? '저장 중...' : '변경사항 저장'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 계정 탭 */}
            {activeTab === 'account' && (
              <div className="space-y-4 sm:space-y-6 animate-fade-in">
                {/* 로그인 방식 안내 */}
                <div className="card p-4 sm:p-6">
                  <h2 className="text-base sm:text-lg font-semibold mb-4">로그인 방식</h2>
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(99, 102, 241, 0.15)' }}>
                      <svg className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: 'var(--accent-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium">Magic Link</p>
                      <p className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                        이메일로 로그인 링크를 받아 안전하게 로그인합니다
                      </p>
                    </div>
                  </div>
                </div>

                {/* 스토리지 */}
                <div className="card p-4 sm:p-6">
                  <h2 className="text-base sm:text-lg font-semibold mb-4">스토리지</h2>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(59, 130, 246, 0.15)' }}>
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xl sm:text-2xl font-semibold">{formatBytes(storageUsed)}</p>
                      <p className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>사용 중</p>
                    </div>
                  </div>
                </div>

                {/* 계정 삭제 */}
                <div className="p-4 sm:p-6 rounded-2xl" style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
                  <h2 className="text-base sm:text-lg font-semibold mb-2 text-red-500">위험 구역</h2>
                  <p className="text-sm mb-4" style={{ color: 'var(--foreground-secondary)' }}>
                    계정을 삭제하면 모든 데이터가 영구적으로 삭제됩니다.
                  </p>
                  <button className="btn btn-danger">
                    계정 삭제
                  </button>
                </div>
              </div>
            )}

            {/* 보안 탭 */}
            {activeTab === 'security' && (
              <div className="space-y-4 sm:space-y-6 animate-fade-in">
                {/* 2FA */}
                <div className="card p-4 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(99, 102, 241, 0.15)' }}>
                        <svg className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: 'var(--accent-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="font-semibold text-sm sm:text-base">2단계 인증</h2>
                        <p className="text-xs sm:text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                          {twoFASetup?.enabled ? '활성화됨' : '비활성화됨'}
                        </p>
                      </div>
                    </div>
                    <span className={`badge ${twoFASetup?.enabled ? 'badge-success' : ''}`}>
                      {twoFASetup?.enabled ? 'ON' : 'OFF'}
                    </span>
                  </div>

                  {twoFASetup?.qrCode && (
                    <div className="space-y-4">
                      <div className="flex flex-col items-center">
                        <div className="p-3 sm:p-4 rounded-xl" style={{ background: '#fff', border: '1px solid var(--border-default)' }}>
                          <img src={twoFASetup.qrCode} alt="2FA QR Code" className="w-32 h-32 sm:w-40 sm:h-40" />
                        </div>
                        {twoFASetup.secret && (
                          <p className="mt-3 text-xs font-mono" style={{ color: 'var(--foreground-muted)' }}>
                            {twoFASetup.secret}
                          </p>
                        )}
                      </div>

                      <div className="flex gap-2 sm:gap-3">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={6}
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="6자리 코드"
                          className="input flex-1 text-center font-mono text-base sm:text-lg tracking-widest"
                        />
                        <button
                          onClick={handle2FAVerify}
                          disabled={totpCode.length !== 6 || isLoading}
                          className="btn btn-primary"
                        >
                          확인
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 보안 기능 목록 */}
                <div className="card p-4 sm:p-6">
                  <h2 className="text-base sm:text-lg font-semibold mb-4">보안 기능</h2>
                  <div className="space-y-2 sm:space-y-3">
                    {[
                      { label: 'IP 바인딩', enabled: true },
                      { label: '세션 타임아웃 (30분)', enabled: true },
                      { label: '파일 검증 (Magic Bytes)', enabled: true },
                      { label: 'Rate Limiting', enabled: true },
                      { label: '감사 로그', enabled: true },
                    ].map((feature) => (
                      <div key={feature.label} className="flex items-center justify-between py-1.5 sm:py-2">
                        <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>{feature.label}</span>
                        <span className="badge badge-success text-xs">활성</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 환경설정 탭 */}
            {activeTab === 'preferences' && (
              <div className="space-y-4 sm:space-y-6 animate-fade-in">
                <div className="card p-4 sm:p-6">
                  <h2 className="text-base sm:text-lg font-semibold mb-4">외관</h2>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">테마</p>
                      <p className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                        {theme === 'dark' ? '다크 모드' : '라이트 모드'}
                      </p>
                    </div>
                    <button
                      onClick={toggleTheme}
                      className="relative w-12 h-7 sm:w-14 sm:h-8 rounded-full transition-colors"
                      style={{ background: theme === 'dark' ? 'var(--accent-primary)' : 'var(--border-default)' }}
                    >
                      <div
                        className="absolute top-0.5 sm:top-1 w-6 h-6 rounded-full bg-white shadow transition-transform"
                        style={{ transform: theme === 'dark' ? 'translateX(22px)' : 'translateX(2px)' }}
                      />
                    </button>
                  </div>
                </div>

                <div className="card p-4 sm:p-6">
                  <h2 className="text-base sm:text-lg font-semibold mb-4">언어</h2>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl sm:text-2xl">🇰🇷</span>
                      <span>한국어</span>
                    </div>
                    <svg className="w-5 h-5" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>

                {/* 로그아웃 */}
                <button
                  onClick={logout}
                  className="w-full card p-4 font-medium text-left flex items-center justify-between text-red-500 hover:border-red-500/30 transition-colors"
                >
                  <span>로그아웃</span>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
