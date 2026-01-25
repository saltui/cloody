'use client'

import { useEffect, useRef, useState, useCallback, memo } from 'react'
import type Hls from 'hls.js'

interface HybridVideoPlayerProps {
  src: string // 원본 비디오 URL
  hlsSrc?: string | null // HLS manifest URL
  hlsStatus?: 'not_applicable' | 'pending' | 'processing' | 'ready' | 'failed'
  poster?: string
  className?: string
  autoPlay?: boolean
  controls?: boolean
  muted?: boolean
  loop?: boolean
  onEnded?: () => void
  onError?: () => void
}

type QualityLevel = {
  height: number
  width: number
  bitrate: number
  name: string
}

export default memo(function HybridVideoPlayer({
  src,
  hlsSrc,
  hlsStatus,
  poster,
  className = '',
  autoPlay = false,
  controls = true,
  muted = false,
  loop = false,
  onEnded,
  onError,
}: HybridVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const HlsClass = useRef<typeof Hls | null>(null)
  const [currentSource, setCurrentSource] = useState<'original' | 'hls'>('original')
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([])
  const [currentQuality, setCurrentQuality] = useState<number>(-1) // -1 = auto
  const [showQualityMenu, setShowQualityMenu] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const savedTimeRef = useRef<number>(0)

  // HLS 초기화 (동적 import로 번들 사이즈 최적화)
  const initHls = useCallback(async () => {
    if (!videoRef.current || !hlsSrc) return

    // 이미 HLS 사용 중이면 무시
    if (currentSource === 'hls') return

    // 기존 HLS 인스턴스 정리
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    // HLS.js 동적 로드
    if (!HlsClass.current) {
      try {
        const HlsModule = await import('hls.js')
        HlsClass.current = HlsModule.default
      } catch (e) {
        console.error('Failed to load hls.js:', e)
        return
      }
    }

    const HlsLib = HlsClass.current

    if (HlsLib.isSupported()) {
      const hls = new HlsLib({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 600,
      })

      hls.loadSource(hlsSrc)
      hls.attachMedia(videoRef.current)

      hls.on(HlsLib.Events.MANIFEST_PARSED, (_event, data) => {
        const levels = data.levels.map((level) => ({
          height: level.height,
          width: level.width,
          bitrate: level.bitrate,
          name: `${level.height}p`,
        }))
        setQualityLevels(levels)

        // 현재 재생 위치 저장하고 HLS로 전환
        if (videoRef.current) {
          savedTimeRef.current = videoRef.current.currentTime
          setCurrentSource('hls')

          // 재생 위치 복원
          videoRef.current.currentTime = savedTimeRef.current
          if (!videoRef.current.paused) {
            videoRef.current.play()
          }
        }
      })

      hls.on(HlsLib.Events.LEVEL_SWITCHED, (_event, data) => {
        setCurrentQuality(data.level)
      })

      hls.on(HlsLib.Events.ERROR, (_event, data) => {
        console.error('HLS Error:', data)
        if (data.fatal) {
          // HLS 오류 시 원본으로 폴백
          switch (data.type) {
            case HlsLib.ErrorTypes.NETWORK_ERROR:
              console.log('HLS network error, trying to recover...')
              hls.startLoad()
              break
            case HlsLib.ErrorTypes.MEDIA_ERROR:
              console.log('HLS media error, trying to recover...')
              hls.recoverMediaError()
              break
            default:
              console.log('HLS fatal error, falling back to original')
              hls.destroy()
              hlsRef.current = null
              setCurrentSource('original')
              if (videoRef.current) {
                videoRef.current.src = src
                videoRef.current.currentTime = savedTimeRef.current
                videoRef.current.play()
              }
              break
          }
        }
      })

      hlsRef.current = hls
    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari는 네이티브 HLS 지원
      videoRef.current.src = hlsSrc
      setCurrentSource('hls')
    }
  }, [hlsSrc, src, currentSource])

  // HLS가 준비되면 전환
  useEffect(() => {
    if (hlsStatus === 'ready' && hlsSrc) {
      initHls()
    }
  }, [hlsStatus, hlsSrc, initHls])

  // 컴포넌트 정리
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [])

  // 화질 변경
  const handleQualityChange = (level: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level
      setCurrentQuality(level)
    }
    setShowQualityMenu(false)
  }

  // 자동 화질
  const handleAutoQuality = () => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = -1
      setCurrentQuality(-1)
    }
    setShowQualityMenu(false)
  }

  const handleLoadStart = () => {
    setIsLoading(true)
    setError(null) // 새 로드 시작시 에러 초기화
  }

  const handleCanPlay = () => {
    setIsLoading(false)
    setError(null)
  }

  const handlePlaying = () => {
    setIsLoading(false)
    setError(null)
  }

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget
    // src가 없는 경우는 무시 (HLS 전환 중일 수 있음)
    if (!video.src || video.src === window.location.href) {
      return
    }
    console.error('Video error:', video.error)
    setError('비디오를 재생할 수 없습니다')
    setIsLoading(false)
    onError?.()
  }

  const getQualityLabel = () => {
    if (currentSource === 'original') return '원본'
    if (currentQuality === -1) return '자동'
    return qualityLevels[currentQuality]?.name || '자동'
  }

  return (
    <div className="relative inline-block">
      <video
        ref={videoRef}
        src={currentSource === 'original' ? src : undefined}
        poster={poster}
        autoPlay={autoPlay}
        controls={controls}
        muted={muted}
        loop={loop}
        playsInline
        className={`${className}`}
        style={{ objectFit: 'contain' }}
        onLoadStart={handleLoadStart}
        onCanPlay={handleCanPlay}
        onPlaying={handlePlaying}
        onEnded={onEnded}
        onError={handleError}
      />

      {/* 로딩 인디케이터 */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* 에러 표시 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-white text-center">
            <svg className="w-12 h-12 mx-auto mb-2 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* 화질 선택 버튼 (HLS 사용 중일 때만) */}
      {currentSource === 'hls' && qualityLevels.length > 0 && !controls && (
        <div className="absolute bottom-4 right-4">
          <button
            onClick={() => setShowQualityMenu(!showQualityMenu)}
            className="px-3 py-1.5 bg-black/70 text-white text-sm rounded-lg hover:bg-black/80 transition-colors"
          >
            {getQualityLabel()}
          </button>

          {showQualityMenu && (
            <div className="absolute bottom-full right-0 mb-2 bg-black/90 rounded-lg overflow-hidden">
              <button
                onClick={handleAutoQuality}
                className={`block w-full px-4 py-2 text-sm text-left hover:bg-white/10 ${currentQuality === -1 ? 'text-blue-400' : 'text-white'}`}
              >
                자동
              </button>
              {qualityLevels.map((level, index) => (
                <button
                  key={index}
                  onClick={() => handleQualityChange(index)}
                  className={`block w-full px-4 py-2 text-sm text-left hover:bg-white/10 ${currentQuality === index ? 'text-blue-400' : 'text-white'}`}
                >
                  {level.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* HLS 상태 배지 */}
      {hlsStatus && hlsStatus !== 'not_applicable' && hlsStatus !== 'ready' && (
        <div className="absolute top-2 left-2">
          <span className={`px-2 py-1 text-xs rounded-full ${
            hlsStatus === 'pending' ? 'bg-yellow-500/80 text-yellow-100' :
            hlsStatus === 'processing' ? 'bg-blue-500/80 text-blue-100' :
            'bg-red-500/80 text-red-100'
          }`}>
            {hlsStatus === 'pending' && '변환 대기'}
            {hlsStatus === 'processing' && '변환 중...'}
            {hlsStatus === 'failed' && '변환 실패'}
          </span>
        </div>
      )}

      {/* 소스 표시 (디버그용, 필요시 제거) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="absolute top-2 right-2 px-2 py-1 bg-black/70 text-white text-xs rounded">
          {currentSource === 'hls' ? 'HLS' : '원본'}
        </div>
      )}
    </div>
  )
})
