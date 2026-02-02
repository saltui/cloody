'use client'

import { useState, useEffect } from 'react'

interface Version {
  version: number
  created_at: string
  changed_by: string
  change_reason: string
  file_size: number
  file_path: string
}

interface VersionHistoryProps {
  photoId: string
  onRestore?: (version: number) => void
  className?: string
}

export default function VersionHistory({ photoId, onRestore, className = '' }: VersionHistoryProps) {
  const [versions, setVersions] = useState<Version[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isExpanded, setIsExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<number | null>(null)

  useEffect(() => {
    const fetchVersions = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const response = await fetch(`/api/files/${photoId}/versions`)

        if (!response.ok) {
          throw new Error('버전 히스토리를 불러올 수 없습니다')
        }

        const data = await response.json()
        setVersions(data.versions || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : '오류가 발생했습니다')
      } finally {
        setIsLoading(false)
      }
    }

    if (photoId) {
      fetchVersions()
    }
  }, [photoId])

  const handleDownload = async (version: Version) => {
    try {
      const response = await fetch(`/api/files/${photoId}/versions/${version.version}/download`)

      if (!response.ok) {
        throw new Error('다운로드 실패')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `v${version.version}_${version.file_path.split('/').pop()}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download error:', err)
    }
  }

  const handleRestore = async (version: number) => {
    if (!confirm(`버전 ${version}으로 복원하시겠습니까?`)) {
      return
    }

    try {
      setRestoring(version)
      if (onRestore) {
        onRestore(version)
      }
    } finally {
      setRestoring(null)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
  }

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div
      className={`rounded-lg overflow-hidden ${className}`}
      style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5"
            style={{ color: 'var(--foreground)' }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="font-medium" style={{ color: 'var(--foreground)' }}>
            버전 히스토리
          </span>
          {!isLoading && versions.length > 0 && (
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'var(--glass-bg)', color: 'var(--foreground-muted)' }}
            >
              {versions.length}
            </span>
          )}
        </div>
        <svg
          className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          style={{ color: 'var(--foreground-muted)' }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t" style={{ borderColor: 'var(--glass-border)' }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--glass-border)', borderTopColor: 'var(--accent-primary)' }} />
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-center">
              <svg
                className="w-8 h-8 mx-auto mb-2"
                style={{ color: 'var(--error)' }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-sm" style={{ color: 'var(--error)' }}>
                {error}
              </p>
            </div>
          ) : versions.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                버전 히스토리가 없습니다
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {versions.map((version, index) => (
                <div
                  key={version.version}
                  className="px-4 py-3 border-b last:border-b-0"
                  style={{ borderColor: 'var(--glass-border)' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-sm font-semibold"
                          style={{ color: 'var(--foreground)' }}
                        >
                          버전 {version.version}
                        </span>
                        {index === 0 && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--accent-gradient-subtle)', color: 'var(--accent-primary)' }}
                          >
                            현재
                          </span>
                        )}
                      </div>
                      <p className="text-xs mb-1" style={{ color: 'var(--foreground-muted)' }}>
                        {formatDate(version.created_at)}
                      </p>
                      <p className="text-xs mb-1" style={{ color: 'var(--foreground-secondary)' }}>
                        변경자: {version.changed_by}
                      </p>
                      {version.change_reason && (
                        <p className="text-xs mb-1" style={{ color: 'var(--foreground-secondary)' }}>
                          사유: {version.change_reason}
                        </p>
                      )}
                      <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                        크기: {formatFileSize(version.file_size)}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      {/* Download Button */}
                      <button
                        onClick={() => handleDownload(version)}
                        className="p-2 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        style={{ color: 'var(--foreground-muted)' }}
                        title="다운로드"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                          />
                        </svg>
                      </button>

                      {/* Restore Button (not for current version) */}
                      {index !== 0 && onRestore && (
                        <button
                          onClick={() => handleRestore(version.version)}
                          disabled={restoring === version.version}
                          className="p-2 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                          style={{ color: 'var(--accent-primary)' }}
                          title="복원"
                        >
                          {restoring === version.version ? (
                            <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--glass-border)', borderTopColor: 'var(--accent-primary)' }} />
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                              />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Compare placeholder */}
                  {index !== versions.length - 1 && (
                    <button
                      className="mt-2 text-xs transition-colors hover:opacity-80"
                      style={{ color: 'var(--foreground-muted)' }}
                      disabled
                    >
                      이전 버전과 비교 (준비 중)
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
