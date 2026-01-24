'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useDownload } from '@/lib/download-context'
import { useUser } from '@/lib/user-context'

// R2 URL을 프록시 URL로 즉시 변환
function toProxyUrl(url: string): string {
  if (url.includes('.r2.dev/')) {
    const parts = url.split('.r2.dev/')
    if (parts.length > 1) {
      const fileName = parts[1].split('?')[0]
      return `/api/image/${fileName}`
    }
  }
  if (url.includes('.r2.cloudflarestorage.com/')) {
    const urlObj = new URL(url)
    const pathParts = urlObj.pathname.split('/')
    if (pathParts.length > 2) {
      const fileName = pathParts.slice(2).join('/')
      return `/api/image/${fileName}`
    }
  }
  return url
}

interface Photo {
  id: string
  url: string
  name: string
  order: number
  folder_id: string | null
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

export default function ViewerPage() {
  const [photos, setPhotos] = useState<Photo[]>([])
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
  const { startDownload } = useDownload()
  const { user } = useUser()

  useEffect(() => {
    const fetchPhotos = async () => {
      if (!user?.id) return

      const folderParam = searchParams.get('folder')
      const categoryParam = searchParams.get('category')
      const sortByParam = searchParams.get('sortBy') || 'name'
      const sortOrderParam = searchParams.get('sortOrder') || 'asc'

      let query = supabase.from('photos').select('*').eq('user_id', user.id)

      // 카테고리가 지정된 경우 (사진/동영상/문서 탭) - 전체 파일에서 필터
      let allData: Photo[] = []

      if (categoryParam) {
        // 페이지네이션으로 전체 파일 가져오기 (1000개 limit 우회)
        let from = 0
        const pageSize = 1000

        while (true) {
          const { data: pageData } = await supabase
            .from('photos')
            .select('*')
            .eq('user_id', user.id)
            .order('order', { ascending: true })
            .range(from, from + pageSize - 1)

          if (!pageData || pageData.length === 0) break
          allData.push(...(pageData as Photo[]))
          if (pageData.length < pageSize) break
          from += pageSize
        }
        // ID로 중복 제거 (duplicate key error 방지)
        allData = [...new Map(allData.map(p => [p.id, p])).values()]
      } else if (folderParam) {
        query = query.eq('folder_id', folderParam)
        const { data } = await query
        allData = (data as Photo[]) || []
      } else {
        query = query.is('folder_id', null)
        const { data } = await query
        allData = (data as Photo[]) || []
      }

      if (allData.length > 0) {
        // 카테고리 필터링
        let filteredData = allData
        if (categoryParam) {
          const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif']
          const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'm4v']
          const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'hwp', 'hwpx']

          filteredData = allData.filter(photo => {
            const ext = photo.name?.split('.').pop()?.toLowerCase() || ''
            if (categoryParam === 'photos') return imageExts.includes(ext)
            if (categoryParam === 'videos') return videoExts.includes(ext)
            if (categoryParam === 'documents') return docExts.includes(ext)
            return true
          })
        }

        const sortedData = [...filteredData].sort((a, b) => {
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
  }, [searchParams, user])

  // 이미지 프리로드 (프록시 URL 사용)
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
      const proxyUrl = toProxyUrl(originalUrl)

      if (proxyUrl && !loadedImages.has(originalUrl)) {
        const img = new Image()
        img.onload = () => {
          setLoadedImages(prev => new Set(prev).add(originalUrl))
        }
        img.src = proxyUrl
      }
    })
  }, [currentIndex, photos, loadedImages])

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
  const currentSignedUrl = toProxyUrl(currentPhoto.url)

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

        {/* 이미지/비디오 */}
        {currentPhoto.is_video || currentPhoto.name.match(/\.(mp4|webm|mov|avi|mkv)$/i) ? (
          <video
            key={currentPhoto.url}
            src={currentSignedUrl}
            controls
            autoPlay
            playsInline
            className="max-h-screen max-w-full object-contain"
            onLoadedData={() => setImageLoading(false)}
            onCanPlay={() => setImageLoading(false)}
          />
        ) : (
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
        )}

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

      {/* 하단 컨트롤 - 여러 개일 때만 표시 */}
      {photos.length > 1 && (
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
      )}

      {/* 공유 모달 - TDS Sheet 스타일 */}
      {showShareModal && shareUrl && (
        <div
          className="tds-sheet-backdrop"
          onClick={() => setShowShareModal(false)}
        >
          <div
            className="tds-sheet"
            onClick={e => e.stopPropagation()}
          >
            <div className="tds-sheet-handle" />

            {/* 헤더 */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                </div>
                <h3 className="tds-text-title">공유 링크</h3>
              </div>
              <button
                onClick={() => setShowShareModal(false)}
                className="tds-header-action"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="tds-text-body tds-text-tertiary mb-5">
              이 링크를 공유하면 누구나 이 파일을 볼 수 있습니다.
            </p>

            {/* URL 입력 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={shareUrl}
                readOnly
                className="tds-input flex-1 truncate"
              />
              <button
                onClick={copyToClipboard}
                className={`tds-btn ${copied ? '' : 'tds-btn-primary'}`}
                style={copied ? { background: 'var(--success, #00c853)', color: 'white' } : undefined}
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
