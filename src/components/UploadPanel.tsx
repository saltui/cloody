'use client'

import { useState, useMemo } from 'react'
import { useUpload, type UploadItem } from '@/lib/upload-context'
import { useTheme } from '@/lib/theme'

type FilterType = 'all' | 'done' | 'cancelled' | 'error'

// 파일 확장자 추출
function getFileExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toUpperCase() || ''
  return ext.length <= 5 ? ext : ext.slice(0, 4)
}

// 파일 크기 포맷
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// 남은 시간 계산
function getTimeRemaining(item: UploadItem): string | null {
  if (!item.startedAt || !item.uploadedSize || !item.fileSize || item.uploadedSize === 0) return null
  const elapsed = Date.now() - item.startedAt
  const speed = item.uploadedSize / elapsed // bytes per ms
  if (speed === 0) return null
  const remaining = (item.fileSize - item.uploadedSize) / speed
  const seconds = Math.round(remaining / 1000)
  if (seconds < 60) return `${seconds}초 남음`
  return `${Math.round(seconds / 60)}분 남음`
}

export default function UploadPanel() {
  const { theme } = useTheme()
  const {
    uploading,
    uploadQueue,
    uploadProgress,
    showUploadPanel,
    setShowUploadPanel,
    removeFromQueue,
    cancelItem,
    cancelAll,
    clearCompleted,
    clearAll,
  } = useUpload()

  const [filter, setFilter] = useState<FilterType>('all')
  const isDark = theme === 'dark'

  // 필터링된 항목
  const filteredItems = useMemo(() => {
    if (filter === 'all') return uploadQueue.filter(item => item.status !== 'cancelled')
    if (filter === 'done') return uploadQueue.filter(item => item.status === 'done')
    if (filter === 'cancelled') return uploadQueue.filter(item => item.status === 'cancelled')
    if (filter === 'error') return uploadQueue.filter(item => item.status === 'error')
    return uploadQueue
  }, [uploadQueue, filter])

  // 상태별 카운트
  const counts = useMemo(() => ({
    all: uploadQueue.filter(item => item.status !== 'cancelled').length,
    done: uploadQueue.filter(item => item.status === 'done').length,
    cancelled: uploadQueue.filter(item => item.status === 'cancelled').length,
    error: uploadQueue.filter(item => item.status === 'error').length,
  }), [uploadQueue])

  // 전체 진행률 계산
  const totalProgress = useMemo(() => {
    const activeItems = uploadQueue.filter(item =>
      item.status === 'uploading' || item.status === 'pending' || item.status === 'done'
    )
    if (activeItems.length === 0) return 0
    const totalSize = activeItems.reduce((sum, item) => sum + (item.fileSize || 0), 0)
    const uploadedSize = activeItems.reduce((sum, item) => {
      if (item.status === 'done') return sum + (item.fileSize || 0)
      return sum + (item.uploadedSize || 0)
    }, 0)
    return totalSize > 0 ? (uploadedSize / totalSize) * 100 : 0
  }, [uploadQueue])

  const footerProgressPercent = useMemo(() => {
    if (uploadProgress.total <= 0) return 0
    const value = (uploadProgress.current / uploadProgress.total) * 100
    return Math.max(0, Math.min(100, value))
  }, [uploadProgress.current, uploadProgress.total])

  // 업로드 중이거나 큐에 항목이 있을 때만 표시
  if (!uploading && uploadQueue.length === 0) return null

  const uploadingCount = uploadQueue.filter(item => item.status === 'uploading').length
  const pendingCount = uploadQueue.filter(item => item.status === 'pending').length
  const activeCount = uploadingCount + pendingCount

  // 링크 복사
  const copyLink = async (url?: string) => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      // TODO: toast notification
    } catch {
      // ignore
    }
  }

  // 상태 아이콘
  const StatusIcon = ({ status }: { status: UploadItem['status'] }) => {
    switch (status) {
      case 'done':
        return (
          <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      case 'uploading':
        return (
          <svg className="w-5 h-5 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )
      case 'pending':
        return (
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      case 'error':
        return (
          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      case 'cancelled':
        return (
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        )
      default:
        return null
    }
  }

  // 상태 텍스트
  const getStatusText = (item: UploadItem): string => {
    switch (item.status) {
      case 'done':
        return item.folderName ? `다음에 저장됨: ${item.folderName}` : '업로드 완료'
      case 'uploading':
        const sizeInfo = item.fileSize && item.uploadedSize
          ? `업로드 중, ${formatSize(item.uploadedSize)} / ${formatSize(item.fileSize)}`
          : '업로드 중...'
        const timeInfo = getTimeRemaining(item)
        return timeInfo ? `${sizeInfo} - ${timeInfo}` : sizeInfo
      case 'pending':
        return '대기 중...'
      case 'error':
        return '업로드 실패'
      case 'cancelled':
        return '취소됨'
      default:
        return ''
    }
  }

  return (
    <div className={`upload-panel fixed bottom-6 right-6 z-[9999] w-96 rounded-2xl shadow-2xl overflow-hidden hidden xl:block transition-all duration-300 ${isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-gray-200'}`}>
      {/* 헤더 */}
      <div className={`flex items-center justify-between px-5 py-4 ${isDark ? 'border-b border-zinc-800' : 'border-b border-gray-100'}`}>
        <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>업로드</h3>
        <div className="flex items-center gap-2">
          {uploading && (
            <button
              onClick={cancelAll}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
            >
              모두 취소
            </button>
          )}
          <button
            onClick={() => setShowUploadPanel(!showUploadPanel)}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            <svg className={`w-5 h-5 transition-transform duration-200 ${showUploadPanel ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={clearAll}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {showUploadPanel && (
        <>
          {/* 필터 탭 */}
          <div className={`flex gap-2 px-5 py-3 ${isDark ? 'border-b border-zinc-800' : 'border-b border-gray-100'}`}>
            {[
              { id: 'all' as FilterType, label: '모든 업로드' },
              { id: 'done' as FilterType, label: '완료됨' },
              { id: 'cancelled' as FilterType, label: '건너뜀' },
              { id: 'error' as FilterType, label: '실패' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  filter === tab.id
                    ? (isDark ? 'bg-zinc-700 text-white' : 'bg-gray-900 text-white')
                    : (isDark ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
                }`}
              >
                {tab.label}
                {counts[tab.id] > 0 && ` (${counts[tab.id]})`}
              </button>
            ))}
          </div>

          {/* 섹션 타이틀 */}
          <div className={`px-5 py-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            <span className="text-xs font-medium">업로드 대상 파일</span>
          </div>

          {/* 파일 리스트 */}
          <div className="max-h-80 overflow-y-auto">
            {filteredItems.length === 0 ? (
              <div className={`px-5 py-8 text-center ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
                <span className="text-sm">항목이 없습니다</span>
              </div>
            ) : (
              filteredItems.map((item) => (
                <div
                  key={item.id}
                  className={`px-5 py-3 ${isDark ? 'hover:bg-zinc-800/50' : 'hover:bg-gray-50'} transition-colors`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <StatusIcon status={item.status} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${isDark ? 'bg-zinc-700 text-zinc-300' : 'bg-gray-200 text-gray-600'}`}>
                          {item.fileType || getFileExtension(item.name)}
                        </span>
                        <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                          {getStatusText(item)}
                        </span>
                      </div>
                      {/* 진행률 바 */}
                      {item.status === 'uploading' && (
                        <div className={`mt-2 h-1 rounded-full overflow-hidden ${isDark ? 'bg-zinc-700' : 'bg-gray-200'}`}>
                          <div
                            className="h-full bg-blue-500 transition-all duration-200"
                            style={{ width: `${item.progress || 0}%` }}
                          />
                        </div>
                      )}
                    </div>
                    {/* 액션 버튼 */}
                    <div className="flex-shrink-0">
                      {item.status === 'done' && item.url ? (
                        <button
                          onClick={() => copyLink(item.url)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                        >
                          링크 복사
                        </button>
                      ) : (item.status === 'uploading' || item.status === 'pending') ? (
                        <button
                          onClick={() => cancelItem(item.id)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                        >
                          취소
                        </button>
                      ) : item.status === 'error' || item.status === 'cancelled' ? (
                        <button
                          onClick={() => removeFromQueue(item.id)}
                          className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-zinc-800 text-zinc-500' : 'hover:bg-gray-100 text-gray-400'}`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* 하단 상태 바 */}
      <div className={`relative overflow-hidden text-white ${uploading ? 'bg-blue-700' : 'bg-emerald-500'}`}>
        {uploading && (
          <div
            className="absolute left-0 top-0 bottom-0 bg-blue-500 transition-all duration-300 ease-out"
            style={{ width: `${footerProgressPercent}%` }}
          />
        )}
        <div className="relative z-10 flex items-center gap-4 px-5 py-4">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${uploading ? 'bg-blue-600/90' : 'bg-emerald-600'}`}>
            {uploading ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">
              {uploading
                ? `항목 ${uploadProgress.total}개 중 ${uploadProgress.current}개 업로드 중`
                : '업로드 완료'
              }
            </p>
            <p className="text-xs opacity-80">
              {`업로드 ${uploadProgress.current}/${uploadProgress.total}개 완료`}
            </p>
          </div>
          {!uploading && counts.done > 0 && (
            <button
              onClick={clearCompleted}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
            >
              지우기
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
