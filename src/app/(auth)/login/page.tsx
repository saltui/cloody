'use client'

import { useState, useEffect, useRef } from 'react'

type AuthStep = 'email' | 'sending' | 'sent'

export default function LoginPage() {
  const [step, setStep] = useState<AuthStep>('email')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [isNewUser, setIsNewUser] = useState(false)
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

    try {
      const checkRes = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const checkData = await checkRes.json()

      if (!checkRes.ok) {
        setError(checkData.error || '오류가 발생했습니다.')
        setIsLoading(false)
        return
      }

      if (!checkData.exists) {
        setIsNewUser(true)
      }

      setStep('sending')

      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          displayName: displayName || undefined,
          createIfNotExists: true
        }),
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
    <main className="min-h-screen flex items-center justify-center p-4 safe-area-top safe-area-bottom relative overflow-hidden">
      {/* Cosmic Background */}
      <div className="cosmic-bg" />

      {/* Decorative Orbs */}
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      <div className="w-full max-w-sm relative z-10 animate-fade-in-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 glass-strong" style={{ boxShadow: '0 0 30px rgba(139, 92, 246, 0.3)' }}>
            <svg className="w-8 h-8" style={{ color: 'var(--accent-tertiary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--foreground)' }}>Cloody</h1>
          <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>Your private cloud</p>
        </div>

        {/* Card */}
        <div className="card card-no-hover card-glow overflow-hidden">
          <div className="p-6">
            {/* Email Input Step */}
            {(step === 'email' || step === 'sending') && (
              <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
                <div className="text-center mb-2">
                  <h2 className="text-lg font-medium" style={{ color: 'var(--foreground)' }}>
                    로그인
                  </h2>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--foreground-secondary)' }}>
                    이메일
                  </label>
                  <input
                    ref={emailRef}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="input"
                    required
                    disabled={step === 'sending'}
                  />
                </div>

                {isNewUser && (
                  <div className="animate-fade-in-up">
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--foreground-secondary)' }}>
                      이름 <span style={{ color: 'var(--foreground-muted)' }}>(선택)</span>
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="홍길동"
                      className="input"
                      disabled={step === 'sending'}
                    />
                  </div>
                )}

                {error && (
                  <div className="p-3 rounded-lg animate-fade-in" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    <p className="text-xs" style={{ color: 'var(--error)' }}>{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || !email || step === 'sending'}
                  className="btn btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {step === 'sending' ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      전송 중...
                    </span>
                  ) : (
                    '계속하기'
                  )}
                </button>

                <p className="text-xs text-center" style={{ color: 'var(--foreground-muted)' }}>
                  계정이 없으면 자동으로 생성됩니다
                </p>
              </form>
            )}

            {/* Magic Link Sent */}
            {step === 'sent' && (
              <div className="text-center py-2 animate-fade-in">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.25)' }}>
                  <svg className="w-6 h-6" style={{ color: 'var(--success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-lg font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                  이메일을 확인하세요
                </h2>
                <p className="text-sm mb-4" style={{ color: 'var(--foreground-secondary)' }}>
                  <span className="font-medium" style={{ color: 'var(--accent-tertiary)' }}>{email}</span>
                  <br />로 로그인 링크를 보냈습니다
                </p>

                <div className="rounded-lg p-3 mb-4" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                  <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    링크는 15분 동안 유효합니다
                  </p>
                </div>

                {error && (
                  <div className="p-3 rounded-lg mb-4 animate-fade-in" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    <p className="text-xs" style={{ color: 'var(--error)' }}>{error}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleRetry}
                    disabled={isLoading}
                    className="btn btn-secondary w-full text-sm"
                  >
                    {isLoading ? '전송 중...' : '다시 보내기'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStep('email')
                      setEmail('')
                      setDisplayName('')
                      setIsNewUser(false)
                      setError('')
                    }}
                    className="btn btn-ghost w-full text-sm"
                  >
                    다른 이메일 사용
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: 'var(--foreground-muted)' }}>
          Secure • Private • Simple
        </p>
      </div>
    </main>
  )
}
