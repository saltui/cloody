'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import Sidebar from '@/components/Sidebar'
import SecureImage from '@/components/SecureImage'
import { FileThumbnail, isMediaFile } from '@/lib/file-icons'

interface Photo {
  id: string
  url: string
  thumbnail_url: string | null
  name: string
  folder_id: string | null
  deleted_at: string
  is_video?: boolean
}

interface Folder {
  id: string
  name: string
  deleted_at: string
}

// R2 URL을 프록시 URL로 변환
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

// 남은 일수 계산
function getDaysRemaining(deletedAt: string): number {
  const deleted = new Date(deletedAt)
  const expiresAt = new Date(deleted.getTime() + 30 * 24 * 60 * 60 * 1000)
  const now = new Date()
  const diff = expiresAt.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)))
}

export default function TrashPage() {
  const router = useRouter()
  const { user, isLoading: userLoading } = useUser()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)

  // 휴지통 데이터 로드
  const loadTrash = useCallback(async () => {
    if (!user?.id) return

    try {
      const res = await fetch('/api/trash', {
        headers: { 'x-user-id': user.id }
      })
      if (res.ok) {
        const data = await res.json()
        setPhotos(data.photos || [])
        setFolders(data.folders || [])
      }
    } catch (error) {
      console.error('Failed to load trash:', error)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login')
      return
    }
    if (user) {
      loadTrash()
    }
  }, [user, userLoading, router, loadTrash])

  // 복원
  const handleRestore = async (photoIds?: string[], folderIds?: string[]) => {
    if (!user?.id) return
    setActionLoading(true)

    try {
      const res = await fetch('/api/trash/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({
          photoIds: photoIds || Array.from(selectedIds),
          folderIds,
        }),
      })

      if (res.ok) {
        await loadTrash()
        setSelectedIds(new Set())
      }
    } catch (error) {
      console.error('Restore failed:', error)
    } finally {
      setActionLoading(false)
    }
  }

  // 영구 삭제
  const handlePermanentDelete = async (photoIds?: string[], folderIds?: string[]) => {
    if (!user?.id) return
    if (!confirm('영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return
    setActionLoading(true)

    try {
      const res = await fetch('/api/trash', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({
          photoIds: photoIds || Array.from(selectedIds),
          folderIds,
        }),
      })

      if (res.ok) {
        await loadTrash()
        setSelectedIds(new Set())
      }
    } catch (error) {
      console.error('Delete failed:', error)
    } finally {
      setActionLoading(false)
    }
  }

  // 휴지통 비우기
  const handleEmptyTrash = async () => {
    if (!user?.id) return
    setActionLoading(true)
    setShowEmptyConfirm(false)

    try {
      const res = await fetch('/api/trash', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ emptyAll: true }),
      })

      if (res.ok) {
        await loadTrash()
        setSelectedIds(new Set())
      }
    } catch (error) {
      console.error('Empty trash failed:', error)
    } finally {
      setActionLoading(false)
    }
  }

  // 선택 토글
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // 전체 선택
  const selectAll = () => {
    if (selectedIds.size === photos.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(photos.map(p => p.id)))
    }
  }

  if (userLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  const isEmpty = photos.length === 0 && folders.length === 0

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main Content */}
      <div className="xl:ml-64">
        {/* Header */}
        <header className="h-[65px] px-4 flex items-center justify-between border-b sticky top-0 z-30" style={{ background: 'var(--background)', borderColor: 'var(--glass-border)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="xl:hidden p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: 'var(--foreground)' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
              휴지통
            </h1>
            <span className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
              {photos.length}개 항목
            </span>
          </div>

          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <>
                <button
                  onClick={() => handleRestore()}
                  disabled={actionLoading}
                  className="px-3 py-1.5 text-sm rounded-lg transition-colors"
                  style={{ background: 'var(--accent-gradient-subtle)', color: 'var(--accent-primary)' }}
                >
                  복원 ({selectedIds.size})
                </button>
                <button
                  onClick={() => handlePermanentDelete()}
                  disabled={actionLoading}
                  className="px-3 py-1.5 text-sm rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                >
                  삭제
                </button>
              </>
            )}
            {!isEmpty && (
              <button
                onClick={() => setShowEmptyConfirm(true)}
                disabled={actionLoading}
                className="px-3 py-1.5 text-sm rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
              >
                휴지통 비우기
              </button>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="p-4">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-20">
              <svg className="w-16 h-16 mb-4" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <p className="text-lg font-medium" style={{ color: 'var(--foreground-muted)' }}>
                휴지통이 비어 있습니다
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>
                삭제된 파일은 30일 후 자동으로 영구 삭제됩니다
              </p>
            </div>
          ) : (
            <>
              {/* 전체 선택 */}
              <div className="mb-4 flex items-center gap-2">
                <button
                  onClick={selectAll}
                  className="text-sm px-3 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  style={{ color: 'var(--foreground-secondary)' }}
                >
                  {selectedIds.size === photos.length ? '선택 해제' : '전체 선택'}
                </button>
              </div>

              {/* 폴더 */}
              {folders.length > 0 && (
                <div className="mb-6">
                  <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--foreground-muted)' }}>
                    폴더
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {folders.map(folder => {
                      const daysRemaining = getDaysRemaining(folder.deleted_at)
                      return (
                        <div
                          key={folder.id}
                          className="group relative p-4 rounded-xl border transition-all duration-200 hover:border-[var(--accent-primary)]"
                          style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
                        >
                          <div className="flex items-center gap-3">
                            <svg className="w-8 h-8" style={{ color: 'var(--accent-primary)' }} fill="currentColor" viewBox="0 0 24 24">
                              <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                            </svg>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                                {folder.name}
                              </p>
                              <p className="text-xs" style={{ color: daysRemaining <= 7 ? '#ef4444' : 'var(--foreground-muted)' }}>
                                {daysRemaining}일 후 삭제
                              </p>
                            </div>
                          </div>
                          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                            <button
                              onClick={() => handleRestore(undefined, [folder.id])}
                              className="p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70"
                              title="복원"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handlePermanentDelete(undefined, [folder.id])}
                              className="p-1.5 rounded-lg bg-red-500/80 text-white hover:bg-red-500"
                              title="영구 삭제"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 사진 */}
              {photos.length > 0 && (
                <div>
                  <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--foreground-muted)' }}>
                    파일
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {photos.map(photo => {
                      const isSelected = selectedIds.has(photo.id)
                      const daysRemaining = getDaysRemaining(photo.deleted_at)
                      const thumbnailUrl = photo.thumbnail_url ? toProxyUrl(photo.thumbnail_url) : toProxyUrl(photo.url)

                      return (
                        <div
                          key={photo.id}
                          onClick={() => toggleSelect(photo.id)}
                          className={`group relative aspect-square rounded-xl overflow-hidden cursor-pointer transition-all duration-200 ${isSelected ? 'ring-2 ring-[var(--accent-primary)] ring-offset-2 ring-offset-[var(--background)]' : ''}`}
                          style={{ background: 'var(--glass-bg)' }}
                        >
                          {isMediaFile(photo.name) ? (
                            <SecureImage
                              src={thumbnailUrl}
                              alt={photo.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <FileThumbnail filename={photo.name} />
                          )}

                          {/* 동영상 표시 */}
                          {photo.is_video && (
                            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-xs">
                              영상
                            </div>
                          )}

                          {/* 남은 일수 */}
                          <div className={`absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-xs ${daysRemaining <= 7 ? 'bg-red-500 text-white' : 'bg-black/60 text-white'}`}>
                            {daysRemaining}일
                          </div>

                          {/* 선택 체크박스 */}
                          <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)]' : 'bg-black/30 border-white/50 opacity-0 group-hover:opacity-100'}`}>
                            {isSelected && (
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>

                          {/* 호버 시 액션 버튼 */}
                          <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRestore([photo.id])
                              }}
                              className="p-1.5 rounded-lg bg-white/20 text-white hover:bg-white/30"
                              title="복원"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handlePermanentDelete([photo.id])
                              }}
                              className="p-1.5 rounded-lg bg-red-500/80 text-white hover:bg-red-500"
                              title="영구 삭제"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* 휴지통 비우기 확인 모달 */}
      {showEmptyConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 p-6 rounded-2xl" style={{ background: 'var(--background)', border: '1px solid var(--glass-border)' }}>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
              휴지통 비우기
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--foreground-secondary)' }}>
              휴지통의 모든 항목({photos.length}개)이 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowEmptyConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: 'var(--foreground-secondary)' }}
              >
                취소
              </button>
              <button
                onClick={handleEmptyTrash}
                disabled={actionLoading}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                {actionLoading ? '삭제 중...' : '영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
