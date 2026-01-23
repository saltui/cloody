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
        // 잠시 후 내 파일로 이동
        setTimeout(() => {
          router.push('/gallery')
        }, 1500)
      })
      .catch(() => {
        setStatus('error')
        setError('네트워크 오류가 발생했습니다.')
      })
  }, [searchParams, router])

  return (
    <main className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-md">
        <div className="card p-8 text-center" style={{ boxShadow: 'var(--shadow-xl)' }}>
          {status === 'loading' && (
            <div className="animate-fade-in">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
                <div className="w-8 h-8 border-3 rounded-full animate-spin" style={{ borderColor: 'var(--accent-text)', borderTopColor: 'transparent', opacity: 0.6 }} />
              </div>
              <h2 className="text-xl font-semibold mb-2">로그인 중...</h2>
              <p style={{ color: 'var(--foreground-secondary)' }}>잠시만 기다려주세요.</p>
            </div>
          )}

          {status === 'success' && (
            <div className="animate-fade-in">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-green-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold mb-2">로그인 성공!</h2>
              <p style={{ color: 'var(--foreground-secondary)' }}>내 파일로 이동합니다...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="animate-fade-in">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold mb-2">인증 실패</h2>
              <p className="mb-6" style={{ color: 'var(--foreground-secondary)' }}>{error}</p>
              <button
                onClick={() => router.push('/login')}
                className="btn btn-primary !py-3 px-6"
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
      <main className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--background)' }}>
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
          <div className="w-8 h-8 border-3 rounded-full animate-spin" style={{ borderColor: 'var(--accent-text)', borderTopColor: 'transparent', opacity: 0.6 }} />
        </div>
      </main>
    }>
      <MagicLinkContent />
    </Suspense>
  )
}
