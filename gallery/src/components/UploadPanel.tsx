'use client'

import { useUpload } from '@/lib/upload-context'
import { useTheme } from '@/lib/theme'

export default function UploadPanel() {
  const { theme } = useTheme()
  const {
    uploading,
    uploadQueue,
    uploadProgress,
    showUploadPanel,
    setShowUploadPanel,
    removeFromQueue,
    clearCompleted,
    clearAll,
  } = useUpload()

  const isDark = theme === 'dark'

  // 업로드 중이거나 큐에 항목이 있을 때만 표시
  if (!uploading && uploadQueue.length === 0) return null

  const completedCount = uploadQueue.filter(item => item.status === 'done').length
  const hasCompleted = completedCount > 0

  return (
    <div className={`fixed bottom-6 right-6 z-[9999] w-80 rounded-xl shadow-2xl overflow-hidden ${isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-gray-200'}`}>
      <div className={`flex items-center justify-between px-4 py-3 ${isDark ? 'bg-zinc-800' : 'bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          {uploading ? (
            <div className={`w-5 h-5 border-2 rounded-full animate-spin ${isDark ? 'border-zinc-600 border-t-white' : 'border-gray-300 border-t-blue-500'}`} />
          ) : (
            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {uploading ? `업로드 중 (${uploadProgress.current}/${uploadProgress.total})` : '업로드 완료'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* 완료된 항목 모두 지우기 */}
          {hasCompleted && !uploading && (
            <button
              onClick={clearCompleted}
              className={`p-1.5 rounded transition-colors ${isDark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-gray-200 text-gray-500'}`}
              title="완료된 항목 지우기"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setShowUploadPanel(!showUploadPanel)}
            className={`p-1.5 rounded transition-colors ${isDark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-gray-200 text-gray-500'}`}
          >
            <svg className={`w-4 h-4 transition-transform ${showUploadPanel ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!uploading && (
            <button
              onClick={clearAll}
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
      {uploading && (
        <div className={`h-1 ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`}>
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
          />
        </div>
      )}

      {/* 파일 리스트 */}
      {showUploadPanel && (
        <div className="max-h-64 overflow-y-auto">
          {uploadQueue.map((item) => (
            <div key={item.id} className={`flex items-center gap-3 px-4 py-2 ${isDark ? 'border-t border-zinc-800' : 'border-t border-gray-100'}`}>
              <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${
                item.status === 'done' ? 'bg-green-500/10' :
                item.status === 'uploading' ? 'bg-blue-500/10' :
                item.status === 'error' ? 'bg-red-500/10' :
                (isDark ? 'bg-zinc-800' : 'bg-gray-100')
              }`}>
                {item.status === 'done' && (
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {item.status === 'uploading' && (
                  <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                )}
                {item.status === 'error' && (
                  <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </div>
              <span className={`text-sm truncate flex-1 ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>{item.name}</span>

              {/* 완료된 항목 개별 삭제 */}
              {item.status === 'done' && (
                <button
                  onClick={() => removeFromQueue(item.id)}
                  className={`p-1 rounded opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity ${isDark ? 'hover:bg-zinc-700 text-zinc-500' : 'hover:bg-gray-200 text-gray-400'}`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}

              <span className={`text-xs flex-shrink-0 ${
                item.status === 'done' ? 'text-green-500' :
                item.status === 'uploading' ? 'text-blue-500' :
                item.status === 'error' ? 'text-red-500' :
                (isDark ? 'text-zinc-500' : 'text-gray-400')
              }`}>
                {item.status === 'done' ? '완료' :
                 item.status === 'uploading' ? '업로드 중' :
                 item.status === 'error' ? '실패' : '대기'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
