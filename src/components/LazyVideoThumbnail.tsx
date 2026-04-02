'use client'

import { useEffect, useRef, useState, memo } from 'react'
import { toDirectVideoUrl, toProxyUrl } from '@/lib/url-utils'

interface LazyVideoThumbnailProps {
  photoId: string
  videoUrl: string
  thumbnailUrl?: string | null
  className?: string
  onThumbnailGenerated?: (url: string) => void
}

// 동시 생성 제한
const processing = new Set<string>()
const MAX_CONCURRENT = 2

export default memo(function LazyVideoThumbnail({
  photoId,
  videoUrl,
  thumbnailUrl,
  className = '',
  onThumbnailGenerated,
}: LazyVideoThumbnailProps) {
  const [thumbSrc, setThumbSrc] = useState<string | null>(
    thumbnailUrl ? toProxyUrl(thumbnailUrl) : null
  )
  const [generating, setGenerating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const attemptedRef = useRef(false)

  useEffect(() => {
    if (thumbSrc || attemptedRef.current || !containerRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return
        if (attemptedRef.current || processing.size >= MAX_CONCURRENT) return
        attemptedRef.current = true
        observer.disconnect()
        generateThumbnail()
      },
      { rootMargin: '200px' }
    )

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbSrc])

  async function generateThumbnail() {
    if (processing.has(photoId)) return
    processing.add(photoId)
    setGenerating(true)

    try {
      const blob = await captureVideoFrame(toDirectVideoUrl(videoUrl))
      if (!blob) return

      const formData = new FormData()
      formData.append('photoId', photoId)
      formData.append('thumbnail', blob, 'thumb.webp')

      const res = await fetch('/api/thumbnail/video', {
        method: 'POST',
        body: formData,
      })

      if (res.ok) {
        const { thumbnailUrl: newUrl } = await res.json()
        if (newUrl) {
          setThumbSrc(toProxyUrl(newUrl))
          onThumbnailGenerated?.(newUrl)
        }
      }
    } catch (err) {
      console.error('[lazy-thumb] failed:', err)
    } finally {
      processing.delete(photoId)
      setGenerating(false)
    }
  }

  // 썸네일이 이미 있으면 바로 표시
  if (thumbSrc) {
    return <img src={thumbSrc} alt="" className={`w-full h-full object-cover ${className}`} loading="lazy" />
  }

  // 생성 중이거나 대기 중: 플레이 아이콘 플레이스홀더
  return (
    <div ref={containerRef} className={`w-full h-full flex items-center justify-center ${className}`} style={{ background: 'var(--background-tertiary)' }}>
      {generating ? (
        <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--foreground-muted)', borderTopColor: 'transparent' }} />
      ) : (
        <svg className="w-6 h-6 opacity-40" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
    </div>
  )
})

function captureVideoFrame(src: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'

    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }

    const timeout = setTimeout(() => {
      cleanup()
      resolve(null)
    }, 15000)

    video.onloadeddata = () => {
      // 영상 10% 지점 또는 1초 중 작은 값으로 시크
      const seekTo = Math.min(1, video.duration * 0.1)
      video.currentTime = seekTo
    }

    video.onseeked = () => {
      clearTimeout(timeout)
      try {
        const canvas = document.createElement('canvas')
        const size = 400
        const vw = video.videoWidth
        const vh = video.videoHeight
        const ratio = Math.min(size / vw, size / vh)
        canvas.width = Math.round(vw * ratio)
        canvas.height = Math.round(vh * ratio)

        const ctx = canvas.getContext('2d')
        if (!ctx) { cleanup(); resolve(null); return }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => { cleanup(); resolve(blob) },
          'image/webp',
          0.8
        )
      } catch {
        cleanup()
        resolve(null)
      }
    }

    video.onerror = () => {
      clearTimeout(timeout)
      cleanup()
      resolve(null)
    }

    video.src = src
  })
}
