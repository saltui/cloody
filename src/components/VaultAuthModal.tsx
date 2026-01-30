'use client'

import { useState } from 'react'

interface VaultAuthModalProps {
  onSuccess: () => void
  onCancel: () => void
}

export default function VaultAuthModal({ onSuccess, onCancel }: VaultAuthModalProps) {
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAuthenticate = async () => {
    if (!('PublicKeyCredential' in window)) {
      setError('이 브라우저는 패스키를 지원하지 않습니다.')
      return
    }

    setIsAuthenticating(true)
    setError(null)

    try {
      // 1. 인증 옵션 가져오기
      const optionsRes = await fetch('/api/vault/verify')
      if (!optionsRes.ok) {
        throw new Error('인증 옵션을 가져올 수 없습니다.')
      }

      const optionsData = await optionsRes.json()

      if (!optionsData.hasPasskey) {
        // 패스키가 없으면 바로 통과
        localStorage.setItem('vault_last_auth', Date.now().toString())
        onSuccess()
        return
      }

      // 2. WebAuthn API 호출
      const { startAuthentication } = await import('@simplewebauthn/browser')
      const credential = await startAuthentication({ optionsJSON: optionsData.options })

      // 3. 서버에 검증 요청
      const verifyRes = await fetch('/api/vault/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: credential }),
      })

      if (!verifyRes.ok) {
        const data = await verifyRes.json()
        throw new Error(data.error || '패스키 인증에 실패했습니다.')
      }

      // 4. 인증 성공 - 마지막 인증 시간 저장
      localStorage.setItem('vault_last_auth', Date.now().toString())
      onSuccess()
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setError('패스키 인증이 취소되었습니다.')
        } else {
          setError(err.message)
        }
      } else {
        setError('패스키 인증에 실패했습니다.')
      }
    } finally {
      setIsAuthenticating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onCancel} />

      <div
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6 sm:p-8"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}
      >
        {/* 모바일 드래그 핸들 */}
        <div className="w-10 h-1 rounded-full mx-auto mb-6 sm:hidden" style={{ background: 'var(--glass-border)' }} />

        <div className="text-center">
          {/* 자물쇠 아이콘 */}
          <div
            className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--accent-gradient-subtle)' }}
          >
            <svg className="w-8 h-8" style={{ color: 'var(--accent-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>

          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            Vault 인증
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--foreground-muted)' }}>
            Vault에 접근하려면 패스키 인증이 필요합니다.
          </p>

          {error && (
            <div
              className="mb-4 p-3 rounded-xl text-sm text-center"
              style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)' }}
            >
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <button
              onClick={handleAuthenticate}
              disabled={isAuthenticating}
              className="w-full py-3.5 rounded-xl font-medium text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
              style={{ background: 'var(--accent-gradient)' }}
            >
              {isAuthenticating ? (
                <>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  인증 중...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                  </svg>
                  패스키로 인증
                </>
              )}
            </button>

            <button
              onClick={onCancel}
              className="w-full py-3 rounded-xl text-sm transition-colors"
              style={{ color: 'var(--foreground-secondary)' }}
            >
              돌아가기
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
