'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

interface SharedPhoto {
  id: string
  name: string
  url: string
  thumbnail_url: string | null
  created_at: string
  // Video metadata
  file_type?: string
  file_size?: number
  is_video?: boolean
  duration?: number
  width?: number
  height?: number
  hls_url?: string
  hls_status?: 'not_applicable' | 'pending' | 'processing' | 'ready' | 'failed'
}

// R2 URL을 프록시 URL로 변환
function toProxyUrl(originalUrl: string): string {
  if (originalUrl.includes('.r2.dev/')) {
    const parts = originalUrl.split('.r2.dev/')
    if (parts.length > 1) {
      const fileName = parts[1].split('?')[0]
      return `/api/image/${fileName}`
    }
  }
  if (originalUrl.includes('.r2.cloudflarestorage.com/')) {
    try {
      const url = new URL(originalUrl)
      const pathParts = url.pathname.split('/')
      if (pathParts.length > 2) {
        const fileName = pathParts.slice(2).join('/')
        return `/api/image/${fileName}`
      }
    } catch {
      return originalUrl
    }
  }
  return originalUrl
}

export default function SharePage() {
  const params = useParams()
  const token = params.token as string

  const [photo, setPhoto] = useState<SharedPhoto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const fetchSharedPhoto = async () => {
      try {
        const res = await fetch(`/api/share/${token}`)

        if (!res.ok) {
          if (res.status === 404) {
            setError('공유 링크를 찾을 수 없습니다.')
          } else if (res.status === 410) {
            setError('공유 링크가 만료되었습니다.')
          } else {
            setError('파일을 불러올 수 없습니다.')
          }
          return
        }

        const data = await res.json()
        setPhoto(data.photo)
      } catch {
        setError('네트워크 오류가 발생했습니다.')
      } finally {
        setLoading(false)
      }
    }

    if (token) {
      fetchSharedPhoto()
    }
  }, [token])

  // 다운로드 핸들러
  const handleDownload = async () => {
    if (!photo) return
    setDownloading(true)

    try {
      const proxyUrl = toProxyUrl(photo.url)
      const response = await fetch(proxyUrl)

      if (!response.ok) throw new Error('Download failed')

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = photo.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download error:', err)
      alert('다운로드에 실패했습니다.')
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
          <p className="tds-text-body tds-text-tertiary">불러오는 중...</p>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--background)' }}>
        <div className="text-center animate-fade-in max-w-sm">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center" style={{ background: 'var(--background-secondary)' }}>
            <svg className="w-10 h-10" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="tds-text-title mb-2">{error}</p>
          <p className="tds-text-body tds-text-secondary">링크가 만료되었거나 잘못된 링크입니다.</p>
        </div>
      </main>
    )
  }

  if (!photo) return null

  const imageUrl = toProxyUrl(photo.url)
  const isVideo = photo.is_video || photo.name.match(/\.(mp4|webm|mov|avi|mkv)$/i)

  return (
    <main className="min-h-screen flex flex-col tds-safe-area-top tds-safe-area-bottom" style={{ background: 'var(--background)' }}>
      {/* 헤더 - TDS 스타일 */}
      <header className="tds-header">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
            <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="tds-text-title">Cloody</span>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="tds-btn tds-btn-primary"
        >
          {downloading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span className="hidden sm:inline">다운로드 중...</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="hidden sm:inline">다운로드</span>
            </>
          )}
        </button>
      </header>

      {/* 콘텐츠 */}
      <div className="flex-1 flex items-center justify-center p-3 sm:p-4 md:p-6">
        <div className="max-w-4xl w-full animate-fade-in">
          <div className="tds-card overflow-hidden">
            {isVideo ? (
              <video
                src={imageUrl}
                controls
                playsInline
                className="w-full max-h-[70vh] sm:max-h-[75vh] object-contain"
              />
            ) : (
              <img
                src={imageUrl}
                alt={photo.name}
                className="w-full max-h-[70vh] sm:max-h-[75vh] object-contain"
              />
            )}
          </div>

          {/* 파일 정보 */}
          <div className="mt-4 sm:mt-6 text-center">
            <p className="tds-text-body font-medium truncate px-4">{photo.name}</p>
            <p className="tds-text-caption tds-text-tertiary mt-1">
              {new Date(photo.created_at).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>
        </div>
      </div>

      {/* 푸터 */}
      <footer className="py-4 sm:py-6 text-center">
        <p className="tds-text-caption tds-text-tertiary">
          Powered by <span style={{ color: 'var(--accent-primary)' }} className="font-medium">Cloody</span>
        </p>
      </footer>
    </main>
  )
}
