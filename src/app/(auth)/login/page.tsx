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

  // 이메일 확인 후 Magic Link 전송
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setIsLoading(true)
    setError('')

    try {
      // 먼저 이메일이 존재하는지 확인
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

      // 신규 사용자면 이름 입력 화면으로 (또는 바로 Magic Link)
      if (!checkData.exists) {
        setIsNewUser(true)
      }

      // Magic Link 전송
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

  // 다시 시도
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
    <main className="min-h-screen flex items-center justify-center p-4 safe-area-top safe-area-bottom" style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-md relative z-10 animate-fade-in">
        {/* 로고 */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-3xl mb-4" style={{ background: 'var(--accent-primary)', boxShadow: 'var(--shadow-lg)' }}>
            <svg className="w-8 h-8 sm:w-10 sm:h-10" style={{ color: 'var(--accent-text)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold">Cloody</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--foreground-secondary)' }}>나만의 프라이빗 클라우드</p>
        </div>

        {/* 카드 */}
        <div className="card overflow-hidden" style={{ boxShadow: 'var(--shadow-xl)' }}>
          <div className="p-5 sm:p-8">
            {/* 이메일 입력 단계 */}
            {(step === 'email' || step === 'sending') && (
              <form onSubmit={handleSubmit} className="space-y-5 animate-fade-in">
                <div className="text-center mb-2">
                  <h2 className="text-base sm:text-lg font-semibold">로그인 / 회원가입</h2>
                  <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--foreground-secondary)' }}>이메일로 로그인 링크를 받으세요</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
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
                    <label className="block text-sm font-medium mb-2">
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
                  <div className="p-3 rounded-xl animate-fade-in" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    <p className="text-sm text-red-500">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || !email || step === 'sending'}
                  className="btn btn-primary w-full !py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {step === 'sending' ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      전송 중...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
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

            {/* Magic Link 발송 완료 */}
            {step === 'sent' && (
              <div className="text-center py-2 sm:py-4 animate-fade-in">
                <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'rgba(34, 197, 94, 0.15)' }}>
                  <svg className="w-7 h-7 sm:w-8 sm:h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-lg sm:text-xl font-semibold mb-2">이메일을 확인하세요!</h2>
                <p className="text-sm sm:text-base mb-1" style={{ color: 'var(--foreground-secondary)' }}>
                  <span className="font-medium" style={{ color: 'var(--foreground)' }}>{email}</span>
                </p>
                <p className="text-sm mb-5 sm:mb-6" style={{ color: 'var(--foreground-secondary)' }}>
                  로 로그인 링크를 보냈습니다.
                </p>

                <div className="rounded-xl p-4 mb-5 sm:mb-6" style={{ background: 'var(--background-secondary)' }}>
                  <p className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                    이메일에서 <span className="font-medium gradient-text">"로그인"</span> 버튼을 클릭하세요.
                  </p>
                  <p className="text-xs mt-2" style={{ color: 'var(--foreground-muted)' }}>
                    링크는 15분 동안 유효합니다.
                  </p>
                </div>

                {error && (
                  <div className="p-3 rounded-xl mb-4 animate-fade-in" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    <p className="text-sm text-red-500">{error}</p>
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

        <p className="text-center text-xs mt-6" style={{ color: 'var(--foreground-muted)' }}>
          Your Secure Private Cloud
        </p>
      </div>
    </main>
  )
}
