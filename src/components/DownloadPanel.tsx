'use client'

import { useDownload } from '@/lib/download-context'
import { useTheme } from '@/lib/theme'

export default function DownloadPanel() {
  const { theme } = useTheme()
  const {
    downloading,
    downloadQueue,
    downloadProgress,
    showDownloadPanel,
    setShowDownloadPanel,
    removeFromDownloadQueue,
    clearCompletedDownloads,
    clearAllDownloads,
    zipProgress,
    isZipDownloading,
    cancelZipDownload,
  } = useDownload()

  const isDark = theme === 'dark'

  // 다운로드 중이거나 큐에 항목이 있거나 ZIP 다운로드 중일 때만 표시
  if (!downloading && downloadQueue.length === 0 && !isZipDownloading && !zipProgress) return null

  const completedCount = downloadQueue.filter(item => item.status === 'done').length
  const hasCompleted = completedCount > 0

  // ZIP 다운로드 진행률 패널
  if (isZipDownloading || zipProgress) {
    const getZipStatusText = () => {
      if (!zipProgress) return '준비 중...'
      switch (zipProgress.phase) {
        case 'preparing': return '파일 정보 수집 중...'
        case 'downloading': return `파일 다운로드 중 (${zipProgress.current}/${zipProgress.total})`
        case 'zipping': return `ZIP 파일 생성 중 (${zipProgress.current}%)`
        case 'done': return '다운로드 완료!'
        case 'error': return zipProgress.error || '오류 발생'
        default: return '처리 중...'
      }
    }

    const getZipProgress = () => {
      if (!zipProgress) return 0
      switch (zipProgress.phase) {
        case 'preparing': return 0
        case 'downloading': return zipProgress.total > 0 ? (zipProgress.current / zipProgress.total) * 70 : 0
        case 'zipping': return 70 + (zipProgress.current / 100) * 30
        case 'done': return 100
        default: return 0
      }
    }

    return (
      <div className={`fixed bottom-20 left-6 z-[9999] w-80 rounded-xl shadow-2xl overflow-hidden ${isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-gray-200'}`}>
        <div className={`flex items-center justify-between px-4 py-3 ${isDark ? 'bg-zinc-800' : 'bg-gray-50'}`}>
          <div className="flex items-center gap-2">
            {zipProgress?.phase === 'done' ? (
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : zipProgress?.phase === 'error' ? (
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <div className={`w-5 h-5 border-2 rounded-full animate-spin ${isDark ? 'border-zinc-600 border-t-white' : 'border-gray-300 border-t-green-500'}`} />
            )}
            <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
              ZIP 다운로드
            </span>
          </div>
          {zipProgress?.phase !== 'done' && zipProgress?.phase !== 'error' && (
            <button
              onClick={cancelZipDownload}
              className={`p-1.5 rounded transition-colors ${isDark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-gray-200 text-gray-500'}`}
              title="취소"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* ZIP 프로그레스 바 */}
        <div className={`h-1.5 ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`}>
          <div
            className={`h-full transition-all duration-300 ${zipProgress?.phase === 'error' ? 'bg-red-500' : 'bg-green-500'}`}
            style={{ width: `${getZipProgress()}%` }}
          />
        </div>

        {/* 상태 표시 */}
        <div className="px-4 py-3">
          <p className={`text-sm ${zipProgress?.phase === 'error' ? 'text-red-500' : (isDark ? 'text-zinc-300' : 'text-gray-600')}`}>
            {getZipStatusText()}
          </p>
          {zipProgress?.currentFile && zipProgress.phase === 'downloading' && (
            <p className={`text-xs mt-1 truncate ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
              {zipProgress.currentFile}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`fixed bottom-20 left-6 z-[9999] w-80 rounded-xl shadow-2xl overflow-hidden ${isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-gray-200'}`}>
      <div className={`flex items-center justify-between px-4 py-3 ${isDark ? 'bg-zinc-800' : 'bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          {downloading ? (
            <div className={`w-5 h-5 border-2 rounded-full animate-spin ${isDark ? 'border-zinc-600 border-t-white' : 'border-gray-300 border-t-green-500'}`} />
          ) : (
            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {downloading ? `다운로드 중 (${downloadProgress.current}/${downloadProgress.total})` : '다운로드 완료'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* 완료된 항목 모두 지우기 */}
          {hasCompleted && !downloading && (
            <button
              onClick={clearCompletedDownloads}
              className={`p-1.5 rounded transition-colors ${isDark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-gray-200 text-gray-500'}`}
              title="완료된 항목 지우기"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setShowDownloadPanel(!showDownloadPanel)}
            className={`p-1.5 rounded transition-colors ${isDark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-gray-200 text-gray-500'}`}
          >
            <svg className={`w-4 h-4 transition-transform ${showDownloadPanel ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!downloading && (
            <button
              onClick={clearAllDownloads}
              className={`p-1.5 rounded transition-colors ${isDark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-gray-200 text-gray-500'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 프로그레스 바 */}
      {downloading && (
        <div className={`h-1 ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`}>
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${(downloadProgress.current / downloadProgress.total) * 100}%` }}
          />
        </div>
      )}

      {/* 파일 리스트 */}
      {showDownloadPanel && (
        <div className="max-h-64 overflow-y-auto">
          {downloadQueue.map((item) => (
            <div key={item.id} className={`flex items-center gap-3 px-4 py-2 ${isDark ? 'border-t border-zinc-800' : 'border-t border-gray-100'}`}>
              <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${
                item.status === 'done' ? 'bg-green-500/10' :
                item.status === 'downloading' ? 'bg-green-500/10' :
                item.status === 'error' ? 'bg-red-500/10' :
                (isDark ? 'bg-zinc-800' : 'bg-gray-100')
              }`}>
                {item.status === 'done' && (
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {item.status === 'downloading' && (
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                )}
                {item.status === 'error' && (
                  <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className={`text-sm truncate block ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>{item.name}</span>
                {item.status === 'downloading' && item.progress !== undefined && (
                  <div className={`mt-1 h-1 rounded-full overflow-hidden ${isDark ? 'bg-zinc-700' : 'bg-gray-200'}`}>
                    <div
                      className="h-full bg-green-500 transition-all duration-200"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
              </div>

              {/* 완료된 항목 개별 삭제 */}
              {item.status === 'done' && (
                <button
                  onClick={() => removeFromDownloadQueue(item.id)}
                  className={`p-1 rounded opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity ${isDark ? 'hover:bg-zinc-700 text-zinc-500' : 'hover:bg-gray-200 text-gray-400'}`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}

              <span className={`text-xs flex-shrink-0 ${
                item.status === 'done' ? 'text-green-500' :
                item.status === 'downloading' ? 'text-green-500' :
                item.status === 'error' ? 'text-red-500' :
                (isDark ? 'text-zinc-500' : 'text-gray-400')
              }`}>
                {item.status === 'done' ? '완료' :
                 item.status === 'downloading' ? `${item.progress || 0}%` :
                 item.status === 'error' ? '실패' : '대기'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
