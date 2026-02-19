'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme'
import { useUser } from '@/lib/user-context'
import { useToast } from '@/components/Toast'

type SettingsTab = 'profile' | 'account' | 'security' | 'preferences'

interface TwoFASetup {
  enabled: boolean
  secret?: string
  qrCode?: string
}

interface Passkey {
  id: string
  name: string
  device_type: string
  backed_up: boolean
  created_at: string
  last_used_at: string | null
}

export default function SettingsPage() {
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()
  const { user, logout, updateUser } = useUser()
  const { showToast } = useToast()

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const [isLoading, setIsLoading] = useState(false)

  // 프로필 상태
  const [displayName, setDisplayName] = useState('')

  // 2FA 상태
  const [twoFASetup, setTwoFASetup] = useState<TwoFASetup | null>(null)
  const [totpCode, setTotpCode] = useState('')

  // 패스키 상태
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false)

  // 스토리지 사용량
  const [storageUsed, setStorageUsed] = useState<number>(0)

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || '')
    }
  }, [user])

  useEffect(() => {
    // 스토리지 사용량 가져오기
    fetch(`/api/storage?refresh=1&includeR2=1&ts=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'include',
      headers: user?.id ? { 'x-user-id': user.id } : undefined,
    })
      .then(res => res.json())
      .then(data => {
        const parsedUsage = Number(data?.usage ?? 0)
        setStorageUsed(Number.isFinite(parsedUsage) ? parsedUsage : 0)
      })
      .catch(() => {})

    // 2FA 상태 가져오기
    fetch('/api/2fa/setup')
      .then(res => res.json())
      .then(data => setTwoFASetup(data))
      .catch(() => {})

    // 패스키 목록 가져오기
    fetchPasskeys()
  }, [user?.id])

  const fetchPasskeys = async () => {
    try {
      const res = await fetch('/api/passkey')
      if (res.ok) {
        const data = await res.json()
        setPasskeys(data.passkeys || [])
      }
    } catch {
      // 패스키 조회 실패 (무시)
    }
  }

  // 패스키 등록
  const handleRegisterPasskey = async () => {
    if (!('PublicKeyCredential' in window)) {
      showToast('이 브라우저는 패스키를 지원하지 않습니다.', 'error')
      return
    }

    setIsRegisteringPasskey(true)

    try {
      // 1. 등록 옵션 가져오기
      const optionsRes = await fetch('/api/passkey/register')
      if (!optionsRes.ok) {
        throw new Error('패스키 등록 옵션을 가져올 수 없습니다.')
      }
      const options = await optionsRes.json()

      // 2. WebAuthn API 호출
      const { startRegistration } = await import('@simplewebauthn/browser')
      const credential = await startRegistration({ optionsJSON: options })

      // 3. 서버에 검증 요청
      const verifyRes = await fetch('/api/passkey/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: credential }),
      })

      if (!verifyRes.ok) {
        const data = await verifyRes.json()
        throw new Error(data.error || '패스키 등록에 실패했습니다.')
      }

      showToast('패스키가 등록되었습니다!', 'success')
      fetchPasskeys()
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        showToast('패스키 등록이 취소되었습니다.', 'error')
      } else {
        showToast(err instanceof Error ? err.message : '패스키 등록에 실패했습니다.', 'error')
      }
    } finally {
      setIsRegisteringPasskey(false)
    }
  }

  // 패스키 삭제
  const handleDeletePasskey = async (passkeyId: string) => {
    if (!confirm('이 패스키를 삭제하시겠습니까?')) return

    try {
      const res = await fetch('/api/passkey/register', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkeyId }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error)
      }

      showToast('패스키가 삭제되었습니다.', 'success')
      fetchPasskeys()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '패스키 삭제에 실패했습니다.', 'error')
    }
  }

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

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '업데이트에 실패했습니다.')
      }

      updateUser({ display_name: displayName })
      showToast('프로필이 업데이트되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '오류가 발생했습니다.', 'error')
    } finally {
      setIsLoading(false)
    }
  }

  // 2FA 코드 확인
  const handle2FAVerify = async () => {
    if (totpCode.length !== 6) return

    setIsLoading(true)

    try {
      const res = await fetch('/api/2fa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpCode }),
      })

      const data = await res.json()

      if (data.success) {
        showToast('2FA 인증이 확인되었습니다.', 'success')
        setTotpCode('')
      } else {
        showToast(data.error || '잘못된 코드입니다.', 'error')
        setTotpCode('')
      }
    } catch {
      showToast('확인에 실패했습니다.', 'error')
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
    <main className="min-h-screen tds-safe-area-top tds-safe-area-bottom" style={{ background: 'var(--background)' }}>
      {/* 헤더 - TDS 스타일 */}
      <header className="tds-header">
        <div className="max-w-4xl mx-auto w-full flex items-center gap-3 sm:gap-4">
          <button
            onClick={() => router.back()}
            className="tds-header-action"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="tds-header-title">설정</h1>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <div className="flex flex-col md:flex-row gap-4 sm:gap-8">
          {/* 사이드바 탭 */}
          <nav className="md:w-48 flex-shrink-0">
            <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl whitespace-nowrap text-sm sm:text-base settings-hover-btn"
                    style={{
                      background: isActive ? 'var(--accent-gradient)' : undefined,
                    }}
                  >
                    <span style={{ color: isActive ? 'white' : 'var(--foreground-secondary)' }}>{tab.icon}</span>
                    <span className="font-medium" style={{ color: isActive ? 'white' : 'var(--foreground-secondary)' }}>{tab.label}</span>
                  </button>
                )
              })}

            </div>
          </nav>

          {/* 메인 콘텐츠 */}
          <div className="flex-1 space-y-4 sm:space-y-6">
            {/* 프로필 탭 */}
            {activeTab === 'profile' && (
              <div className="space-y-4 sm:space-y-6 animate-fade-in">
                {/* 기본 정보 */}
                <div className="tds-card p-4 sm:p-6">
                  <h2 className="tds-text-title mb-4">기본 정보</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="tds-text-label tds-text-secondary block mb-2">
                        이름
                      </label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="이름을 입력하세요"
                        className="tds-input"
                      />
                    </div>
                    <div>
                      <label className="tds-text-label tds-text-secondary block mb-2">
                        이메일
                      </label>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <input
                          type="email"
                          value={user?.email || ''}
                          disabled
                          className="tds-input flex-1"
                        />
                        {user?.email_verified ? (
                          <span className="tds-badge tds-badge-success">인증됨</span>
                        ) : (
                          <span className="tds-badge" style={{ background: 'rgba(251, 191, 36, 0.1)', color: '#f59e0b' }}>미인증</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleProfileUpdate}
                      disabled={isLoading}
                      className="tds-btn tds-btn-primary"
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
                {/* 로그인 방식 안내 - 숨김 처리 */}

                {/* 스토리지 */}
                <div className="tds-card p-4 sm:p-6">
                  <h2 className="tds-text-title mb-4">스토리지</h2>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(49, 130, 246, 0.1)' }}>
                      <svg className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: 'var(--accent-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                      </svg>
                    </div>
                    <div>
                      <p className="tds-text-headline">{formatBytes(storageUsed)}</p>
                      <p className="tds-text-caption tds-text-secondary">사용 중</p>
                    </div>
                  </div>
                </div>

                {/* 계정 삭제 */}
                <div className="tds-card p-4 sm:p-6" style={{ background: 'rgba(244, 67, 54, 0.05)', borderColor: 'rgba(244, 67, 54, 0.15)' }}>
                  <h2 className="tds-text-title mb-2" style={{ color: 'var(--error)' }}>더 이상 사용하지 않나요?</h2>
                  <p className="tds-text-body tds-text-secondary mb-4">
                    계정을 삭제하면 저장된 파일과 설정이 모두 사라져요. 이 작업은 되돌릴 수 없어요.
                  </p>
                  <button className="tds-btn tds-badge-error" style={{ background: 'var(--error)', color: 'white' }}>
                    계정 삭제하기
                  </button>
                </div>
              </div>
            )}

            {/* 보안 탭 */}
            {activeTab === 'security' && (
              <div className="space-y-4 sm:space-y-6 animate-fade-in">
                {/* 패스키 */}
                <div className="tds-card p-4 sm:p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(34, 197, 94, 0.1)' }}>
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: '#22c55e' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="tds-text-body font-semibold">패스키</h2>
                      <p className="tds-text-caption tds-text-secondary">
                        Face ID, Touch ID로 비밀번호 없이 로그인
                      </p>
                    </div>
                  </div>

                  {/* 등록된 패스키 목록 */}
                  {passkeys.length > 0 && (
                    <div className="space-y-2 mb-4">
                      {passkeys.map((passkey) => (
                        <div
                          key={passkey.id}
                          className="flex items-center gap-3 p-3 rounded-xl"
                          style={{ background: 'var(--background-secondary)' }}
                        >
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--background-tertiary)' }}>
                            <svg className="w-4 h-4" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="tds-text-body font-medium truncate">{passkey.name}</p>
                            <p className="tds-text-caption tds-text-tertiary">
                              {passkey.last_used_at
                                ? `마지막 사용: ${new Date(passkey.last_used_at).toLocaleDateString('ko-KR')}`
                                : `등록일: ${new Date(passkey.created_at).toLocaleDateString('ko-KR')}`}
                            </p>
                          </div>
                          <button
                            onClick={() => handleDeletePasskey(passkey.id)}
                            className="p-2 rounded-lg transition-colors hover:bg-red-500/10"
                            style={{ color: 'var(--error)' }}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 패스키 등록 */}
                  <button
                    onClick={handleRegisterPasskey}
                    disabled={isRegisteringPasskey}
                    className="tds-btn tds-btn-secondary w-full flex items-center justify-center gap-2"
                  >
                    {isRegisteringPasskey ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="10" opacity="0.25" />
                          <path d="M12 2a10 10 0 0 1 10 10" />
                        </svg>
                        등록 중...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        패스키 추가
                      </>
                    )}
                  </button>

                  {!('PublicKeyCredential' in window) && (
                    <p className="tds-text-caption tds-text-tertiary mt-2 text-center">
                      이 브라우저는 패스키를 지원하지 않습니다.
                    </p>
                  )}
                </div>

                {/* 2FA */}
                <div className="tds-card p-4 sm:p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(49, 130, 246, 0.1)' }}>
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: 'var(--accent-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="tds-text-body font-semibold">2단계 인증 (TOTP)</h2>
                      <p className="tds-text-caption tds-text-secondary">
                        인증 앱으로 로그인 보안 강화
                      </p>
                    </div>
                  </div>

                  {twoFASetup?.qrCode && (
                    <div className="space-y-4">
                      <p className="tds-text-body tds-text-secondary">
                        인증 앱(Google Authenticator, Authy 등)에 아래 키를 추가하세요.
                      </p>

                      {/* 시크릿 키 (모바일 친화적) */}
                      {twoFASetup.secret && (
                        <div className="p-3 rounded-xl" style={{ background: 'var(--background-secondary)' }}>
                          <p className="tds-text-caption tds-text-tertiary mb-2">시크릿 키</p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 font-mono text-sm sm:text-base break-all" style={{ color: 'var(--foreground-primary)' }}>
                              {twoFASetup.secret}
                            </code>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(twoFASetup.secret!)
                                showToast('시크릿 키가 복사되었습니다.', 'success')
                              }}
                              className="p-2 rounded-lg shrink-0 transition-colors"
                              style={{ background: 'var(--background-tertiary)' }}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* QR 코드 (데스크톱용) */}
                      <div className="hidden sm:flex flex-col items-center">
                        <p className="tds-text-caption tds-text-tertiary mb-2">또는 QR 코드 스캔</p>
                        <div className="p-3 rounded-xl bg-white" style={{ border: '1px solid var(--border-default)' }}>
                          <img src={twoFASetup.qrCode} alt="2FA QR Code" className="w-32 h-32" />
                        </div>
                      </div>

                      <div className="flex gap-2 sm:gap-3">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={6}
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="6자리 코드 입력"
                          className="tds-input flex-1 text-center font-mono text-base sm:text-lg tracking-widest"
                        />
                        <button
                          onClick={handle2FAVerify}
                          disabled={totpCode.length !== 6 || isLoading}
                          className="tds-btn tds-btn-primary"
                        >
                          확인
                        </button>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* 환경설정 탭 */}
            {activeTab === 'preferences' && (
              <div className="space-y-4 sm:space-y-6 animate-fade-in">
                <div className="tds-card p-4 sm:p-6">
                  <h2 className="tds-text-title mb-4">외관</h2>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="tds-text-body font-medium">테마</p>
                      <p className="tds-text-caption tds-text-secondary">
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

                <button
                  onClick={() => showToast('준비중이에요', 'info')}
                  className="w-full tds-card p-4 sm:p-6 text-left transition-all duration-200 hover:opacity-80"
                >
                  <h2 className="tds-text-title mb-4">언어</h2>
                  <div className="tds-list-item !bg-transparent !p-0">
                    <span className="text-xl sm:text-2xl">🇰🇷</span>
                    <span className="tds-text-body flex-1">한국어</span>
                    <svg className="w-5 h-5" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>

                {/* 로그아웃 */}
                <button
                  onClick={logout}
                  className="settings-logout-btn w-full tds-card p-4 tds-text-body font-medium text-left flex items-center justify-between transition-all duration-200"
                  style={{ color: 'var(--error)' }}
                >
                  <span>로그아웃</span>
                  <svg className="w-5 h-5 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
