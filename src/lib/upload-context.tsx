'use client'

import { createContext, useContext, useState, useCallback, useMemo, useEffect, ReactNode } from 'react'

const UPLOAD_HISTORY_KEY = 'cloody_upload_history'
const MAX_HISTORY_ITEMS = 100

export interface UploadItem {
  id: string
  name: string
  status: 'pending' | 'uploading' | 'done' | 'error'
  createdAt?: number
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

// localStorage에서 업로드 히스토리 로드
function loadUploadHistory(): UploadItem[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(UPLOAD_HISTORY_KEY)
    if (stored) {
      const items = JSON.parse(stored) as UploadItem[]
      // 진행 중이던 항목은 에러로 처리
      return items.map(item => ({
        ...item,
        status: item.status === 'uploading' || item.status === 'pending' ? 'error' : item.status
      }))
    }
  } catch {
    // ignore
  }
  return []
}

// localStorage에 업로드 히스토리 저장
function saveUploadHistory(items: UploadItem[]) {
  if (typeof window === 'undefined') return
  try {
    // 최신 100개만 유지
    const toSave = items.slice(-MAX_HISTORY_ITEMS)
    localStorage.setItem(UPLOAD_HISTORY_KEY, JSON.stringify(toSave))
  } catch {
    // ignore
  }
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([])
  const [showUploadPanel, setShowUploadPanel] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)

  // 초기 로드
  useEffect(() => {
    const history = loadUploadHistory()
    if (history.length > 0) {
      setUploadQueue(history)
    }
    setIsInitialized(true)
  }, [])

  // 변경 시 저장
  useEffect(() => {
    if (isInitialized) {
      saveUploadHistory(uploadQueue)
    }
  }, [uploadQueue, isInitialized])

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

  // 큐에 아이템 추가 (기존 큐 유지하고 추가, timestamp 포함)
  const addToQueue = useCallback((items: UploadItem[]) => {
    const itemsWithTimestamp = items.map(item => ({
      ...item,
      createdAt: item.createdAt || Date.now()
    }))
    setUploadQueue(prev => [...prev, ...itemsWithTimestamp])
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
