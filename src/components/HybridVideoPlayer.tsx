'use client'

import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react'
import type Hls from 'hls.js'

interface HybridVideoPlayerProps {
  src: string // 원본 비디오 URL
  hlsSrc?: string | null // HLS manifest URL
  hlsStatus?: 'not_applicable' | 'pending' | 'processing' | 'ready' | 'failed'
  poster?: string
  className?: string
  style?: React.CSSProperties
  autoPlay?: boolean
  controls?: boolean
  muted?: boolean
  loop?: boolean
  onEnded?: () => void
  onError?: () => void
  onVideoReady?: (video: HTMLVideoElement | null) => void
  onCanPlay?: () => void
}

type QualityLevel = {
  index: number
  height: number
  width: number
  bitrate: number
  name: string
}

type QualityPreset = 'original' | 'high' | 'medium'

function sortLevelIndices(levels: QualityLevel[]): number[] {
  return [...levels]
    .sort((a, b) => {
      if (b.height !== a.height) return b.height - a.height
      return b.bitrate - a.bitrate
    })
    .map(level => level.index)
}

function pickHlsLevel(levels: QualityLevel[], preset: Exclude<QualityPreset, 'original'>): number {
  const sorted = sortLevelIndices(levels)
  if (sorted.length === 0) return -1
  if (preset === 'high') return sorted[0]
  return sorted[Math.min(1, sorted.length - 1)]
}

export default memo(function HybridVideoPlayer({
  src,
  hlsSrc,
  hlsStatus,
  poster,
  className = '',
  style,
  autoPlay = false,
  controls = true,
  muted = false,
  loop = false,
  onEnded,
  onError,
  onVideoReady,
  onCanPlay,
}: HybridVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const HlsClass = useRef<typeof Hls | null>(null)
  const [currentSource, setCurrentSource] = useState<'original' | 'hls'>('original')
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([])
  const [currentQuality, setCurrentQuality] = useState<number>(-1)
  const [selectedQualityPreset, setSelectedQualityPreset] = useState<QualityPreset>(hlsSrc ? 'high' : 'original')
  const [preferredSource, setPreferredSource] = useState<'original' | 'hls'>(hlsSrc ? 'hls' : 'original')
  const [showQualityMenu, setShowQualityMenu] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const savedTimeRef = useRef<number>(0)

  const sortedLevelIndices = useMemo(() => sortLevelIndices(qualityLevels), [qualityLevels])
  const highLevelIndex = useMemo(() => sortedLevelIndices[0] ?? -1, [sortedLevelIndices])
  const mediumLevelIndex = useMemo(() => sortedLevelIndices[Math.min(1, sortedLevelIndices.length - 1)] ?? -1, [sortedLevelIndices])

  const resolveLevelIndex = useCallback((preset: Exclude<QualityPreset, 'original'>) => {
    return preset === 'high' ? highLevelIndex : mediumLevelIndex
  }, [highLevelIndex, mediumLevelIndex])

  const applyHlsPreset = useCallback((preset: Exclude<QualityPreset, 'original'>) => {
    if (!hlsRef.current) return
    const levelIndex = resolveLevelIndex(preset)
    if (levelIndex >= 0) {
      hlsRef.current.currentLevel = levelIndex
      setCurrentQuality(levelIndex)
    }
  }, [resolveLevelIndex])

  // HLS 초기화 (동적 import로 번들 사이즈 최적화)
  const initHls = useCallback(async (preset: Exclude<QualityPreset, 'original'> = 'high') => {
    const video = videoRef.current
    if (!video || !hlsSrc) return

    if (currentSource === 'hls' && hlsRef.current) {
      applyHlsPreset(preset)
      return
    }

    const resumeAt = video.currentTime || savedTimeRef.current
    const wasPaused = video.paused
    savedTimeRef.current = resumeAt

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

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
      hls.attachMedia(video)

      hls.on(HlsLib.Events.MANIFEST_PARSED, (_event, data) => {
        const levels = data.levels.map((level, index) => ({
          index,
          height: level.height,
          width: level.width,
          bitrate: level.bitrate,
          name: `${level.height}p`,
        }))
        setQualityLevels(levels)

        const targetLevel = pickHlsLevel(levels, preset)
        if (targetLevel >= 0) {
          hls.currentLevel = targetLevel
          setCurrentQuality(targetLevel)
        } else {
          setCurrentQuality(-1)
        }

        setCurrentSource('hls')
        setError(null)
        requestAnimationFrame(() => {
          if (!videoRef.current) return
          videoRef.current.currentTime = resumeAt
          if (!wasPaused) {
            videoRef.current.play().catch(() => {})
          }
        })
      })

      hls.on(HlsLib.Events.LEVEL_SWITCHED, (_event, data) => {
        setCurrentQuality(data.level)
      })

      hls.on(HlsLib.Events.ERROR, (_event, data) => {
        console.error('HLS Error:', data)
        if (!data.fatal) return

        switch (data.type) {
          case HlsLib.ErrorTypes.NETWORK_ERROR:
            hls.startLoad()
            return
          case HlsLib.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError()
            return
          default:
            hls.destroy()
            hlsRef.current = null
            setPreferredSource('original')
            setSelectedQualityPreset('original')
            setCurrentSource('original')
            if (videoRef.current) {
              videoRef.current.src = src
              videoRef.current.currentTime = savedTimeRef.current
              videoRef.current.play().catch(() => {})
            }
            return
        }
      })

      hlsRef.current = hls
      return
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsSrc
      setCurrentSource('hls')
      requestAnimationFrame(() => {
        if (!videoRef.current) return
        videoRef.current.currentTime = resumeAt
        if (!wasPaused) {
          videoRef.current.play().catch(() => {})
        }
      })
    }
  }, [hlsSrc, src, currentSource, applyHlsPreset])

  const switchToOriginal = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    const resumeAt = video.currentTime || savedTimeRef.current
    const wasPaused = video.paused
    savedTimeRef.current = resumeAt

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    setCurrentSource('original')
    setCurrentQuality(-1)
    requestAnimationFrame(() => {
      if (!videoRef.current) return
      videoRef.current.src = src
      videoRef.current.currentTime = resumeAt
      if (!wasPaused) {
        videoRef.current.play().catch(() => {})
      }
    })
  }, [src])

  const handlePresetChange = useCallback(async (preset: QualityPreset) => {
    setShowQualityMenu(false)

    if (preset === 'original') {
      setSelectedQualityPreset('original')
      setPreferredSource('original')
      switchToOriginal()
      return
    }

    setSelectedQualityPreset(preset)
    setPreferredSource('hls')

    if (!hlsSrc || hlsStatus !== 'ready') return

    if (currentSource === 'hls' && hlsRef.current) {
      applyHlsPreset(preset)
      return
    }

    await initHls(preset)
  }, [hlsSrc, hlsStatus, currentSource, applyHlsPreset, initHls, switchToOriginal])

  useEffect(() => {
    if (hlsStatus === 'ready' && hlsSrc && preferredSource === 'hls') {
      void initHls(selectedQualityPreset === 'medium' ? 'medium' : 'high')
    }
  }, [hlsStatus, hlsSrc, preferredSource, selectedQualityPreset, initHls])

  useEffect(() => {
    if (!hlsSrc) {
      setPreferredSource('original')
      setSelectedQualityPreset('original')
      setCurrentSource('original')
    }
  }, [hlsSrc])

  useEffect(() => {
    if (!onVideoReady) return
    onVideoReady(videoRef.current)
    return () => onVideoReady(null)
  }, [onVideoReady])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(max-width: 768px)')
    const handleMediaChange = () => setIsMobileViewport(media.matches)
    handleMediaChange()
    media.addEventListener('change', handleMediaChange)
    return () => media.removeEventListener('change', handleMediaChange)
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
      const orientation = (screen as Screen & { orientation?: { unlock?: () => void } }).orientation
      if (!document.fullscreenElement && orientation?.unlock) {
        try {
          orientation.unlock()
        } catch (error) {
          console.error('[video-player] orientation.unlock failed:', error)
        }
      }
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [])

  const handleLoadStart = () => {
    setIsLoading(true)
    setError(null) // 새 로드 시작시 에러 초기화
  }

  const handleCanPlay = () => {
    setIsLoading(false)
    setError(null)
    onCanPlay?.()
  }

  const handlePlaying = () => {
    setIsLoading(false)
    setError(null)
    onCanPlay?.()
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
    if (selectedQualityPreset === 'original' || currentSource === 'original') return '원본'
    if (selectedQualityPreset === 'high') return '고화질'
    return '중간화질'
  }

  const hasHlsReady = Boolean(hlsSrc && hlsStatus === 'ready')

  const handleToggleMobileFullscreen = useCallback(async () => {
    const video = videoRef.current
    if (!video) return

    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {})
      return
    }

    const webkitVideo = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }

    if (video.requestFullscreen) {
      await video.requestFullscreen().catch(() => {})
      const orientation = (screen as Screen & { orientation?: { lock?: (orientation: string) => Promise<void> } }).orientation
      if (orientation?.lock) {
        await orientation.lock('landscape').catch(() => {})
      }
      return
    }

    if (webkitVideo.webkitEnterFullscreen) {
      webkitVideo.webkitEnterFullscreen()
    }
  }, [])

  return (
    <div className="relative z-20 w-full h-full flex items-center justify-center">
      <video
        ref={videoRef}
        src={currentSource === 'original' ? src : undefined}
        poster={poster}
        autoPlay={autoPlay}
        controls={controls}
        muted={muted}
        loop={loop}
        playsInline
        className={`w-full h-full ${className}`}
        style={{ objectFit: 'contain', ...style }}
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

      {/* 화질 선택 버튼 */}
      {hlsSrc && (
        <div className="absolute top-4 right-4 z-20" data-quality-menu-root onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowQualityMenu(!showQualityMenu)}
            className="px-3 py-1.5 bg-black/70 text-white text-sm rounded-lg hover:bg-black/80 transition-colors"
          >
            {getQualityLabel()}
          </button>

          {showQualityMenu && (
            <div className="absolute top-full right-0 mt-2 bg-black/90 rounded-lg overflow-hidden min-w-[110px]">
              <button
                onClick={() => handlePresetChange('original')}
                className={`block w-full px-4 py-2 text-sm text-left hover:bg-white/10 ${selectedQualityPreset === 'original' ? 'text-blue-400' : 'text-white'}`}
              >
                원본
              </button>
              <button
                onClick={() => handlePresetChange('high')}
                disabled={!hasHlsReady || highLevelIndex < 0}
                className={`block w-full px-4 py-2 text-sm text-left hover:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed ${selectedQualityPreset === 'high' ? 'text-blue-400' : 'text-white'}`}
              >
                고화질
              </button>
              <button
                onClick={() => handlePresetChange('medium')}
                disabled={!hasHlsReady || mediumLevelIndex < 0}
                className={`block w-full px-4 py-2 text-sm text-left hover:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed ${selectedQualityPreset === 'medium' ? 'text-blue-400' : 'text-white'}`}
              >
                중간화질
              </button>
            </div>
          )}
        </div>
      )}

      {/* 모바일 전체화면/가로 전환 버튼 */}
      {isMobileViewport && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void handleToggleMobileFullscreen()
          }}
          className="absolute top-4 left-4 z-20 w-9 h-9 rounded-lg bg-black/70 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
          title={isFullscreen ? '전체화면 종료' : '가로 전체화면'}
        >
          {isFullscreen ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9H5V5m10 0h4v4m0 10v-4h-4M5 15v4h4" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4m12-4v4h-4" />
            </svg>
          )}
        </button>
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
        <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 text-white text-xs rounded">
          {currentSource === 'hls' ? `HLS ${currentQuality >= 0 ? currentQuality : ''}`.trim() : '원본'}
        </div>
      )}
    </div>
  )
})
