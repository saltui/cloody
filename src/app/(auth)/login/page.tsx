'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'

type AuthStep = 'email' | 'sending' | 'sent'

export default function LoginPage() {
  const [step, setStep] = useState<AuthStep>('email')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [hasPasskey, setHasPasskey] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [passkeyOptions, setPasskeyOptions] = useState<any>(null)
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false)
  const [showEmailLogin, setShowEmailLogin] = useState(false)
  const router = useRouter()
  const { showToast } = useToast()

  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === 'email' && showEmailLogin) emailRef.current?.focus()
  }, [step, showEmailLogin])

  // 이메일 변경 시 패스키 유무 확인
  useEffect(() => {
    const checkPasskey = async () => {
      if (!email || !email.includes('@')) {
        setHasPasskey(false)
        setPasskeyOptions(null)
        return
      }

      try {
        const res = await fetch(`/api/passkey/authenticate?email=${encodeURIComponent(email)}`)
        if (res.ok) {
          const data = await res.json()
          setHasPasskey(data.hasPasskey)
          setPasskeyOptions(data.options)
        }
      } catch (error) {
        console.error('[login] checkPasskey failed:', error)
        setHasPasskey(false)
      }
    }

    const timer = setTimeout(checkPasskey, 500) // 디바운스
    return () => clearTimeout(timer)
  }, [email])

  // 패스키로 로그인 (Discoverable - 이메일 없이)
  const handleDiscoverablePasskeyLogin = async () => {
    setIsPasskeyLoading(true)

    try {
      // 1. 서버에서 discoverable 옵션 받기
      const optionsRes = await fetch('/api/passkey/authenticate')
      if (!optionsRes.ok) {
        throw new Error('패스키 옵션을 가져올 수 없습니다.')
      }
      const { options } = await optionsRes.json()

      // 2. WebAuthn 인증 시작
      const { startAuthentication } = await import('@simplewebauthn/browser')
      const credential = await startAuthentication({ optionsJSON: options })

      // 3. 서버에서 검증 (이메일 없이)
      const res = await fetch('/api/passkey/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: credential,
          rememberMe: true,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        showToast(data.error || '패스키 인증에 실패했습니다.', 'error')
        return
      }

      // 로그인 성공
      window.location.href = '/drive'
    } catch (err) {
      console.error('Passkey login error:', err)
      if (err instanceof Error && err.name === 'NotAllowedError') {
        showToast('패스키 인증이 취소되었습니다.', 'error')
      } else {
        showToast(err instanceof Error ? err.message : '패스키 인증에 실패했습니다.', 'error')
      }
    } finally {
      setIsPasskeyLoading(false)
    }
  }

  // 패스키로 로그인 (이메일 기반)
  const handlePasskeyLogin = async () => {
    if (!passkeyOptions) return

    setIsPasskeyLoading(true)

    try {
      const { startAuthentication } = await import('@simplewebauthn/browser')
      const credential = await startAuthentication({ optionsJSON: passkeyOptions as Parameters<typeof startAuthentication>[0]['optionsJSON'] })

      const res = await fetch('/api/passkey/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          response: credential,
          rememberMe: true,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        showToast(data.error || '패스키 인증에 실패했습니다.', 'error')
        return
      }

      // 로그인 성공 - 페이지 리로드로 쿠키 반영
      window.location.href = '/drive'
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        showToast('패스키 인증이 취소되었습니다.', 'error')
      } else {
        showToast('패스키 인증에 실패했습니다.', 'error')
      }
    } finally {
      setIsPasskeyLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setIsLoading(true)
    setStep('sending')

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (!res.ok) {
        showToast(data.error || '요청에 실패했습니다.', 'error')
        setStep('email')
        return
      }

      // 인증 우회로 바로 로그인된 경우 (full page reload로 쿠키 반영)
      if (data.directLogin) {
        window.location.href = '/drive'
        return
      }

      setStep('sent')
    } catch (error) {
      console.error('[login] handleSubmit failed:', error)
      showToast('네트워크 오류가 발생했습니다.', 'error')
      setStep('email')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRetry = async () => {
    setIsLoading(true)

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, createIfNotExists: true }),
      })

      const data = await res.json()

      if (!res.ok) {
        showToast(data.error || '요청에 실패했습니다.', 'error')
        return
      }

      showToast('로그인 링크를 다시 보냈습니다.', 'success')
    } catch (error) {
      console.error('[login] handleRetry failed:', error)
      showToast('네트워크 오류가 발생했습니다.', 'error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '24px 20px',
        background: 'var(--tds-color-background)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '360px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <img
            src="/logo.svg"
            alt="Cloody"
            style={{
              width: '80px',
              height: 'auto',
              margin: '0 auto 16px',
              display: 'block',
            }}
          />
          <h1 className="tds-text-headline" style={{ marginBottom: '4px' }}>Cloody</h1>
          <p className="tds-text-body tds-text-tertiary">Cloody Cloud</p>
        </div>

        {/* Card */}
        <div className="tds-card tds-card-elevated" style={{ padding: '28px 24px' }}>
          {/* 로그인 화면 */}
          {(step === 'email' || step === 'sending') && (
            <>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <h2 className="tds-text-title">로그인</h2>
              </div>

              {/* 패스키 로그인 버튼 (이메일 없이) */}
              <button
                type="button"
                onClick={handleDiscoverablePasskeyLogin}
                disabled={isPasskeyLoading || step === 'sending'}
                className="tds-btn tds-btn-primary tds-btn-block"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                {isPasskeyLoading ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{ animation: 'spin 1s linear infinite' }}
                    >
                      <circle cx="12" cy="12" r="10" opacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                    인증 중...
                  </span>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                    </svg>
                    패스키로 로그인
                  </>
                )}
              </button>

              {/* 또는 구분선 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '20px 0' }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--tds-color-border)' }} />
                <span className="tds-text-caption tds-text-tertiary">또는</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--tds-color-border)' }} />
              </div>

              {/* 이메일 로그인 토글 */}
              {!showEmailLogin ? (
                <button
                  type="button"
                  onClick={() => setShowEmailLogin(true)}
                  className="tds-btn tds-btn-secondary tds-btn-block"
                >
                  이메일로 로그인
                </button>
              ) : (
                <form onSubmit={handleSubmit}>
                  <div style={{ marginBottom: '16px' }}>
                    <label
                      className="tds-text-label tds-text-secondary"
                      style={{ display: 'block', marginBottom: '8px' }}
                    >
                      이메일
                    </label>
                    <input
                      ref={emailRef}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="tds-input"
                      required
                      disabled={step === 'sending'}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || !email || step === 'sending'}
                    className="tds-btn tds-btn-secondary tds-btn-block"
                  >
                    {step === 'sending' ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          style={{ animation: 'spin 1s linear infinite' }}
                        >
                          <circle cx="12" cy="12" r="10" opacity="0.25" />
                          <path d="M12 2a10 10 0 0 1 10 10" />
                        </svg>
                        전송 중...
                      </span>
                    ) : (
                      '로그인 링크 받기'
                    )}
                  </button>

                  {/* 이메일 기반 패스키 로그인 버튼 */}
                  {hasPasskey && passkeyOptions && (
                    <button
                      type="button"
                      onClick={handlePasskeyLogin}
                      disabled={isPasskeyLoading}
                      className="tds-btn tds-btn-ghost tds-btn-block"
                      style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                      </svg>
                      이 계정의 패스키 사용
                    </button>
                  )}
                </form>
              )}
            </>
          )}

          {/* Magic Link Sent */}
          {step === 'sent' && (
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: 'rgba(99, 102, 241, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#6366F1"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <h2 className="tds-text-title" style={{ marginBottom: '8px' }}>
                이메일을 확인하세요
              </h2>
              <p className="tds-text-body tds-text-secondary" style={{ marginBottom: '20px' }}>
                <span style={{ color: 'var(--tds-color-primary)', fontWeight: 600 }}>{email}</span>
                <br />로 로그인 링크를 보냈습니다
              </p>

              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '12px',
                  background: 'var(--tds-color-background-secondary)',
                  marginBottom: '20px',
                }}
              >
                <p className="tds-text-caption tds-text-tertiary">
                  링크는 15분 동안 유효합니다
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={isLoading}
                  className="tds-btn tds-btn-secondary tds-btn-block"
                >
                  {isLoading ? '전송 중...' : '다시 보내기'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('email')
                    setEmail('')
                  }}
                  className="tds-btn tds-btn-ghost tds-btn-block"
                >
                  다른 이메일 사용
                </button>
              </div>
            </div>
          )}
        </div>

        <p
          className="tds-text-caption tds-text-tertiary"
          style={{ textAlign: 'center', marginTop: '24px' }}
        >
          Secure • Private • Simple
        </p>
      </div>

      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </main>
  )
}
