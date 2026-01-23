'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function VerifyEmailContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const token = searchParams.get('token')

    if (!token) {
      setStatus('error')
      setError('유효하지 않은 링크입니다.')
      return
    }

    // 이메일 인증
    fetch(`/api/auth/verify-email?token=${token}`)
      .then(async (res) => {
        const data = await res.json()

        if (!res.ok) {
          setStatus('error')
          setError(data.error || '인증에 실패했습니다.')
          return
        }

        setStatus('success')
      })
      .catch(() => {
        setStatus('error')
        setError('네트워크 오류가 발생했습니다.')
      })
  }, [searchParams])

  return (
    <main className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-md">
        <div className="card p-8 text-center" style={{ boxShadow: 'var(--shadow-xl)' }}>
          {status === 'loading' && (
            <div className="animate-fade-in">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
                <div className="w-8 h-8 border-3 rounded-full animate-spin" style={{ borderColor: 'var(--accent-text)', borderTopColor: 'transparent', opacity: 0.6 }} />
              </div>
              <h2 className="text-xl font-semibold mb-2">이메일 인증 중...</h2>
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
              <h2 className="text-xl font-semibold mb-2">이메일 인증 완료!</h2>
              <p className="mb-6" style={{ color: 'var(--foreground-secondary)' }}>이제 모든 기능을 이용할 수 있습니다.</p>
              <button
                onClick={() => router.push('/gallery')}
                className="btn btn-primary w-full !py-3"
              >
                내 파일로 이동
              </button>
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
              <div className="space-y-3">
                <button
                  onClick={() => router.push('/gallery')}
                  className="btn btn-primary w-full !py-3"
                >
                  내 파일로 이동
                </button>
                <button
                  onClick={() => router.push('/login')}
                  className="btn btn-secondary w-full !py-3"
                >
                  로그인 페이지로
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--background)' }}>
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
          <div className="w-8 h-8 border-3 rounded-full animate-spin" style={{ borderColor: 'var(--accent-text)', borderTopColor: 'transparent', opacity: 0.6 }} />
        </div>
      </main>
    }>
      <VerifyEmailContent />
    </Suspense>
  )
}
