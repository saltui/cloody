'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function MagicLinkContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')
  const verifiedRef = useRef(false)

  useEffect(() => {
    // StrictMode에서 두 번 실행 방지
    if (verifiedRef.current) return
    verifiedRef.current = true

    const token = searchParams.get('token')

    if (!token) {
      setStatus('error')
      setError('유효하지 않은 링크입니다.')
      return
    }

    // Magic Link 검증
    fetch(`/api/auth/magic-link/verify?token=${token}`)
      .then(async (res) => {
        const data = await res.json()

        if (!res.ok) {
          setStatus('error')
          setError(data.error || '인증에 실패했습니다.')
          return
        }

        setStatus('success')
        // 잠시 후 드라이브로 이동
        setTimeout(() => {
          router.push('/drive')
        }, 1500)
      })
      .catch(() => {
        setStatus('error')
        setError('네트워크 오류가 발생했습니다.')
      })
  }, [searchParams, router])

  return (
    <main className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Cosmic Background */}
      <div className="cosmic-bg" />

      {/* Decorative Orbs */}
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="w-full max-w-sm relative z-10">
        <div className="card card-no-hover card-glow p-8 text-center">
          {status === 'loading' && (
            <div className="animate-fade-in">
              <div className="w-14 h-14 mx-auto mb-5 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-gradient-subtle)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
                <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-tertiary)', borderTopColor: 'transparent' }} />
              </div>
              <h2 className="text-lg font-medium mb-2" style={{ color: 'var(--foreground)' }}>로그인 중...</h2>
              <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>잠시만 기다려주세요</p>
            </div>
          )}

          {status === 'success' && (
            <div className="animate-fade-in">
              <div className="w-14 h-14 mx-auto mb-5 rounded-xl flex items-center justify-center" style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                <svg className="w-7 h-7" style={{ color: 'var(--success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-medium mb-2" style={{ color: 'var(--foreground)' }}>로그인 성공!</h2>
              <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>드라이브로 이동합니다...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="animate-fade-in">
              <div className="w-14 h-14 mx-auto mb-5 rounded-xl flex items-center justify-center" style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                <svg className="w-7 h-7" style={{ color: 'var(--error)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-lg font-medium mb-2" style={{ color: 'var(--foreground)' }}>인증 실패</h2>
              <p className="text-sm mb-5" style={{ color: 'var(--foreground-muted)' }}>{error}</p>
              <button
                onClick={() => router.push('/login')}
                className="btn btn-primary"
              >
                다시 로그인
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

export default function MagicLinkPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        <div className="cosmic-bg" />
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="w-14 h-14 rounded-xl flex items-center justify-center relative z-10" style={{ background: 'var(--accent-gradient-subtle)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
          <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-tertiary)', borderTopColor: 'transparent' }} />
        </div>
      </main>
    }>
      <MagicLinkContent />
    </Suspense>
  )
}
