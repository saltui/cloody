'use client'

import { useState, useEffect, useRef } from 'react'

type AuthStep = 'email' | 'sending' | 'sent'

export default function LoginPage() {
  const [step, setStep] = useState<AuthStep>('email')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === 'email') emailRef.current?.focus()
  }, [step])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setIsLoading(true)
    setError('')
    setStep('sending')

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '요청에 실패했습니다.')
        setStep('email')
        return
      }

      setStep('sent')
    } catch {
      setError('네트워크 오류가 발생했습니다.')
      setStep('email')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRetry = async () => {
    setIsLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, createIfNotExists: true }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '요청에 실패했습니다.')
        return
      }

      setError('')
    } catch {
      setError('네트워크 오류가 발생했습니다.')
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
          <div
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '20px',
              background: 'linear-gradient(135deg, #3182f6 0%, #1b64da 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              boxShadow: '0 8px 24px rgba(49, 130, 246, 0.25)',
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
          </div>
          <h1 className="tds-text-headline" style={{ marginBottom: '4px' }}>Cloody</h1>
          <p className="tds-text-body tds-text-tertiary">Jaden&apos;s Private Cloud</p>
        </div>

        {/* Card */}
        <div className="tds-card tds-card-elevated" style={{ padding: '28px 24px' }}>
          {/* Email Input Step */}
          {(step === 'email' || step === 'sending') && (
            <form onSubmit={handleSubmit}>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <h2 className="tds-text-title">로그인</h2>
              </div>

              <div style={{ marginBottom: '20px' }}>
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

              {error && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '12px',
                    background: 'rgba(240, 68, 82, 0.08)',
                    marginBottom: '20px',
                  }}
                >
                  <p className="tds-text-caption" style={{ color: 'var(--tds-color-error)' }}>
                    {error}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !email || step === 'sending'}
                className="tds-btn tds-btn-primary tds-btn-block"
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
            </form>
          )}

          {/* Magic Link Sent */}
          {step === 'sent' && (
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: 'rgba(0, 196, 113, 0.1)',
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
                  stroke="var(--tds-color-success)"
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

              {error && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '12px',
                    background: 'rgba(240, 68, 82, 0.08)',
                    marginBottom: '20px',
                  }}
                >
                  <p className="tds-text-caption" style={{ color: 'var(--tds-color-error)' }}>
                    {error}
                  </p>
                </div>
              )}

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
                    setError('')
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
