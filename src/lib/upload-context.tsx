'use client'

import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from 'react'

const UPLOAD_HISTORY_KEY = 'cloody_upload_history'
const MAX_HISTORY_ITEMS = 100

export interface UploadItem {
  id: string
  name: string
  status: 'pending' | 'uploading' | 'done' | 'error' | 'cancelled'
  progress?: number // 0-100
  createdAt?: number
  // 추가 정보
  fileType?: string // 파일 확장자 (FIG, PDF, PNG 등)
  fileSize?: number // 파일 크기 (bytes)
  uploadedSize?: number // 업로드된 크기 (bytes)
  folderName?: string // 저장 폴더명
  url?: string // 완료 후 파일 URL
  startedAt?: number // 업로드 시작 시간
}

interface UploadContextType {
  uploading: boolean
  uploadQueue: UploadItem[]
  uploadProgress: { current: number; total: number }
  showUploadPanel: boolean
  setShowUploadPanel: (value: boolean) => void
  addToQueue: (items: UploadItem[]) => void
  updateQueueItem: (id: string, updates: Partial<Omit<UploadItem, 'id'>>) => void
  removeFromQueue: (id: string) => void
  cancelItem: (id: string) => void
  cancelAll: () => void
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
      // 진행 중이던 항목은 취소로 처리, cancelled 항목 제외
      return items
        .filter(item => item.status !== 'cancelled')
        .map(item => ({
          ...item,
          status: item.status === 'uploading' || item.status === 'pending' ? 'cancelled' : item.status
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

function toPersistableUploadHistory(items: UploadItem[]): UploadItem[] {
  return items.map(({ progress, uploadedSize, startedAt, ...rest }) => rest)
}

function shouldPersistByUpdateFields(updates: Partial<Omit<UploadItem, 'id'>>): boolean {
  const nonPersistFields: Array<keyof UploadItem> = ['progress', 'uploadedSize', 'startedAt']
  return Object.keys(updates).some((key) => !nonPersistFields.includes(key as keyof UploadItem))
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([])
  const [showUploadPanel, setShowUploadPanel] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const uploadQueueRef = useRef<UploadItem[]>([])
  const persistTimerRef = useRef<NodeJS.Timeout | null>(null)

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
    uploadQueueRef.current = uploadQueue
  }, [uploadQueue])

  const flushPersistHistory = useCallback(() => {
    if (!isInitialized) return
    saveUploadHistory(toPersistableUploadHistory(uploadQueueRef.current))
  }, [isInitialized])

  const schedulePersistHistory = useCallback(() => {
    if (!isInitialized) return
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current)
    }
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      flushPersistHistory()
    }, 700)
  }, [flushPersistHistory, isInitialized])

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
      flushPersistHistory()
    }
  }, [flushPersistHistory])

  // 진행률은 큐 상태에서 자동 계산
  const uploadProgress = useMemo(() => {
    const activeItems = uploadQueue.filter(item => item.status !== 'cancelled')
    const total = activeItems.length
    const current = activeItems.filter(item => item.status === 'done' || item.status === 'error').length
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
    schedulePersistHistory()
  }, [schedulePersistHistory])

  // ID로 아이템 상태/진행률 업데이트
  const updateQueueItem = useCallback((id: string, updates: Partial<Omit<UploadItem, 'id'>>) => {
    let changed = false
    setUploadQueue(prev => {
      const index = prev.findIndex(item => item.id === id)
      if (index < 0) return prev

      const current = prev[index]
      const hasDiff = Object.entries(updates).some(([key, value]) => current[key as keyof UploadItem] !== value)
      if (!hasDiff) return prev

      changed = true
      const next = [...prev]
      next[index] = { ...current, ...updates }
      return next
    })

    if (changed && shouldPersistByUpdateFields(updates)) {
      schedulePersistHistory()
    }
  }, [schedulePersistHistory])

  const removeFromQueue = useCallback((id: string) => {
    setUploadQueue(prev => prev.filter(item => item.id !== id))
    schedulePersistHistory()
  }, [schedulePersistHistory])

  // 개별 항목 취소
  const cancelItem = useCallback((id: string) => {
    setUploadQueue(prev => prev.map(item =>
      item.id === id && (item.status === 'pending' || item.status === 'uploading')
        ? { ...item, status: 'cancelled' as const }
        : item
    ))
    schedulePersistHistory()
  }, [schedulePersistHistory])

  // 모든 진행 중인 항목 취소
  const cancelAll = useCallback(() => {
    setUploadQueue(prev => prev.map(item =>
      item.status === 'pending' || item.status === 'uploading'
        ? { ...item, status: 'cancelled' as const }
        : item
    ))
    schedulePersistHistory()
  }, [schedulePersistHistory])

  const clearCompleted = useCallback(() => {
    setUploadQueue(prev => prev.filter(item =>
      item.status !== 'done' && item.status !== 'error' && item.status !== 'cancelled'
    ))
    schedulePersistHistory()
  }, [schedulePersistHistory])

  const clearAll = useCallback(() => {
    setUploadQueue([])
    schedulePersistHistory()
  }, [schedulePersistHistory])

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
        cancelItem,
        cancelAll,
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
