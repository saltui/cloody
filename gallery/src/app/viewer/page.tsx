'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSignedUrl } from '@/lib/signed-url-context'
import { useDownload } from '@/lib/download-context'

interface Photo {
  id: string
  url: string
  name: string
  order: number
  folder_id: string | null
  created_at: string
}

export default function ViewerPage() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [imageLoading, setImageLoading] = useState(true)
  const [showUI, setShowUI] = useState(true)
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set())
  const [sharing, setSharing] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [copied, setCopied] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { getSignedUrls } = useSignedUrl()
  const { startDownload } = useDownload()

  useEffect(() => {
    const fetchPhotos = async () => {
      const folderParam = searchParams.get('folder')
      const sortByParam = searchParams.get('sortBy') || 'name'
      const sortOrderParam = searchParams.get('sortOrder') || 'asc'

      let query = supabase.from('photos').select('*')

      if (folderParam) {
        query = query.eq('folder_id', folderParam)
      } else {
        query = query.is('folder_id', null)
      }

      const { data } = await query

      if (data) {
        const sortedData = [...data].sort((a, b) => {
          if (sortByParam === 'name') {
            const nameA = (a.name || a.url.split('/').pop() || '').toLowerCase()
            const nameB = (b.name || b.url.split('/').pop() || '').toLowerCase()
            return sortOrderParam === 'asc'
              ? nameA.localeCompare(nameB, 'ko')
              : nameB.localeCompare(nameA, 'ko')
          } else {
            const dateA = new Date(a.created_at).getTime()
            const dateB = new Date(b.created_at).getTime()
            return sortOrderParam === 'asc' ? dateA - dateB : dateB - dateA
          }
        })

        setPhotos(sortedData)
        const indexParam = searchParams.get('index')
        if (indexParam) {
          setCurrentIndex(Math.min(parseInt(indexParam), sortedData.length - 1))
        }
      }
      setLoading(false)
    }

    fetchPhotos()
  }, [searchParams])

  // Signed URL 가져오기 (현재 + 앞뒤 이미지)
  useEffect(() => {
    if (photos.length === 0) return

    const fetchUrls = async () => {
      const indicesToLoad = [
        currentIndex - 2,
        currentIndex - 1,
        currentIndex,
        currentIndex + 1,
        currentIndex + 2,
      ].filter(i => i >= 0 && i < photos.length)

      const urlsToSign = indicesToLoad
        .map(i => photos[i].url)
        .filter(url => !signedUrls[url])

      if (urlsToSign.length > 0) {
        const signed = await getSignedUrls(urlsToSign)
        setSignedUrls(prev => ({ ...prev, ...signed }))
      }
    }

    fetchUrls()
  }, [currentIndex, photos, getSignedUrls, signedUrls])

  // 이미지 프리로드 (signed URL 사용)
  useEffect(() => {
    if (photos.length === 0) return

    const preloadIndices = [
      currentIndex - 2,
      currentIndex - 1,
      currentIndex,
      currentIndex + 1,
      currentIndex + 2,
    ].filter(i => i >= 0 && i < photos.length)

    preloadIndices.forEach(idx => {
      const originalUrl = photos[idx].url
      const url = signedUrls[originalUrl] || originalUrl

      if (url && !loadedImages.has(originalUrl)) {
        const img = new Image()
        img.onload = () => {
          setLoadedImages(prev => new Set(prev).add(originalUrl))
        }
        img.src = url
      }
    })
  }, [currentIndex, photos, signedUrls, loadedImages])

  // 현재 이미지 로딩 상태 관리
  useEffect(() => {
    if (photos.length === 0) return
    const currentUrl = photos[currentIndex]?.url
    if (currentUrl && loadedImages.has(currentUrl)) {
      setImageLoading(false)
    } else {
      setImageLoading(true)
    }
  }, [currentIndex, photos, loadedImages])

  const goNext = useCallback(() => {
    if (currentIndex < photos.length - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }, [currentIndex, photos.length])

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }, [currentIndex])

  const goBack = useCallback(() => {
    router.back()
  }, [router])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft') {
        goPrev()
      } else if (e.key === 'Escape') {
        goBack()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goNext, goPrev, goBack])

  // 터치/스와이프 지원
  const [touchStart, setTouchStart] = useState<number | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX)
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null) return

    const touchEnd = e.changedTouches[0].clientX
    const diff = touchStart - touchEnd

    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        goNext()
      } else {
        goPrev()
      }
    }

    setTouchStart(null)
  }

  const handleImageLoad = () => {
    const currentUrl = photos[currentIndex]?.url
    if (currentUrl) {
      setLoadedImages(prev => new Set(prev).add(currentUrl))
      setImageLoading(false)
    }
  }

  // 현재 이미지 다운로드
  const handleDownload = async () => {
    if (!photos[currentIndex]) return
    const photo = photos[currentIndex]
    await startDownload([{
      id: photo.id,
      name: photo.name,
      url: photo.url,
    }])
  }

  // 공유 링크 생성
  const handleShare = async () => {
    if (!photos[currentIndex]) return
    setSharing(true)

    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: photos[currentIndex].id }),
      })

      if (!res.ok) throw new Error('Failed to create share link')

      const { shareUrl } = await res.json()
      setShareUrl(shareUrl)
      setShowShareModal(true)
    } catch (error) {
      console.error('Share error:', error)
      alert('공유 링크 생성에 실패했습니다.')
    } finally {
      setSharing(false)
    }
  }

  // 클립보드 복사
  const copyToClipboard = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 폴백: 텍스트 선택
      const textArea = document.createElement('textarea')
      textArea.value = shareUrl
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center safe-area-top safe-area-bottom">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
            <div className="w-6 h-6 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
          </div>
        </div>
      </main>
    )
  }

  if (photos.length === 0) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center safe-area-top safe-area-bottom">
        <div className="text-center animate-fade-in">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center bg-zinc-800/50">
            <svg className="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-zinc-400 font-medium">이미지가 없습니다</p>
        </div>
      </main>
    )
  }

  const currentPhoto = photos[currentIndex]
  const currentSignedUrl = signedUrls[currentPhoto.url] || currentPhoto.url

  return (
    <main
      className="min-h-screen bg-black flex flex-col safe-area-top safe-area-bottom"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 헤더 */}
      <header
        className={`fixed top-0 left-0 right-0 z-10 transition-all duration-300 safe-area-top ${
          showUI ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'
        }`}
      >
        <div className="bg-gradient-to-b from-black/90 via-black/60 to-transparent">
          <div className="flex items-center justify-between px-3 sm:px-4 py-3 sm:py-4">
            {/* 닫기 버튼 */}
            <button
              onClick={goBack}
              className="w-11 h-11 sm:w-10 sm:h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/20 active:scale-95 transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* 카운터 */}
            <div className="px-4 py-2 rounded-full bg-white/10 backdrop-blur-md">
              <span className="text-sm font-medium text-white">
                {currentIndex + 1} <span className="text-white/60">/</span> {photos.length}
              </span>
            </div>

            {/* 액션 버튼들 */}
            <div className="flex items-center gap-2">
              {/* 공유 버튼 */}
              <button
                onClick={handleShare}
                disabled={sharing}
                className="w-11 h-11 sm:w-10 sm:h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/20 active:scale-95 transition-all disabled:opacity-50"
              >
                {sharing ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                )}
              </button>
              {/* 다운로드 버튼 */}
              <button
                onClick={handleDownload}
                className="w-11 h-11 sm:w-10 sm:h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/20 active:scale-95 transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            </div>
          </div>

          {/* 파일명 */}
          <div className="px-4 pb-4">
            <p className="text-sm text-white/70 truncate text-center max-w-xs sm:max-w-md mx-auto">
              {currentPhoto.name}
            </p>
          </div>
        </div>
      </header>

      {/* 이미지 영역 */}
      <div
        className="flex-1 flex items-center justify-center relative"
        onClick={() => setShowUI(!showUI)}
      >
        {/* 이전 버튼 - 데스크탑 */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            goPrev()
          }}
          disabled={currentIndex === 0}
          className={`hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 backdrop-blur-md items-center justify-center text-white disabled:opacity-0 hover:bg-white/20 active:scale-95 transition-all z-10 ${
            showUI ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* 로딩 스피너 */}
        {imageLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-5">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)' }}>
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          </div>
        )}

        {/* 이미지 */}
        <img
          key={currentPhoto.url}
          src={currentSignedUrl}
          alt=""
          className={`max-h-screen max-w-full object-contain select-none transition-opacity duration-300 ${
            imageLoading ? 'opacity-0' : 'opacity-100'
          }`}
          draggable={false}
          onLoad={handleImageLoad}
        />

        {/* 다음 버튼 - 데스크탑 */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            goNext()
          }}
          disabled={currentIndex === photos.length - 1}
          className={`hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 backdrop-blur-md items-center justify-center text-white disabled:opacity-0 hover:bg-white/20 active:scale-95 transition-all z-10 ${
            showUI ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* 하단 컨트롤 - 모바일 */}
      <div
        className={`fixed bottom-0 left-0 right-0 transition-all duration-300 safe-area-bottom ${
          showUI ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full pointer-events-none'
        }`}
      >
        <div className="bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-8 pb-4 sm:pb-6 px-4">
          {/* 프로그레스 바 */}
          <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden mb-4">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${((currentIndex + 1) / photos.length) * 100}%`,
                background: 'var(--accent-primary)'
              }}
            />
          </div>

          {/* 모바일 네비게이션 버튼 */}
          <div className="flex sm:hidden items-center justify-center gap-8">
            <button
              onClick={(e) => {
                e.stopPropagation()
                goPrev()
              }}
              disabled={currentIndex === 0}
              className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white disabled:opacity-30 active:scale-95 transition-all"
            >
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                goNext()
              }}
              disabled={currentIndex === photos.length - 1}
              className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white disabled:opacity-30 active:scale-95 transition-all"
            >
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* 공유 모달 */}
      {showShareModal && shareUrl && (
        <div
          className="modal-backdrop animate-fade-in"
          onClick={() => setShowShareModal(false)}
        >
          <div
            className="modal-content w-full max-w-sm mx-4 animate-fade-in-scale"
            style={{ background: '#1c1c1e' }}
            onClick={e => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
                  <svg className="w-5 h-5" style={{ color: 'var(--accent-text)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white">공유 링크</h3>
              </div>
              <button
                onClick={() => setShowShareModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-zinc-400 mb-5">
              이 링크를 공유하면 누구나 이 파일을 볼 수 있습니다.
            </p>

            {/* URL 입력 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={shareUrl}
                readOnly
                className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm text-white truncate focus:outline-none focus:border-white/20"
              />
              <button
                onClick={copyToClipboard}
                className="px-5 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-95"
                style={{
                  background: copied ? 'rgb(34, 197, 94)' : 'var(--accent-primary)',
                  color: copied ? 'white' : 'var(--accent-text)'
                }}
              >
                {copied ? '복사됨' : '복사'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
