'use client'

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react'

export interface UploadItem {
  id: string
  name: string
  status: 'pending' | 'uploading' | 'done' | 'error'
}

interface UploadContextType {
  uploading: boolean
  uploadQueue: UploadItem[]
  uploadProgress: { current: number; total: number }
  showUploadPanel: boolean
  setShowUploadPanel: (value: boolean) => void
  addToQueue: (items: UploadItem[]) => void
  updateQueueItem: (id: string, status: UploadItem['status']) => void
  removeFromQueue: (id: string) => void
  clearCompleted: () => void
  clearAll: () => void
}

const UploadContext = createContext<UploadContextType | null>(null)

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([])
  const [showUploadPanel, setShowUploadPanel] = useState(false)

  // 진행률은 큐 상태에서 자동 계산
  const uploadProgress = useMemo(() => {
    const total = uploadQueue.length
    const current = uploadQueue.filter(item => item.status === 'done' || item.status === 'error').length
    return { current, total }
  }, [uploadQueue])

  // 업로드 중 여부도 큐 상태에서 자동 계산
  const uploading = useMemo(() => {
    return uploadQueue.some(item => item.status === 'pending' || item.status === 'uploading')
  }, [uploadQueue])

  // 큐에 아이템 추가 (기존 큐 유지하고 추가)
  const addToQueue = useCallback((items: UploadItem[]) => {
    setUploadQueue(prev => [...prev, ...items])
  }, [])

  // ID로 아이템 상태 업데이트
  const updateQueueItem = useCallback((id: string, status: UploadItem['status']) => {
    setUploadQueue(prev => prev.map(item =>
      item.id === id ? { ...item, status } : item
    ))
  }, [])

  const removeFromQueue = useCallback((id: string) => {
    setUploadQueue(prev => prev.filter(item => item.id !== id))
  }, [])

  const clearCompleted = useCallback(() => {
    setUploadQueue(prev => prev.filter(item => item.status !== 'done'))
  }, [])

  const clearAll = useCallback(() => {
    setUploadQueue([])
  }, [])

  return (
    <UploadContext.Provider
      value={{
        uploading,
        uploadQueue,
        uploadProgress,
        showUploadPanel,
        setShowUploadPanel,
        addToQueue,
        updateQueueItem,
        removeFromQueue,
        clearCompleted,
        clearAll,
      }}
    >
      {children}
    </UploadContext.Provider>
  )
}

export function useUpload() {
  const context = useContext(UploadContext)
  if (!context) {
    throw new Error('useUpload must be used within UploadProvider')
  }
  return context
}
