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
      {/* Decorative Orbs */}
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      <div className="w-full max-w-md relative z-10 animate-fade-in-up">
        {/* Logo */}
        <div className="text-center mb-8 sm:mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-3xl mb-5 glass-strong animate-float" style={{ boxShadow: 'var(--shadow-glow)' }}>
            <svg className="w-10 h-10 sm:w-12 sm:h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Cloody</h1>
          <p className="text-base text-white/70">나만의 프라이빗 클라우드</p>
        </div>

        {/* Card */}
        <div className="card card-no-hover overflow-hidden" style={{ boxShadow: 'var(--shadow-xl)' }}>
          <div className="p-6 sm:p-8">
            {/* Email Input Step */}
            {(step === 'email' || step === 'sending') && (
              <form onSubmit={handleSubmit} className="space-y-5 animate-fade-in">
                <div className="text-center mb-4">
                  <h2 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
                    시작하기
                  </h2>
                  <p className="text-sm mt-2" style={{ color: 'var(--foreground-secondary)' }}>
                    이메일로 간편하게 로그인하세요
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2.5" style={{ color: 'var(--foreground)' }}>
                    이메일 주소
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
                    <label className="block text-sm font-medium mb-2.5" style={{ color: 'var(--foreground)' }}>
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
                  <div className="p-4 rounded-xl animate-fade-in glass" style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                    <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || !email || step === 'sending'}
                  className="btn btn-primary w-full !py-3.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {step === 'sending' ? (
                    <span className="flex items-center justify-center gap-2.5">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      전송 중...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2.5">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      로그인 링크 받기
                    </span>
                  )}
                </button>

                <p className="text-xs text-center" style={{ color: 'var(--foreground-muted)' }}>
                  계정이 없으면 자동으로 생성됩니다
                </p>
              </form>
            )}

            {/* Magic Link Sent */}
            {step === 'sent' && (
              <div className="text-center py-4 animate-fade-in">
                <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-5 rounded-full flex items-center justify-center glass" style={{ background: 'rgba(16, 185, 129, 0.2)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                  <svg className="w-8 h-8 sm:w-10 sm:h-10" style={{ color: 'var(--success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-xl sm:text-2xl font-bold mb-3" style={{ color: 'var(--foreground)' }}>
                  이메일을 확인하세요!
                </h2>
                <p className="text-base mb-1" style={{ color: 'var(--foreground-secondary)' }}>
                  <span className="font-semibold gradient-text">{email}</span>
                </p>
                <p className="text-sm mb-6" style={{ color: 'var(--foreground-secondary)' }}>
                  로 로그인 링크를 보냈습니다.
                </p>

                <div className="rounded-xl p-5 mb-6 glass">
                  <p className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                    이메일에서 <span className="font-semibold gradient-text">&quot;로그인&quot;</span> 버튼을 클릭하세요.
                  </p>
                  <p className="text-xs mt-2.5" style={{ color: 'var(--foreground-muted)' }}>
                    링크는 15분 동안 유효합니다.
                  </p>
                </div>

                {error && (
                  <div className="p-4 rounded-xl mb-5 animate-fade-in glass" style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                    <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>
                  </div>
                )}

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={handleRetry}
                    disabled={isLoading}
                    className="btn btn-secondary w-full !py-3"
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
                    className="btn btn-ghost w-full"
                  >
                    다른 이메일로 로그인
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-sm mt-8 text-white/50">
          Your Secure Private Cloud
        </p>
      </div>
    </main>
  )
}
