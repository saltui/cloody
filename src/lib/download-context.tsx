'use client'

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react'

export interface DownloadItem {
  id: string
  name: string
  url: string
  status: 'pending' | 'downloading' | 'done' | 'error'
  progress?: number // 0-100
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
}

const DownloadContext = createContext<DownloadContextType | null>(null)

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [downloadQueue, setDownloadQueue] = useState<DownloadItem[]>([])
  const [showDownloadPanel, setShowDownloadPanel] = useState(true)

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
