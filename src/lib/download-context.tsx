'use client'

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'

export interface DownloadItem {
  id: string
  name: string
  url: string
  status: 'pending' | 'downloading' | 'done' | 'error'
  progress?: number // 0-100
}

export interface ZipDownloadProgress {
  phase: 'preparing' | 'downloading' | 'zipping' | 'done' | 'error'
  current: number
  total: number
  currentFile?: string
  error?: string
}

export interface FolderInfo {
  id: string
  name: string
  parentId: string | null
}

// R2 URL을 프록시 URL로 변환
function toProxyUrl(originalUrl: string): string {
  // R2 public URL인 경우
  if (originalUrl.includes('.r2.dev/')) {
    const parts = originalUrl.split('.r2.dev/')
    if (parts.length > 1) {
      const fileName = parts[1].split('?')[0]
      return `/api/image/${fileName}`
    }
  }

  // R2 signed URL인 경우
  if (originalUrl.includes('.r2.cloudflarestorage.com/')) {
    try {
      const url = new URL(originalUrl)
      const pathParts = url.pathname.split('/')
      if (pathParts.length > 2) {
        const fileName = pathParts.slice(2).join('/')
        return `/api/image/${fileName}`
      }
    } catch {
      return originalUrl
    }
  }

  return originalUrl
}

interface DownloadContextType {
  downloading: boolean
  downloadQueue: DownloadItem[]
  downloadProgress: { current: number; total: number }
  showDownloadPanel: boolean
  setShowDownloadPanel: (value: boolean) => void
  addToDownloadQueue: (items: DownloadItem[]) => void
  updateDownloadItem: (id: string, updates: Partial<DownloadItem>) => void
  removeFromDownloadQueue: (id: string) => void
  clearCompletedDownloads: () => void
  clearAllDownloads: () => void
  startDownload: (items: { id: string; name: string; url: string }[]) => Promise<void>
  // ZIP 다운로드
  zipProgress: ZipDownloadProgress | null
  isZipDownloading: boolean
  startZipDownload: (
    items: { id: string; name: string; url: string; type: 'photo' | 'folder'; folderId?: string | null }[],
    allFolders: FolderInfo[],
    fetchFolderContents: (folderId: string) => Promise<{ id: string; name: string; url: string; type: 'photo' | 'folder' }[]>
  ) => Promise<void>
  cancelZipDownload: () => void
}

const DownloadContext = createContext<DownloadContextType | null>(null)

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [downloadQueue, setDownloadQueue] = useState<DownloadItem[]>([])
  const [showDownloadPanel, setShowDownloadPanel] = useState(true)
  const [zipProgress, setZipProgress] = useState<ZipDownloadProgress | null>(null)
  const [isZipDownloading, setIsZipDownloading] = useState(false)

  const downloadProgress = useMemo(() => {
    const total = downloadQueue.length
    const current = downloadQueue.filter(item => item.status === 'done' || item.status === 'error').length
    return { current, total }
  }, [downloadQueue])

  const downloading = useMemo(() => {
    return downloadQueue.some(item => item.status === 'pending' || item.status === 'downloading')
  }, [downloadQueue])

  const addToDownloadQueue = useCallback((items: DownloadItem[]) => {
    setDownloadQueue(prev => [...prev, ...items])
  }, [])

  const updateDownloadItem = useCallback((id: string, updates: Partial<DownloadItem>) => {
    setDownloadQueue(prev => prev.map(item =>
      item.id === id ? { ...item, ...updates } : item
    ))
  }, [])

  const removeFromDownloadQueue = useCallback((id: string) => {
    setDownloadQueue(prev => prev.filter(item => item.id !== id))
  }, [])

  const clearCompletedDownloads = useCallback(() => {
    setDownloadQueue(prev => prev.filter(item => item.status !== 'done'))
  }, [])

  const clearAllDownloads = useCallback(() => {
    setDownloadQueue([])
  }, [])

  // 다운로드 실행
  const startDownload = useCallback(async (items: { id: string; name: string; url: string }[]) => {
    if (items.length === 0) return

    // 큐에 추가
    const queueItems: DownloadItem[] = items.map(item => ({
      id: item.id,
      name: item.name,
      url: item.url,
      status: 'pending',
      progress: 0,
    }))
    setDownloadQueue(prev => [...prev, ...queueItems])
    setShowDownloadPanel(true)

    // 병렬 다운로드 (최대 5개 동시)
    const CONCURRENT_DOWNLOADS = 5

    const downloadFile = async (item: { id: string; name: string; url: string }) => {
      setDownloadQueue(prev => prev.map(q =>
        q.id === item.id ? { ...q, status: 'downloading' } : q
      ))

      try {
        // 프록시 URL로 변환
        const proxyUrl = toProxyUrl(item.url)

        // 파일 다운로드
        const response = await fetch(proxyUrl)
        if (!response.ok) throw new Error('Download failed')

        const contentLength = response.headers.get('content-length')
        const total = contentLength ? parseInt(contentLength, 10) : 0

        // ReadableStream으로 진행률 추적
        const reader = response.body?.getReader()
        if (!reader) throw new Error('No reader available')

        const chunks: Uint8Array[] = []
        let received = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          chunks.push(value)
          received += value.length

          if (total > 0) {
            const progress = Math.round((received / total) * 100)
            setDownloadQueue(prev => prev.map(q =>
              q.id === item.id ? { ...q, progress } : q
            ))
          }
        }

        // Blob 생성 및 다운로드
        const blob = new Blob(chunks as BlobPart[])
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = item.name
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        setDownloadQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, status: 'done', progress: 100 } : q
        ))
      } catch (error) {
        console.error('Download error:', error)
        setDownloadQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, status: 'error' } : q
        ))
      }
    }

    // 청크 단위로 병렬 처리
    for (let i = 0; i < items.length; i += CONCURRENT_DOWNLOADS) {
      const chunk = items.slice(i, i + CONCURRENT_DOWNLOADS)
      await Promise.all(chunk.map(downloadFile))
    }
  }, [])

  // ZIP 다운로드 취소
  const cancelZipDownload = useCallback(() => {
    setZipProgress(null)
    setIsZipDownloading(false)
  }, [])

  // ZIP 다운로드 실행
  const startZipDownload = useCallback(async (
    items: { id: string; name: string; url: string; type: 'photo' | 'folder'; folderId?: string | null }[],
    allFolders: FolderInfo[],
    fetchFolderContents: (folderId: string) => Promise<{ id: string; name: string; url: string; type: 'photo' | 'folder' }[]>
  ) => {
    if (items.length === 0) return

    setIsZipDownloading(true)
    setZipProgress({ phase: 'preparing', current: 0, total: 0 })
    setShowDownloadPanel(true)

    try {
      // 폴더 경로 계산 함수
      const getFolderPath = (folderId: string | null): string => {
        if (!folderId) return ''
        const folder = allFolders.find(f => f.id === folderId)
        if (!folder) return ''
        const parentPath = getFolderPath(folder.parentId)
        return parentPath ? `${parentPath}/${folder.name}` : folder.name
      }

      // 다운로드할 모든 파일 수집
      const filesToDownload: { url: string; path: string; name: string }[] = []

      for (const item of items) {
        if (item.type === 'folder') {
          // 폴더인 경우 재귀적으로 내용 수집
          const collectFolderContents = async (folderId: string, basePath: string) => {
            const contents = await fetchFolderContents(folderId)
            for (const content of contents) {
              if (content.type === 'folder') {
                const folder = allFolders.find(f => f.id === content.id)
                if (folder) {
                  await collectFolderContents(content.id, `${basePath}/${folder.name}`)
                }
              } else {
                filesToDownload.push({
                  url: content.url,
                  path: basePath,
                  name: content.name,
                })
              }
            }
          }

          const folder = allFolders.find(f => f.id === item.id)
          if (folder) {
            await collectFolderContents(item.id, folder.name)
          }
        } else {
          // 일반 파일
          const folderPath = item.folderId ? getFolderPath(item.folderId) : ''
          filesToDownload.push({
            url: item.url,
            path: folderPath,
            name: item.name,
          })
        }
      }

      if (filesToDownload.length === 0) {
        setZipProgress({ phase: 'error', current: 0, total: 0, error: '다운로드할 파일이 없습니다' })
        return
      }

      // 파일 다운로드 및 ZIP 생성
      setZipProgress({ phase: 'downloading', current: 0, total: filesToDownload.length })
      const zip = new JSZip()
      let downloadedCount = 0
      const CONCURRENT_DOWNLOADS = 10 // 동시 다운로드 수

      // 단일 파일 다운로드 함수
      const downloadFile = async (file: { url: string; path: string; name: string }): Promise<{ path: string; name: string; blob: Blob } | null> => {
        try {
          const proxyUrl = toProxyUrl(file.url)
          const response = await fetch(proxyUrl)

          if (!response.ok) {
            console.warn(`Failed to fetch ${file.name}: ${response.status}`)
            return null
          }

          const blob = await response.blob()
          return { path: file.path, name: file.name, blob }
        } catch (error) {
          console.warn(`Error downloading ${file.name}:`, error)
          return null
        }
      }

      // 청크 단위로 병렬 다운로드
      for (let i = 0; i < filesToDownload.length; i += CONCURRENT_DOWNLOADS) {
        const chunk = filesToDownload.slice(i, i + CONCURRENT_DOWNLOADS)

        setZipProgress({
          phase: 'downloading',
          current: downloadedCount,
          total: filesToDownload.length,
          currentFile: `${chunk.length}개 파일 다운로드 중...`,
        })

        const results = await Promise.all(chunk.map(downloadFile))

        // ZIP에 파일 추가
        for (const result of results) {
          if (result) {
            const filePath = result.path ? `${result.path}/${result.name}` : result.name
            zip.file(filePath, result.blob)
            downloadedCount++
          }
        }
      }

      if (downloadedCount === 0) {
        setZipProgress({ phase: 'error', current: 0, total: 0, error: '파일을 다운로드하지 못했습니다' })
        return
      }

      // ZIP 생성
      setZipProgress({ phase: 'zipping', current: downloadedCount, total: filesToDownload.length })

      // 이미지/동영상은 이미 압축되어 있으므로 STORE(무압축)로 빠르게 처리
      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'STORE' },
        (metadata) => {
          setZipProgress({
            phase: 'zipping',
            current: Math.round(metadata.percent),
            total: 100,
          })
        }
      )

      // 파일명 생성
      const now = new Date()
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const fileName = items.length === 1 && items[0].type === 'folder'
        ? `${items[0].name}_${dateStr}.zip`
        : `Cloody_${dateStr}_${downloadedCount}files.zip`

      // 다운로드
      saveAs(zipBlob, fileName)
      setZipProgress({ phase: 'done', current: downloadedCount, total: filesToDownload.length })

      // 완료 후 잠시 뒤 상태 초기화
      setTimeout(() => {
        setZipProgress(null)
        setIsZipDownloading(false)
      }, 3000)

    } catch (error) {
      console.error('ZIP download error:', error)
      setZipProgress({
        phase: 'error',
        current: 0,
        total: 0,
        error: error instanceof Error ? error.message : '다운로드 중 오류가 발생했습니다',
      })
      setIsZipDownloading(false)
    }
  }, [])

  return (
    <DownloadContext.Provider
      value={{
        downloading,
        downloadQueue,
        downloadProgress,
        showDownloadPanel,
        setShowDownloadPanel,
        addToDownloadQueue,
        updateDownloadItem,
        removeFromDownloadQueue,
        clearCompletedDownloads,
        clearAllDownloads,
        startDownload,
        zipProgress,
        isZipDownloading,
        startZipDownload,
        cancelZipDownload,
      }}
    >
      {children}
    </DownloadContext.Provider>
  )
}

export function useDownload() {
  const context = useContext(DownloadContext)
  if (!context) {
    throw new Error('useDownload must be used within DownloadProvider')
  }
  return context
}
