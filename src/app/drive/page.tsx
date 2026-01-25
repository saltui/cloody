'use client'

import { useState, useEffect, useCallback, useRef, useMemo, DragEvent, memo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { useUpload } from '@/lib/upload-context'
import { useDownload } from '@/lib/download-context'
import { useUser } from '@/lib/user-context'
import { useDataCache, type CategoryFilter } from '@/lib/data-cache'
import Sidebar, { FileCategory } from '@/components/Sidebar'
import { Home, Image as ImageIcon, CloudUpload, Menu } from 'lucide-react'

// R2 URL을 프록시 URL로 즉시 변환
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

interface Photo {
  id: string
  url: string
  thumbnail_url: string | null
  name: string
  order: number
  folder_id: string | null
  created_at: string
  // Video metadata
  file_type?: string
  file_size?: number
  is_video?: boolean
  duration?: number
  width?: number
  height?: number
  hls_url?: string
  hls_status?: 'not_applicable' | 'pending' | 'processing' | 'ready' | 'failed'
}

// 비디오 썸네일 생성 함수
const generateVideoThumbnail = (file: File, maxSize: number = 400): Promise<Blob | null> => {
  return new Promise((resolve) => {
    console.log('[VideoThumb] Starting:', file.name, file.type, file.size)

    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    // blob URL에는 crossOrigin 불필요 (CORS 에러 유발)

    const objectUrl = URL.createObjectURL(file)
    console.log('[VideoThumb] Blob URL created')
    let resolved = false

    // 타임아웃 설정 (15초)
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log('[VideoThumb] TIMEOUT')
        resolve(null)
      }
    }, 15000)

    const cleanup = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(objectUrl)
      video.pause()
      video.src = ''
      video.load()
      video.remove()
    }

    const captureFrame = () => {
      if (resolved) return
      console.log('[VideoThumb] Capturing frame, dimensions:', video.videoWidth, 'x', video.videoHeight)

      try {
        let { videoWidth: width, videoHeight: height } = video

        if (width === 0 || height === 0) {
          console.log('[VideoThumb] ERROR: dimensions 0')
          resolved = true
          cleanup()
          resolve(null)
          return
        }

        // 비율 유지하며 리사이즈
        if (width > height) {
          height = (height / width) * maxSize
          width = maxSize
        } else {
          width = (width / height) * maxSize
          height = maxSize
        }

        canvas.width = width
        canvas.height = height
        ctx?.drawImage(video, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            console.log('[VideoThumb] Blob result:', blob ? blob.size + ' bytes' : 'null')
            if (!resolved) {
              resolved = true
              cleanup()
              resolve(blob)
            }
          },
          'image/webp',
          0.8
        )
      } catch (e) {
        console.log('[VideoThumb] Capture error:', e)
        if (!resolved) {
          resolved = true
          cleanup()
          resolve(null)
        }
      }
    }

    video.onloadedmetadata = () => {
      console.log('[VideoThumb] Metadata loaded, duration:', video.duration, 'size:', video.videoWidth, 'x', video.videoHeight)
    }

    video.onloadeddata = () => {
      if (resolved) return
      console.log('[VideoThumb] Data loaded, seeking to 1s or 10%')
      const seekTime = Math.min(1, (video.duration || 1) * 0.1)
      video.currentTime = seekTime
    }

    video.onseeked = () => {
      if (resolved) return
      console.log('[VideoThumb] Seek complete')
      setTimeout(captureFrame, 100)
    }

    video.onerror = () => {
      console.log('[VideoThumb] ERROR:', video.error?.code, video.error?.message)
      if (!resolved) {
        resolved = true
        cleanup()
        resolve(null)
      }
    }

    video.src = objectUrl
    video.load()
    console.log('[VideoThumb] Load started')
  })
}

// 이미지 썸네일 생성 함수 (400px 리사이즈)
const generateImageThumbnail = (file: File, maxSize: number = 400): Promise<Blob | null> => {
  return new Promise((resolve) => {
    const img = new Image()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    img.onload = () => {
      let { width, height } = img

      // 이미 작은 이미지는 썸네일 불필요
      if (width <= maxSize && height <= maxSize) {
        resolve(null)
        return
      }

      // 비율 유지하며 리사이즈
      if (width > height) {
        height = (height / width) * maxSize
        width = maxSize
      } else {
        width = (width / height) * maxSize
        height = maxSize
      }

      canvas.width = width
      canvas.height = height
      ctx?.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => resolve(blob),
        'image/webp',
        0.8
      )
    }

    img.onerror = () => resolve(null)
    img.src = URL.createObjectURL(file)
  })
}

// 통합 썸네일 생성 함수
const generateThumbnail = (file: File, maxSize: number = 400): Promise<Blob | null> => {
  if (file.type.startsWith('video/')) {
    return generateVideoThumbnail(file, maxSize)
  }
  return generateImageThumbnail(file, maxSize)
}

// 바이트 포맷팅 함수
const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

interface Folder {
  id: string
  name: string
  parent_id: string | null
  created_at: string
}

interface DuplicateFile {
  file: File
  existingPhoto: Photo
}

export default function DrivePage() {
  const { theme, viewMode, setTheme, setViewMode } = useTheme()
  const { uploading, uploadQueue, uploadProgress, showUploadPanel, setShowUploadPanel, addToQueue, updateQueueItem, removeFromQueue, clearCompleted, clearAll } = useUpload()
  const { startDownload } = useDownload()
  const { user, isLoading: userLoading } = useUser()
  const dataCache = useDataCache()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [allFolders, setAllFolders] = useState<Folder[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [currentFolder, setCurrentFolder] = useState<Folder | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  // 무한 스크롤 페이지네이션
  const [hasMore, setHasMore] = useState(true)
  const [cursor, setCursor] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set())
  const [lastSelectedIndex, setLastSelectedIndex] = useState<{ type: 'photo' | 'folder', index: number } | null>(null)
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [showMoreScreen, setShowMoreScreen] = useState(false)

  // 폴더 수정 관련
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [editFolderName, setEditFolderName] = useState('')
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null)
  const [folderMenuPosition, setFolderMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const closeFolderMenu = () => {
    setFolderMenuId(null)
    setFolderMenuPosition(null)
  }

  // 파일 메뉴 관련
  const [photoMenuId, setPhotoMenuId] = useState<string | null>(null)
  const [photoMenuPosition, setPhotoMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const closePhotoMenu = () => {
    setPhotoMenuId(null)
    setPhotoMenuPosition(null)
  }
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null)
  const [editPhotoName, setEditPhotoName] = useState('')

  // 정보 모달 관련
  const [infoPhoto, setInfoPhoto] = useState<Photo | null>(null)
  const [infoFolder, setInfoFolder] = useState<Folder | null>(null)
  const [infoFolderCounts, setInfoFolderCounts] = useState<{ files: number; folders: number } | null>(null)

  // 폴더 선택 업로드 관련
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 드래그앤드롭 관련
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  // 삭제 진행 관련
  const [deleting, setDeleting] = useState(false)
  const [deleteStatus, setDeleteStatus] = useState('')

  // 스토리지 사용량
  const [storageUsed, setStorageUsed] = useState<number>(0)

  // 정렬 관련
  const [sortBy, setSortBy] = useState<'name' | 'date'>('name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  // 중복 파일 처리 관련
  const [duplicateFiles, setDuplicateFiles] = useState<DuplicateFile[]>([])
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [pendingUploadFolderId, setPendingUploadFolderId] = useState<string | null>(null)
  const [nonDuplicateFiles, setNonDuplicateFiles] = useState<File[]>([])

  // 이동 모달 관련
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [moving, setMoving] = useState(false)

  // 모바일 FAB 메뉴
  const [showFabMenu, setShowFabMenu] = useState(false)
  const fabFileInputRef = useRef<HTMLInputElement>(null)

  // 드래그 선택 관련 (데스크톱)
  const [dragSelectStart, setDragSelectStart] = useState<{ x: number; y: number } | null>(null)
  const [dragSelectCurrent, setDragSelectCurrent] = useState<{ x: number; y: number } | null>(null)
  const [isDragSelecting, setIsDragSelecting] = useState(false)
  const gridContainerRef = useRef<HTMLDivElement>(null)
  const listContainerRef = useRef<HTMLDivElement>(null)

  // 모바일 터치 선택 관련
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null)
  const [isTouchDragging, setIsTouchDragging] = useState(false)
  const [touchDragStart, setTouchDragStart] = useState<{ x: number; y: number } | null>(null)
  const [touchDragStartItem, setTouchDragStartItem] = useState<{ id: string; isFolder: boolean; combinedIndex: number } | null>(null)
  const autoScrollRef = useRef<NodeJS.Timeout | null>(null)
  const lastTouchPosRef = useRef<{ x: number; y: number } | null>(null)
  // 범위 선택을 위한 정렬된 배열 refs
  const sortedFoldersRef = useRef<Folder[]>([])
  const sortedPhotosRef = useRef<Photo[]>([])

  const router = useRouter()
  const searchParams = useSearchParams()

  const isSelecting = selectedIds.size > 0 || selectedFolderIds.size > 0
  const isDark = theme === 'dark'

  const buildBreadcrumbs = useCallback(async (folderId: string | null, folders: Folder[]) => {
    if (!folderId) {
      setBreadcrumbs([])
      setCurrentFolder(null)
      return
    }

    const crumbs: Folder[] = []
    let current = folders.find(f => f.id === folderId)

    while (current) {
      crumbs.unshift(current)
      current = current.parent_id ? folders.find(f => f.id === current!.parent_id) : undefined
    }

    setBreadcrumbs(crumbs)
    setCurrentFolder(crumbs[crumbs.length - 1] || null)
  }, [])

  const fetchData = useCallback(async (folderId: string | null, category: string = 'all') => {
    // 사용자 ID가 없으면 로딩 유지 (사용자 로딩 완료될 때까지)
    if (!user?.id) {
      return
    }

    // 초기 로딩일 때만 로딩 표시 (캐시 데이터가 있으면 바로 표시)
    if (isInitialLoad) {
      setLoading(true)
    }

    // 페이지네이션 초기화
    setCursor(0)
    setHasMore(true)

    // 캐시에서 폴더 데이터 가져오기
    const fetchedFolders = await dataCache.getFolders(user.id)
    setAllFolders(fetchedFolders)

    const childFolders = fetchedFolders.filter(f =>
      folderId ? f.parent_id === folderId : f.parent_id === null
    )
    setFolders(childFolders)

    await buildBreadcrumbs(folderId, fetchedFolders)

    // 카테고리가 'all'이면 현재 폴더의 파일만 가져옴
    // 카테고리가 photos/videos면 페이지네이션으로 가져옴
    if (category === 'all') {
      // 캐시에서 현재 폴더의 사진 가져오기
      const photosData = await dataCache.getPhotos(user.id, folderId)
      setPhotos(photosData as Photo[])
      setHasMore(false) // 폴더 뷰는 전체 로드
    } else if (category === 'photos' || category === 'videos') {
      // 페이지네이션으로 첫 페이지 가져오기
      const result = await dataCache.getPhotosPaginated(user.id, {
        category: category as CategoryFilter,
        limit: 40,
        cursor: 0,
      })
      setPhotos(result.data as Photo[])
      setHasMore(result.hasMore)
      setCursor(result.nextCursor)
    } else {
      // documents 등 기타 카테고리는 전체 로드 (클라이언트 필터링)
      const allPhotos = await dataCache.getAllPhotos(user.id)
      setPhotos(allPhotos as Photo[])
      setHasMore(false)
    }

    setLoading(false)
    setIsInitialLoad(false)
  }, [buildBreadcrumbs, user?.id, dataCache, isInitialLoad])

  // 무한 스크롤: 더 불러오기
  const loadMore = useCallback(async () => {
    const category = searchParams.get('category') || 'all'
    if (!user?.id || loadingMore || !hasMore) return
    if (category !== 'photos' && category !== 'videos') return

    setLoadingMore(true)

    try {
      const result = await dataCache.getPhotosPaginated(user.id, {
        category: category as CategoryFilter,
        limit: 40,
        cursor,
      })

      setPhotos(prev => [...prev, ...(result.data as Photo[])])
      setHasMore(result.hasMore)
      setCursor(result.nextCursor)
    } catch (error) {
      console.error('Load more error:', error)
    } finally {
      setLoadingMore(false)
    }
  }, [user?.id, loadingMore, hasMore, cursor, searchParams, dataCache])

  const fetchStorageUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/storage')
      if (!res.ok) {
        console.error('Storage usage error')
        return
      }
      const { usage } = await res.json()
      setStorageUsed(usage)
    } catch (err) {
      console.error('Failed to fetch storage usage:', err)
    }
  }, [])

  // 이전 폴더 ID 추적 (폴더 변경 시에만 선택 초기화)
  const prevFolderIdRef = useRef<string | null>(null)

  useEffect(() => {
    const folderId = searchParams.get('folder')
    const category = searchParams.get('category') || 'all'

    // 폴더가 변경된 경우에만 선택 상태 초기화
    if (prevFolderIdRef.current !== folderId) {
      setSelectedIds(new Set())
      setSelectedFolderIds(new Set())
      prevFolderIdRef.current = folderId
    }

    setCurrentFolderId(folderId)
    fetchData(folderId, category)
    fetchStorageUsage()
  }, [searchParams, fetchData, fetchStorageUsage])

  // 모바일 터치 이벤트 정리
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
      }
      if (autoScrollRef.current) {
        clearInterval(autoScrollRef.current)
      }
    }
  }, [])

  // 무한 스크롤: Intersection Observer
  useEffect(() => {
    const category = searchParams.get('category') || 'all'
    // photos/videos 탭에서만 무한 스크롤 활성화
    if (category !== 'photos' && category !== 'videos') return
    if (!loadMoreRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadMore()
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    )

    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [searchParams, hasMore, loadingMore, loadMore])

  // 폴더 정보 모달 - 내부 항목 수 가져오기
  useEffect(() => {
    if (!infoFolder || !user) {
      setInfoFolderCounts(null)
      return
    }

    const fetchFolderCounts = async () => {
      // 파일 수 가져오기
      const { count: fileCount } = await supabase
        .from('photos')
        .select('*', { count: 'exact', head: true })
        .eq('folder_id', infoFolder.id)
        .eq('user_id', user.id)

      // 하위 폴더 수 가져오기
      const { count: folderCount } = await supabase
        .from('folders')
        .select('*', { count: 'exact', head: true })
        .eq('parent_id', infoFolder.id)
        .eq('user_id', user.id)

      setInfoFolderCounts({
        files: fileCount || 0,
        folders: folderCount || 0
      })
    }

    fetchFolderCounts()
  }, [infoFolder, user])

  // 파일 선택 시
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setPendingFiles(Array.from(files))
    setShowFolderPicker(true)
    e.target.value = ''
  }

  // 드래그앤드롭 핸들러
  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setIsDragging(false)
    }
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    dragCounter.current = 0

    const items = e.dataTransfer.items
    const filesWithPath: { file: File, folderPath: string }[] = []
    const folderPaths: string[] = []
    let hasDroppedFolders = false

    // 폴더와 파일 처리
    const processEntry = async (entry: FileSystemEntry, path: string = ''): Promise<void> => {
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry
        return new Promise((resolve) => {
          fileEntry.file((file) => {
            // 이미지/비디오만 필터링
            if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
              filesWithPath.push({ file, folderPath: path })
            }
            resolve()
          })
        })
      } else if (entry.isDirectory) {
        hasDroppedFolders = true
        const dirEntry = entry as FileSystemDirectoryEntry
        const fullPath = path ? `${path}/${entry.name}` : entry.name
        folderPaths.push(fullPath)
        const reader = dirEntry.createReader()
        return new Promise((resolve) => {
          const readEntries = async () => {
            reader.readEntries(async (entries) => {
              if (entries.length === 0) {
                resolve()
                return
              }
              for (const childEntry of entries) {
                await processEntry(childEntry, fullPath)
              }
              // Chrome에서는 한 번에 100개만 읽어오므로 추가로 읽어야 함
              readEntries()
            })
          }
          readEntries()
        })
      }
    }

    // DataTransferItemList 처리
    const entries: FileSystemEntry[] = []
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry()
      if (entry) {
        entries.push(entry)
      }
    }

    // 모든 엔트리 처리
    for (const entry of entries) {
      await processEntry(entry)
    }

    // 폴더가 드롭된 경우: 폴더 구조 생성 후 파일 자동 업로드
    if (hasDroppedFolders && folderPaths.length > 0) {
      // 폴더 경로를 정렬 (상위 폴더가 먼저 생성되도록)
      const sortedPaths = [...new Set(folderPaths)].sort((a, b) => a.split('/').length - b.split('/').length)

      // 폴더 경로 -> ID 매핑
      const folderIdMap: Record<string, string> = {}

      // 폴더 생성
      for (const folderPath of sortedPaths) {
        const pathParts = folderPath.split('/')
        const folderName = pathParts[pathParts.length - 1]
        const parentPath = pathParts.slice(0, -1).join('/')

        // 부모 폴더 ID 결정
        let parentId: string | null = currentFolderId
        if (parentPath && folderIdMap[parentPath]) {
          parentId = folderIdMap[parentPath]
        }

        // 폴더 생성
        const { data: newFolder } = await supabase.from('folders').insert({
          name: folderName,
          parent_id: parentId,
          user_id: user?.id
        }).select('id').single()

        if (newFolder) {
          folderIdMap[folderPath] = newFolder.id
        }
      }

      // 파일이 있으면 바로 업로드 (폴더 피커 없이)
      if (filesWithPath.length > 0) {
        const uploadId = Date.now().toString()
        const newItems = filesWithPath.map((f, i) => ({ id: `${uploadId}-${i}`, name: f.file.name, status: 'pending' as const }))
        addToQueue(newItems)
        setShowUploadPanel(true)

        // 병렬 업로드 (10개씩 동시 처리)
        const CONCURRENT_UPLOADS = 10
        let completedCount = 0
        const uploadResults: { url: string, thumbnailUrl: string | null, name: string, folderId: string | null, index: number, fileType?: string, fileSize?: number, isVideo?: boolean }[] = []

        const uploadFile = async (index: number) => {
          const { file, folderPath } = filesWithPath[index]
          const itemId = `${uploadId}-${index}`
          let targetFolderId: string | null = currentFolderId
          if (folderPath && folderIdMap[folderPath]) {
            targetFolderId = folderIdMap[folderPath]
          }

          updateQueueItem(itemId, 'uploading')

          const timestamp = Date.now()
          const uniqueFileName = `${timestamp}_${index}_${file.name}`

          try {
            // 1. 원본 업로드
            const formData = new FormData()
            formData.append('file', file)
            formData.append('fileName', uniqueFileName)

            const uploadRes = await fetch('/api/upload', {
              method: 'POST',
              body: formData,
            })

            if (!uploadRes.ok) throw new Error('Upload failed')
            const { url } = await uploadRes.json()

            // 2. 썸네일 생성 및 업로드
            let thumbnailUrl: string | null = null
            const thumbnailBlob = await generateThumbnail(file)

            if (thumbnailBlob) {
              const thumbFileName = `thumb_${timestamp}_${index}_${file.name.replace(/\.[^.]+$/, '.webp')}`
              const thumbFormData = new FormData()
              thumbFormData.append('file', thumbnailBlob, thumbFileName)
              thumbFormData.append('fileName', thumbFileName)

              const thumbRes = await fetch('/api/upload', {
                method: 'POST',
                body: thumbFormData,
              })

              if (thumbRes.ok) {
                const thumbData = await thumbRes.json()
                thumbnailUrl = thumbData.url
              }
            }

            const isVideo = file.type.startsWith('video/')
            uploadResults.push({
              url,
              thumbnailUrl,
              name: file.name,
              folderId: targetFolderId,
              index,
              fileType: file.type,
              fileSize: file.size,
              isVideo,
            })

            // 현재 폴더에 업로드된 경우 즉시 화면에 표시
            const isSameFolder = (targetFolderId === null && currentFolderId === null) || targetFolderId === currentFolderId
            if (isSameFolder) {
              setPhotos(prev => {
                const exists = prev.some(p => p.url === url)
                if (exists) return prev
                return [...prev, {
                  id: `temp-${Date.now()}-${index}`,
                  url,
                  thumbnail_url: thumbnailUrl,
                  name: file.name,
                  order: prev.length + 1,
                  folder_id: targetFolderId,
                  created_at: new Date().toISOString(),
                }]
              })
            }

            updateQueueItem(itemId, 'done')
          } catch {
            updateQueueItem(itemId, 'error')
          }

          completedCount++
        }

        // 청크로 나눠서 병렬 처리
        for (let i = 0; i < filesWithPath.length; i += CONCURRENT_UPLOADS) {
          const chunk = filesWithPath.slice(i, i + CONCURRENT_UPLOADS)
          await Promise.all(chunk.map((_, idx) => uploadFile(i + idx)))
        }

        // DB 배치 인서트
        if (uploadResults.length > 0) {
          // 폴더별로 그룹화하여 order 계산
          const byFolder = new Map<string | null, typeof uploadResults>()
          for (const result of uploadResults) {
            const key = result.folderId
            if (!byFolder.has(key)) byFolder.set(key, [])
            byFolder.get(key)!.push(result)
          }

          for (const [folderId, items] of byFolder) {
            let query = supabase.from('photos').select('order').eq('user_id', user?.id).order('order', { ascending: false }).limit(1)
            if (folderId) {
              query = query.eq('folder_id', folderId)
            } else {
              query = query.is('folder_id', null)
            }
            const { data: maxOrderData } = await query
            const baseOrder = (maxOrderData?.[0]?.order || 0)

            const insertData = items.map((item, idx) => ({
              url: item.url,
              thumbnail_url: item.thumbnailUrl,
              name: item.name,
              order: baseOrder + idx + 1,
              folder_id: folderId,
              user_id: user?.id,
              file_type: item.fileType,
              file_size: item.fileSize,
              is_video: item.isVideo,
              hls_status: item.isVideo ? 'pending' : 'not_applicable',
            }))

            await supabase.from('photos').insert(insertData)
          }
        }

        dataCache.invalidateFolders()
        dataCache.invalidatePhotos()
        await fetchData(currentFolderId, searchParams.get('category') || 'all')
        await fetchStorageUsage()
      } else {
        // 파일 없이 폴더만 드롭한 경우
        dataCache.invalidateFolders()
        await fetchData(currentFolderId, searchParams.get('category') || 'all')
      }
    } else if (filesWithPath.length > 0) {
      // 폴더 없이 파일만 드롭한 경우: 기존 동작 (폴더 피커 표시)
      setPendingFiles(filesWithPath.map(f => f.file))
      setShowFolderPicker(true)
    }
  }

  // 중복 파일 체크
  const checkDuplicates = async (files: File[], targetFolderId: string | null): Promise<{ duplicates: DuplicateFile[], nonDuplicates: File[] }> => {
    // 대상 폴더의 기존 파일 목록 가져오기
    let query = supabase.from('photos').select('*')
    if (targetFolderId) {
      query = query.eq('folder_id', targetFolderId)
    } else {
      query = query.is('folder_id', null)
    }
    const { data: existingPhotos } = await query

    const duplicates: DuplicateFile[] = []
    const nonDuplicates: File[] = []

    for (const file of files) {
      // name 필드 또는 URL에서 추출한 이름으로 비교
      const existingPhoto = existingPhotos?.find(p => {
        const existingName = p.name || p.url.split('/').pop()?.replace(/^\d+_\d+_/, '') || ''
        return existingName === file.name
      })
      if (existingPhoto) {
        duplicates.push({ file, existingPhoto })
      } else {
        nonDuplicates.push(file)
      }
    }

    return { duplicates, nonDuplicates }
  }

  // 폴더 선택 후 업로드
  const handleUploadToFolder = async (targetFolderId: string | null) => {
    if (pendingFiles.length === 0) return

    setShowFolderPicker(false)

    // 중복 파일 체크
    const { duplicates, nonDuplicates } = await checkDuplicates(pendingFiles, targetFolderId)

    if (duplicates.length > 0) {
      // 중복 파일이 있으면 모달 표시
      setDuplicateFiles(duplicates)
      setNonDuplicateFiles(nonDuplicates)
      setPendingUploadFolderId(targetFolderId)
      setShowDuplicateModal(true)
      setPendingFiles([])
      return
    }

    // 중복 없으면 바로 업로드
    await executeUpload(pendingFiles, targetFolderId)
  }

  // 중복 처리 후 실제 업로드 실행
  const executeUpload = async (filesToUpload: File[], targetFolderId: string | null, photosToDelete?: Photo[]) => {
    if (filesToUpload.length === 0) {
      setPendingFiles([])
      setDuplicateFiles([])
      setNonDuplicateFiles([])
      return
    }

    // 덮어쓰기할 기존 파일 삭제
    if (photosToDelete && photosToDelete.length > 0) {
      // 원본 + 썸네일 삭제
      const deletePromises: Promise<Response | undefined>[] = []
      photosToDelete.forEach(photo => {
        // 원본 삭제
        const fileName = photo.url.split('/').pop()
        if (fileName) {
          deletePromises.push(fetch('/api/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName }),
          }))
        }
        // 썸네일 삭제
        if (photo.thumbnail_url) {
          const thumbName = photo.thumbnail_url.split('/').pop()
          if (thumbName) {
            deletePromises.push(fetch('/api/delete', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName: thumbName }),
            }))
          }
        }
      })
      await Promise.all(deletePromises)
      const photoIds = photosToDelete.map(p => p.id)
      // 소유자 확인을 위해 user_id 필터 추가
      await supabase.from('photos').delete().in('id', photoIds).eq('user_id', user?.id)
    }

    const fileList = filesToUpload
    const uploadId = Date.now().toString()
    const newItems = fileList.map((f, i) => ({ id: `${uploadId}-${i}`, name: f.name, status: 'pending' as const }))
    addToQueue(newItems)
    setShowUploadPanel(true)

    // 병렬 업로드 (10개씩 동시 처리)
    const CONCURRENT_UPLOADS = 10
    let completedCount = 0
    const uploadResults: { url: string, thumbnailUrl: string | null, name: string, index: number, fileType?: string, fileSize?: number, isVideo?: boolean }[] = []

    const uploadFile = async (index: number) => {
      const file = fileList[index]
      const itemId = `${uploadId}-${index}`

      updateQueueItem(itemId, 'uploading')

      const timestamp = Date.now()
      const uniqueFileName = `${timestamp}_${index}_${file.name}`

      try {
        // 1. 원본 업로드
        const formData = new FormData()
        formData.append('file', file)
        formData.append('fileName', uniqueFileName)

        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })

        if (!uploadRes.ok) throw new Error('Upload failed')
        const { url } = await uploadRes.json()

        // 2. 썸네일 생성 및 업로드
        let thumbnailUrl: string | null = null
        const thumbnailBlob = await generateThumbnail(file)

        if (thumbnailBlob) {
          const thumbFileName = `thumb_${timestamp}_${index}_${file.name.replace(/\.[^.]+$/, '.webp')}`
          const thumbFormData = new FormData()
          thumbFormData.append('file', thumbnailBlob, thumbFileName)
          thumbFormData.append('fileName', thumbFileName)

          const thumbRes = await fetch('/api/upload', {
            method: 'POST',
            body: thumbFormData,
          })

          if (thumbRes.ok) {
            const thumbData = await thumbRes.json()
            thumbnailUrl = thumbData.url
          }
        }

        const isVideo = file.type.startsWith('video/')
        uploadResults.push({
          url,
          thumbnailUrl,
          name: file.name,
          index,
          fileType: file.type,
          fileSize: file.size,
          isVideo,
        })

        // 현재 폴더에 업로드된 경우 즉시 화면에 표시
        const isSameFolder = (targetFolderId === null && currentFolderId === null) || targetFolderId === currentFolderId
        if (isSameFolder) {
          setPhotos(prev => {
            // 이미 있는 temp 항목 제외하고 추가
            const exists = prev.some(p => p.url === url)
            if (exists) return prev
            return [...prev, {
              id: `temp-${Date.now()}-${index}`,
              url,
              thumbnail_url: thumbnailUrl,
              name: file.name,
              order: prev.length + 1,
              folder_id: targetFolderId,
              created_at: new Date().toISOString(),
              is_video: isVideo,
            }]
          })
        }

        updateQueueItem(itemId, 'done')
      } catch {
        updateQueueItem(itemId, 'error')
      }

      completedCount++
    }

    // 청크로 나눠서 병렬 처리
    for (let i = 0; i < fileList.length; i += CONCURRENT_UPLOADS) {
      const chunk = fileList.slice(i, i + CONCURRENT_UPLOADS)
      await Promise.all(chunk.map((_, idx) => uploadFile(i + idx)))
    }

    // DB 배치 인서트
    if (uploadResults.length > 0) {
      let query = supabase.from('photos').select('order').eq('user_id', user?.id).order('order', { ascending: false }).limit(1)
      if (targetFolderId) {
        query = query.eq('folder_id', targetFolderId)
      } else {
        query = query.is('folder_id', null)
      }
      const { data: maxOrderData } = await query
      const baseOrder = maxOrderData?.[0]?.order || 0

      // 인덱스 순서대로 정렬하여 순서 유지
      uploadResults.sort((a, b) => a.index - b.index)

      const insertData = uploadResults.map((item, idx) => ({
        url: item.url,
        thumbnail_url: item.thumbnailUrl,
        name: item.name,
        order: baseOrder + idx + 1,
        folder_id: targetFolderId,
        user_id: user?.id,
        file_type: item.fileType,
        file_size: item.fileSize,
        is_video: item.isVideo,
        hls_status: item.isVideo ? 'pending' : 'not_applicable',
      }))

      await supabase.from('photos').insert(insertData)
    }

    setPendingFiles([])
    setDuplicateFiles([])
    setNonDuplicateFiles([])
    dataCache.invalidatePhotos()
    await fetchData(currentFolderId, searchParams.get('category') || 'all')
    await fetchStorageUsage()
  }

  // 중복 파일 처리 선택
  const handleDuplicateAction = async (action: 'overwrite' | 'keep' | 'skip') => {
    setShowDuplicateModal(false)

    let filesToUpload: File[] = [...nonDuplicateFiles]
    let photosToDelete: Photo[] = []

    if (action === 'overwrite') {
      // 덮어쓰기: 기존 파일 삭제 후 새 파일 업로드
      filesToUpload = [...nonDuplicateFiles, ...duplicateFiles.map(d => d.file)]
      photosToDelete = duplicateFiles.map(d => d.existingPhoto)
    } else if (action === 'keep') {
      // 둘 다 유지: 파일명에 번호 추가
      const renamedFiles = duplicateFiles.map(d => {
        const nameParts = d.file.name.split('.')
        const ext = nameParts.pop()
        const baseName = nameParts.join('.')
        const newName = `${baseName} (1).${ext}`
        return new File([d.file], newName, { type: d.file.type })
      })
      filesToUpload = [...nonDuplicateFiles, ...renamedFiles]
    }
    // skip: 중복 파일은 업로드하지 않음 (nonDuplicateFiles만 업로드)

    await executeUpload(filesToUpload, pendingUploadFolderId, photosToDelete)
    setPendingUploadFolderId(null)
  }

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/')
  }

  const handleDeleteSelected = async () => {
    const totalItems = selectedIds.size + selectedFolderIds.size
    if (totalItems === 0) return
    if (!confirm(`${totalItems}개 항목을 삭제할까요?`)) return

    setDeleting(true)

    try {
      // R2 파일 삭제 헬퍼 함수 (타임아웃 10초)
      const deleteFileFromR2 = async (fileName: string) => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        try {
          const res = await fetch('/api/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName }),
            signal: controller.signal,
          })
          if (!res.ok) {
            console.warn(`R2 delete failed for ${fileName}: ${res.status}`)
          }
        } catch (e) {
          console.warn(`R2 delete error for ${fileName}:`, e)
        } finally {
          clearTimeout(timeout)
        }
      }

      // 폴더 삭제
      const foldersToDelete = folders.filter(f => selectedFolderIds.has(f.id))
      for (let i = 0; i < foldersToDelete.length; i++) {
        const folder = foldersToDelete[i]
        setDeleteStatus(`폴더 삭제 중... (${i + 1}/${foldersToDelete.length})`)

        // 폴더 내 모든 항목 수집 및 삭제 (handleDeleteFolder 로직 재사용)
        const collectItems = async (id: string): Promise<{ folders: string[], photos: { id: string, url: string, thumbnail_url: string | null }[] }> => {
          const result = { folders: [id], photos: [] as { id: string, url: string, thumbnail_url: string | null }[] }
          const { data: childFolders } = await supabase.from('folders').select('id').eq('parent_id', id)
          if (childFolders) {
            for (const child of childFolders) {
              const childItems = await collectItems(child.id)
              result.folders.push(...childItems.folders)
              result.photos.push(...childItems.photos)
            }
          }
          const { data: folderPhotos } = await supabase.from('photos').select('id, url, thumbnail_url').eq('folder_id', id)
          if (folderPhotos) result.photos.push(...folderPhotos)
          return result
        }

        const items = await collectItems(folder.id)

        // R2 파일 삭제 (병렬) - 원본 + 썸네일
        if (items.photos.length > 0) {
          const deletePromises: Promise<void>[] = []
          items.photos.forEach(photo => {
            // 원본 삭제
            const fileName = photo.url.split('/').pop()
            if (fileName) {
              deletePromises.push(deleteFileFromR2(decodeURIComponent(fileName)))
            }
            // 썸네일 삭제
            if (photo.thumbnail_url) {
              const thumbName = photo.thumbnail_url.split('/').pop()
              if (thumbName) {
                deletePromises.push(deleteFileFromR2(decodeURIComponent(thumbName)))
              }
            }
          })
          await Promise.all(deletePromises)

          // DB에서 사진 삭제 (배치) - 소유자 확인
          const photoIds = items.photos.map(p => p.id)
          const { error: dbError } = await supabase.from('photos').delete().in('id', photoIds).eq('user_id', user?.id)
          if (dbError) console.error('DB delete error:', dbError)
        }

        // 폴더 삭제 (역순으로 - 하위 폴더부터) - 소유자 확인
        for (let j = items.folders.length - 1; j >= 0; j--) {
          await supabase.from('folders').delete().eq('id', items.folders[j]).eq('user_id', user?.id)
        }
      }

      // 사진 삭제 (병렬 처리)
      const photosToDelete = photos.filter(p => selectedIds.has(p.id))
      if (photosToDelete.length > 0) {
        setDeleteStatus(`파일 삭제 중... (${photosToDelete.length}개)`)

        // R2 파일 삭제 (병렬)
        const deletePromises: Promise<void>[] = []
        photosToDelete.forEach(photo => {
          // 원본 삭제
          const fileName = photo.url.split('/').pop()
          if (fileName) {
            deletePromises.push(deleteFileFromR2(decodeURIComponent(fileName)))
          }
          // 썸네일 삭제
          if (photo.thumbnail_url) {
            const thumbName = photo.thumbnail_url.split('/').pop()
            if (thumbName) {
              deletePromises.push(deleteFileFromR2(decodeURIComponent(thumbName)))
            }
          }
        })
        await Promise.all(deletePromises)

        // DB 삭제 (배치) - 소유자 확인
        const photoIds = photosToDelete.map(p => p.id)
        const { error: dbError } = await supabase.from('photos').delete().in('id', photoIds).eq('user_id', user?.id)
        if (dbError) console.error('DB delete error:', dbError)
      }

      setSelectedIds(new Set())
      setSelectedFolderIds(new Set())
      dataCache.invalidateFolders()
      dataCache.invalidatePhotos()
      await fetchData(currentFolderId, searchParams.get('category') || 'all')
      await fetchStorageUsage()
    } catch (error) {
      console.error('Delete error:', error)
      alert('삭제 중 오류가 발생했습니다.')
    } finally {
      setDeleting(false)
      setDeleteStatus('')
    }
  }

  // 선택된 항목 이동
  const handleMoveSelected = async (targetFolderId: string | null) => {
    if (selectedIds.size === 0 && selectedFolderIds.size === 0) return

    setMoving(true)

    try {
      // 사진 이동
      if (selectedIds.size > 0) {
        const photoIds = Array.from(selectedIds)
        await supabase
          .from('photos')
          .update({ folder_id: targetFolderId })
          .in('id', photoIds)
          .eq('user_id', user?.id)
      }

      // 폴더 이동 (자기 자신이나 하위 폴더로는 이동 불가)
      if (selectedFolderIds.size > 0) {
        const folderIds = Array.from(selectedFolderIds)

        // 이동 대상 폴더가 선택된 폴더의 하위인지 확인
        const isDescendant = (parentId: string | null, checkId: string): boolean => {
          if (parentId === null) return false
          if (parentId === checkId) return true
          const parent = allFolders.find(f => f.id === parentId)
          return parent ? isDescendant(parent.parent_id, checkId) : false
        }

        for (const folderId of folderIds) {
          // 자기 자신이나 하위 폴더로 이동 방지
          if (targetFolderId === folderId || isDescendant(targetFolderId, folderId)) {
            continue
          }

          await supabase
            .from('folders')
            .update({ parent_id: targetFolderId })
            .eq('id', folderId)
            .eq('user_id', user?.id)
        }
      }

      setShowMoveModal(false)
      setSelectedIds(new Set())
      setSelectedFolderIds(new Set())
      dataCache.invalidateFolders()
      dataCache.invalidatePhotos()
      await fetchData(currentFolderId, searchParams.get('category') || 'all')
    } catch (error) {
      console.error('Move error:', error)
    } finally {
      setMoving(false)
    }
  }

  // 선택된 사진 다운로드
  const handleDownloadSelected = async () => {
    if (selectedIds.size === 0) return

    const selectedPhotos = photos.filter(p => selectedIds.has(p.id))
    const downloadItems = selectedPhotos.map(photo => ({
      id: photo.id,
      name: photo.name,
      url: photo.url,
    }))

    await startDownload(downloadItems)

    // 선택 해제
    setSelectedIds(new Set())
    setSelectedFolderIds(new Set())
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !user?.id) return

    await supabase.from('folders').insert({
      name: newFolderName.trim(),
      parent_id: currentFolderId,
      user_id: user.id
    })
    setNewFolderName('')
    setShowNewFolderInput(false)
    dataCache.invalidateFolders()
    await fetchData(currentFolderId, searchParams.get('category') || 'all')
  }

  const handleRenameFolder = async () => {
    if (!editingFolder || !editFolderName.trim()) return

    await supabase.from('folders')
      .update({ name: editFolderName.trim() })
      .eq('id', editingFolder.id)

    setEditingFolder(null)
    setEditFolderName('')
    dataCache.invalidateFolders()
    await fetchData(currentFolderId, searchParams.get('category') || 'all')
  }

  const handleRenamePhoto = async () => {
    if (!editingPhoto || !editPhotoName.trim()) return

    await supabase.from('photos')
      .update({ name: editPhotoName.trim() })
      .eq('id', editingPhoto.id)

    // 로컬 상태도 업데이트
    setPhotos(prev => prev.map(p =>
      p.id === editingPhoto.id ? { ...p, name: editPhotoName.trim() } : p
    ))

    setEditingPhoto(null)
    setEditPhotoName('')
  }

  // 현재 활성화된 드래그 컨테이너
  const activeDragContainerRef = useRef<HTMLDivElement | null>(null)

  // 드래그 선택 핸들러 (그리드/리스트 공용)
  const handleDragSelectStart = (e: React.MouseEvent, containerRef: React.RefObject<HTMLDivElement | null>) => {
    // 좌클릭만, 그리고 아이템 위에서 시작하지 않을 때만
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.image-item, .folder-item, .list-item, button, input, .modal-backdrop, .tds-modal-backdrop, .tds-dialog-backdrop')) return

    const container = containerRef.current
    if (!container) return

    activeDragContainerRef.current = container

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left + container.scrollLeft
    const y = e.clientY - rect.top + container.scrollTop

    setDragSelectStart({ x, y })
    setDragSelectCurrent({ x, y })
    setIsDragSelecting(true)

    // 기존 선택 해제 (Shift 키 안 누르면)
    if (!e.shiftKey) {
      setSelectedIds(new Set())
      setSelectedFolderIds(new Set())
    }
  }

  const handleDragSelectMove = (e: React.MouseEvent) => {
    if (!isDragSelecting || !dragSelectStart) return

    const container = activeDragContainerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left + container.scrollLeft
    const y = e.clientY - rect.top + container.scrollTop

    setDragSelectCurrent({ x, y })

    // 선택 박스 범위 계산
    const left = Math.min(dragSelectStart.x, x)
    const right = Math.max(dragSelectStart.x, x)
    const top = Math.min(dragSelectStart.y, y)
    const bottom = Math.max(dragSelectStart.y, y)

    // 아이템들과 겹치는지 확인
    const newSelectedIds = new Set<string>()
    const newSelectedFolderIds = new Set<string>()

    // 폴더 체크 (그리드 & 리스트)
    container.querySelectorAll('[data-folder-id]').forEach((el) => {
      const itemRect = el.getBoundingClientRect()
      const itemLeft = itemRect.left - rect.left + container.scrollLeft
      const itemTop = itemRect.top - rect.top + container.scrollTop
      const itemRight = itemLeft + itemRect.width
      const itemBottom = itemTop + itemRect.height

      // 겹치는지 확인
      if (!(right < itemLeft || left > itemRight || bottom < itemTop || top > itemBottom)) {
        const folderId = (el as HTMLElement).dataset.folderId
        if (folderId) newSelectedFolderIds.add(folderId)
      }
    })

    // 사진 체크 (그리드 & 리스트)
    container.querySelectorAll('[data-photo-id]').forEach((el) => {
      const itemRect = el.getBoundingClientRect()
      const itemLeft = itemRect.left - rect.left + container.scrollLeft
      const itemTop = itemRect.top - rect.top + container.scrollTop
      const itemRight = itemLeft + itemRect.width
      const itemBottom = itemTop + itemRect.height

      // 겹치는지 확인
      if (!(right < itemLeft || left > itemRight || bottom < itemTop || top > itemBottom)) {
        const photoId = (el as HTMLElement).dataset.photoId
        if (photoId) newSelectedIds.add(photoId)
      }
    })

    setSelectedIds(newSelectedIds)
    setSelectedFolderIds(newSelectedFolderIds)
  }

  const handleDragSelectEnd = () => {
    setIsDragSelecting(false)
    setDragSelectStart(null)
    setDragSelectCurrent(null)
    activeDragContainerRef.current = null
  }

  // 모바일: 길게 누르기로 선택 모드 진입
  const handleLongPress = useCallback((itemId: string, isFolder: boolean) => {
    // 햅틱 피드백 (지원되는 경우)
    if (navigator.vibrate) {
      navigator.vibrate(50)
    }

    if (isFolder) {
      setSelectedFolderIds(new Set([itemId]))
    } else {
      setSelectedIds(new Set([itemId]))
    }
  }, [])

  const handleItemTouchStart = useCallback((e: React.TouchEvent, itemId: string, isFolder: boolean, itemIndex: number, foldersCount: number) => {
    const touch = e.touches[0]
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY }

    // 이미 선택 모드면 드래그 선택 시작 준비
    if (isSelecting) {
      setTouchDragStart({ x: touch.clientX, y: touch.clientY })
      lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY }
      // 시작 아이템 정보 저장 (범위 선택용)
      const combinedIndex = isFolder ? itemIndex : foldersCount + itemIndex
      setTouchDragStartItem({ id: itemId, isFolder, combinedIndex })
      return
    }

    // 길게 누르기 타이머 시작 (500ms)
    longPressTimerRef.current = setTimeout(() => {
      handleLongPress(itemId, isFolder)
      longPressTimerRef.current = null
    }, 500)
  }, [isSelecting, handleLongPress])

  const handleItemTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]

    // 길게 누르기 취소 (움직임 감지)
    if (touchStartPosRef.current && longPressTimerRef.current) {
      const dx = touch.clientX - touchStartPosRef.current.x
      const dy = touch.clientY - touchStartPosRef.current.y
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }

    // 선택 모드에서 드래그 선택 (일정 거리 이상 이동해야 시작)
    if (isSelecting && touchDragStart && touchDragStartItem) {
      const dx = touch.clientX - touchDragStart.x
      const dy = touch.clientY - touchDragStart.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      // 20px 이상 이동해야 드래그 선택 시작 (탭과 구분)
      if (distance < 20) {
        return
      }

      // 드래그 선택 중 스크롤 방지
      e.preventDefault()
      setIsTouchDragging(true)
      lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY }

      // 터치 위치의 아이템 찾기
      const element = document.elementFromPoint(touch.clientX, touch.clientY)
      if (element) {
        const itemEl = element.closest('[data-photo-id], [data-folder-id]') as HTMLElement | null
        if (itemEl) {
          const photoId = itemEl.dataset.photoId
          const folderId = itemEl.dataset.folderId
          const folders = sortedFoldersRef.current
          const photos = sortedPhotosRef.current

          // 현재 아이템의 combined index 계산
          let currentCombinedIndex = -1
          if (folderId) {
            const folderIndex = folders.findIndex(f => f.id === folderId)
            if (folderIndex !== -1) currentCombinedIndex = folderIndex
          } else if (photoId) {
            const photoIndex = photos.findIndex(p => p.id === photoId)
            if (photoIndex !== -1) currentCombinedIndex = folders.length + photoIndex
          }

          // 범위 선택: 시작 인덱스부터 현재 인덱스까지 모든 아이템 선택
          if (currentCombinedIndex !== -1) {
            const startIndex = touchDragStartItem.combinedIndex
            const minIndex = Math.min(startIndex, currentCombinedIndex)
            const maxIndex = Math.max(startIndex, currentCombinedIndex)

            const newFolderIds = new Set<string>()
            const newPhotoIds = new Set<string>()

            for (let i = minIndex; i <= maxIndex; i++) {
              if (i < folders.length) {
                // 폴더 영역
                newFolderIds.add(folders[i].id)
              } else {
                // 사진 영역
                const photoIndex = i - folders.length
                if (photos[photoIndex]) {
                  newPhotoIds.add(photos[photoIndex].id)
                }
              }
            }

            setSelectedFolderIds(newFolderIds)
            setSelectedIds(newPhotoIds)
          }
        }
      }

      // 자동 스크롤 (화면 가장자리 - 뷰포트 기준)
      const viewportHeight = window.innerHeight
      const scrollSpeed = 15
      const edgeThreshold = 80 // 상단/하단 80px 영역

      // 기존 자동 스크롤 중지
      if (autoScrollRef.current) {
        clearInterval(autoScrollRef.current)
        autoScrollRef.current = null
      }

      // 상단/하단 가장자리 감지 (뷰포트 기준)
      if (touch.clientY < edgeThreshold) {
        // 위로 스크롤 (상단 가장자리)
        autoScrollRef.current = setInterval(() => {
          window.scrollBy(0, -scrollSpeed)
        }, 16)
      } else if (touch.clientY > viewportHeight - edgeThreshold - 68) {
        // 아래로 스크롤 (하단 가장자리, 하단 탭바 68px 고려)
        autoScrollRef.current = setInterval(() => {
          window.scrollBy(0, scrollSpeed)
        }, 16)
      }
    }
  }, [isSelecting, touchDragStart, touchDragStartItem])

  const handleItemTouchEnd = useCallback(() => {
    // 길게 누르기 타이머 정리
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }

    // 자동 스크롤 정리
    if (autoScrollRef.current) {
      clearInterval(autoScrollRef.current)
      autoScrollRef.current = null
    }

    // 터치 드래그 상태 리셋
    setIsTouchDragging(false)
    setTouchDragStart(null)
    setTouchDragStartItem(null)
    touchStartPosRef.current = null
    lastTouchPosRef.current = null
  }, [])

  // 터치 드래그 중 body 스크롤 방지
  useEffect(() => {
    if (isTouchDragging) {
      document.body.style.overflow = 'hidden'
      document.body.style.touchAction = 'none'
    } else {
      document.body.style.overflow = ''
      document.body.style.touchAction = ''
    }
    return () => {
      document.body.style.overflow = ''
      document.body.style.touchAction = ''
    }
  }, [isTouchDragging])

  // 선택 모드에서 아이템 탭으로 선택 토글
  const handleItemTap = useCallback((e: React.MouseEvent | React.TouchEvent, itemId: string, isFolder: boolean, index?: number) => {
    // 터치 드래그 중이면 무시
    if (isTouchDragging) return

    if (isSelecting) {
      e.preventDefault()
      e.stopPropagation()
      if (isFolder) {
        setSelectedFolderIds(prev => {
          const next = new Set(prev)
          if (next.has(itemId)) next.delete(itemId)
          else next.add(itemId)
          return next
        })
      } else {
        setSelectedIds(prev => {
          const next = new Set(prev)
          if (next.has(itemId)) next.delete(itemId)
          else next.add(itemId)
          return next
        })
      }
    }
  }, [isSelecting, isTouchDragging])

  const handleDeleteFolder = async (folderId: string) => {
    closeFolderMenu()

    if (!confirm('폴더와 모든 내용을 삭제할까요?')) return

    setDeleting(true)
    setDeleteStatus('삭제 준비 중...')

    // 먼저 모든 삭제할 항목 수집
    const collectItems = async (id: string): Promise<{ folders: string[], photos: { id: string, url: string, thumbnail_url: string | null }[] }> => {
      const result = { folders: [id], photos: [] as { id: string, url: string, thumbnail_url: string | null }[] }

      const { data: childFolders } = await supabase
        .from('folders')
        .select('id')
        .eq('parent_id', id)

      if (childFolders) {
        for (const child of childFolders) {
          const childItems = await collectItems(child.id)
          result.folders.push(...childItems.folders)
          result.photos.push(...childItems.photos)
        }
      }

      const { data: folderPhotos } = await supabase
        .from('photos')
        .select('id, url, thumbnail_url')
        .eq('folder_id', id)

      if (folderPhotos) {
        result.photos.push(...folderPhotos)
      }

      return result
    }

    const items = await collectItems(folderId)
    const totalPhotos = items.photos.length
    const totalFolders = items.folders.length

    // 사진 삭제 (병렬 처리) - 원본 + 썸네일
    if (totalPhotos > 0) {
      setDeleteStatus(`파일 삭제 중... (${totalPhotos}개)`)

      // R2 파일 삭제 (병렬)
      const deletePromises: Promise<Response | undefined>[] = []
      items.photos.forEach(photo => {
        // 원본 삭제
        const fileName = photo.url.split('/').pop()
        if (fileName) {
          deletePromises.push(fetch('/api/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName }),
          }))
        }
        // 썸네일 삭제
        if (photo.thumbnail_url) {
          const thumbName = photo.thumbnail_url.split('/').pop()
          if (thumbName) {
            deletePromises.push(fetch('/api/delete', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName: thumbName }),
            }))
          }
        }
      })
      await Promise.all(deletePromises)

      // DB에서 사진 삭제 (배치) - 소유자 확인
      const photoIds = items.photos.map(p => p.id)
      await supabase.from('photos').delete().in('id', photoIds).eq('user_id', user?.id)
    }

    // 폴더 삭제 (역순으로 - 하위 폴더부터) - 소유자 확인
    setDeleteStatus(`폴더 삭제 중... (${totalFolders}개)`)
    for (let i = items.folders.length - 1; i >= 0; i--) {
      await supabase.from('folders').delete().eq('id', items.folders[i]).eq('user_id', user?.id)
    }

    setDeleting(false)
    setDeleteStatus('')
    dataCache.invalidateFolders()
    dataCache.invalidatePhotos()
    await fetchData(currentFolderId, searchParams.get('category') || 'all')
    await fetchStorageUsage()
  }

  const toggleSelect = (id: string, e: React.MouseEvent, index: number) => {
    e.stopPropagation()
    const newSet = new Set(selectedIds)

    // Shift+클릭: 범위 선택
    if (e.shiftKey && lastSelectedIndex?.type === 'photo') {
      const start = Math.min(lastSelectedIndex.index, index)
      const end = Math.max(lastSelectedIndex.index, index)
      for (let i = start; i <= end; i++) {
        if (sortedPhotos[i]) {
          newSet.add(sortedPhotos[i].id)
        }
      }
    } else {
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
    }

    setSelectedIds(newSet)
    setLastSelectedIndex({ type: 'photo', index })
  }

  const toggleFolderSelect = (id: string, e: React.MouseEvent, index?: number) => {
    e.stopPropagation()
    const newSet = new Set(selectedFolderIds)
    const currentIndex = index ?? sortedFolders.findIndex(f => f.id === id)

    // Shift+클릭: 범위 선택
    if (e.shiftKey && lastSelectedIndex?.type === 'folder') {
      const start = Math.min(lastSelectedIndex.index, currentIndex)
      const end = Math.max(lastSelectedIndex.index, currentIndex)
      for (let i = start; i <= end; i++) {
        if (sortedFolders[i]) {
          newSet.add(sortedFolders[i].id)
        }
      }
    } else {
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
    }

    setSelectedFolderIds(newSet)
    setLastSelectedIndex({ type: 'folder', index: currentIndex })
  }

  const selectAll = () => {
    setSelectedIds(new Set(photos.map(p => p.id)))
    setSelectedFolderIds(new Set(folders.map(f => f.id)))
  }

  // 폴더 트리 빌드 (폴더 선택용)
  const buildFolderTree = (parentId: string | null, depth: number = 0): { folder: Folder | null, depth: number }[] => {
    const result: { folder: Folder | null, depth: number }[] = []

    if (parentId === null && depth === 0) {
      result.push({ folder: null, depth: 0 })
    }

    const children = allFolders.filter(f => f.parent_id === parentId)
    for (const child of children) {
      result.push({ folder: child, depth: depth + 1 })
      result.push(...buildFolderTree(child.id, depth + 1))
    }

    return result
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const isThisYear = date.getFullYear() === now.getFullYear()

    if (isThisYear) {
      return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
    }
    return date.toLocaleDateString('ko-KR', { year: '2-digit', month: 'short', day: 'numeric' })
  }

  // 카테고리 필터링
  const currentCategory = (searchParams.get('category') as FileCategory) || 'all'

  // 사진/동영상 카테고리는 무조건 그리드 뷰
  const effectiveViewMode = (currentCategory === 'photos' || currentCategory === 'videos') ? 'grid' : viewMode

  const filteredPhotos = useMemo(() => {
    const result = photos.filter(photo => {
      if (currentCategory === 'all') return true
      const ext = photo.name?.split('.').pop()?.toLowerCase() || ''
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif']
      const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'm4v']
      const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv']

      if (currentCategory === 'photos') return imageExts.includes(ext)
      if (currentCategory === 'videos') return videoExts.includes(ext)
      if (currentCategory === 'documents') return docExts.includes(ext)
      return true
    })
    return result
  }, [photos, currentCategory])

  // 정렬된 사진 목록
  const sortedPhotos = useMemo(() => {
    // photos/videos 카테고리는 페이지네이션 사용 - DB 순서 유지 (재정렬 안함)
    if (currentCategory === 'photos' || currentCategory === 'videos') {
      return filteredPhotos
    }

    // 다른 카테고리는 클라이언트에서 정렬
    return [...filteredPhotos].sort((a, b) => {
      if (sortBy === 'name') {
        const nameA = (a.name || a.url.split('/').pop() || '').toLowerCase()
        const nameB = (b.name || b.url.split('/').pop() || '').toLowerCase()
        return sortOrder === 'asc'
          ? nameA.localeCompare(nameB, 'ko')
          : nameB.localeCompare(nameA, 'ko')
      } else {
        const dateA = new Date(a.created_at).getTime()
        const dateB = new Date(b.created_at).getTime()
        return sortOrder === 'asc' ? dateA - dateB : dateB - dateA
      }
    })
  }, [filteredPhotos, sortBy, sortOrder, currentCategory])

  // 정렬된 폴더 목록
  const sortedFolders = useMemo(() => {
    return [...folders].sort((a, b) => {
      if (sortBy === 'name') {
        return sortOrder === 'asc'
          ? a.name.localeCompare(b.name, 'ko')
          : b.name.localeCompare(a.name, 'ko')
      } else {
        const dateA = new Date(a.created_at).getTime()
        const dateB = new Date(b.created_at).getTime()
        return sortOrder === 'asc' ? dateA - dateB : dateB - dateA
      }
    })
  }, [folders, sortBy, sortOrder])

  // refs 업데이트 (범위 선택용)
  useEffect(() => {
    sortedFoldersRef.current = sortedFolders
    sortedPhotosRef.current = sortedPhotos
  }, [sortedFolders, sortedPhotos])

  // 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // 메뉴 버튼이나 메뉴 내부를 클릭한 경우 무시
      if (target.closest('[data-menu-button]') || target.closest('[data-menu-dropdown]')) {
        return
      }
      setFolderMenuId(null)
      setFolderMenuPosition(null)
      setPhotoMenuId(null)
      setPhotoMenuPosition(null)
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // 폴더 컨텍스트 메뉴 컴포넌트
  const FolderContextMenu = ({ folder }: { folder: Folder }) => {
    const menuWidth = 220
    const safeAreaBottom = 120

    const clickY = folderMenuPosition?.y || 0
    const clickX = folderMenuPosition?.x || 0

    const maxMenuHeight = typeof window !== 'undefined'
      ? Math.min(400, window.innerHeight * 0.6)
      : 350

    const spaceBelow = typeof window !== 'undefined'
      ? window.innerHeight - clickY - safeAreaBottom
      : 400
    const spaceAbove = clickY - 60

    const showAbove = spaceBelow < 200 && spaceAbove > spaceBelow

    let top: number | string = 'auto'
    let bottom: number | string = 'auto'

    if (showAbove) {
      bottom = typeof window !== 'undefined'
        ? window.innerHeight - clickY + 8
        : 'auto'
    } else {
      top = clickY
    }

    let left = clickX - menuWidth
    if (typeof window !== 'undefined') {
      if (left < 10) left = 10
      if (left + menuWidth > window.innerWidth - 10) {
        left = window.innerWidth - menuWidth - 10
      }
    }

    return (
      <div
        data-menu-dropdown
        className="fixed min-w-[200px] overflow-y-auto rounded-xl shadow-lg animate-fade-in"
        style={{
          zIndex: 9999,
          background: 'var(--background-elevated)',
          border: '1px solid var(--glass-border)',
          top: typeof top === 'number' ? top : undefined,
          bottom: typeof bottom === 'number' ? bottom : undefined,
          left,
          maxHeight: maxMenuHeight,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 폴더명 헤더 */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <p className="font-semibold text-sm truncate" style={{ color: 'var(--foreground)' }}>{folder.name}</p>
        </div>

        {/* 공유 섹션 */}
        <div className="py-1">
          <button
            onClick={async (e) => {
              e.stopPropagation()
              closeFolderMenu()
              // 폴더 공유 링크 복사 (현재 URL 기반)
              const shareUrl = `${window.location.origin}/drive?folder=${folder.id}`
              await navigator.clipboard.writeText(shareUrl)
              alert('링크가 복사되었습니다')
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--foreground)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            링크 복사
          </button>
        </div>

        {/* 구분선 */}
        <div style={{ borderTop: '1px solid var(--glass-border)' }} />

        {/* 편집 섹션 */}
        <div className="py-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              closeFolderMenu()
              setEditingFolder(folder)
              setEditFolderName(folder.name)
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--foreground)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            이름 변경
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              closeFolderMenu()
              setSelectedFolderIds(new Set([folder.id]))
              setSelectedIds(new Set())
              setShowMoveModal(true)
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--foreground)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            이동
          </button>
        </div>

        {/* 구분선 */}
        <div style={{ borderTop: '1px solid var(--glass-border)' }} />

        {/* 삭제 */}
        <div className="py-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              closeFolderMenu()
              handleDeleteFolder(folder.id)
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-red-500/10"
            style={{ color: 'var(--error)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            삭제
          </button>
        </div>

        {/* 구분선 */}
        <div style={{ borderTop: '1px solid var(--glass-border)' }} />

        {/* 정보 */}
        <div className="py-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              closeFolderMenu()
              setInfoFolder(folder)
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--foreground)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            폴더 정보
          </button>
        </div>
      </div>
    )
  }

  // 파일 컨텍스트 메뉴 컴포넌트
  const PhotoContextMenu = ({ photo }: { photo: Photo }) => {
    const menuWidth = 220
    const safeAreaBottom = 120 // 하단 탭바 + 여유 공간

    const clickY = photoMenuPosition?.y || 0
    const clickX = photoMenuPosition?.x || 0

    // 화면 높이의 60%를 최대 메뉴 높이로 설정
    const maxMenuHeight = typeof window !== 'undefined'
      ? Math.min(500, window.innerHeight * 0.6)
      : 400

    // 메뉴를 클릭 위치 위에 표시할지 아래에 표시할지 결정
    const spaceBelow = typeof window !== 'undefined'
      ? window.innerHeight - clickY - safeAreaBottom
      : 400
    const spaceAbove = clickY - 60 // 헤더 높이 고려

    // 아래 공간이 부족하고 위에 공간이 있으면 위에 표시
    const showAbove = spaceBelow < 250 && spaceAbove > spaceBelow

    let top: number | string = 'auto'
    let bottom: number | string = 'auto'

    if (showAbove) {
      // 클릭 위치 위에 표시 (bottom 기준)
      bottom = typeof window !== 'undefined'
        ? window.innerHeight - clickY + 8
        : 'auto'
    } else {
      // 클릭 위치 아래에 표시 (top 기준)
      top = clickY
    }

    // 좌우 위치 계산
    let left = clickX - menuWidth
    if (typeof window !== 'undefined') {
      if (left < 10) left = 10
      if (left + menuWidth > window.innerWidth - 10) {
        left = window.innerWidth - menuWidth - 10
      }
    }

    return (
      <div
        data-menu-dropdown
        className="fixed min-w-[200px] overflow-y-auto rounded-xl shadow-lg animate-fade-in"
        style={{
          zIndex: 9999,
          background: 'var(--background-elevated)',
          border: '1px solid var(--glass-border)',
          top: typeof top === 'number' ? top : undefined,
          bottom: typeof bottom === 'number' ? bottom : undefined,
          left,
          maxHeight: maxMenuHeight,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 파일명 헤더 */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <p className="font-semibold text-sm truncate" style={{ color: 'var(--foreground)' }}>
            {photo.name || photo.url.split('/').pop()}
          </p>
        </div>

        {/* 다운로드 */}
        <div className="py-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              closePhotoMenu()
              const link = document.createElement('a')
              link.href = toProxyUrl(photo.url)
              link.download = photo.name || photo.url.split('/').pop() || 'download'
              document.body.appendChild(link)
              link.click()
              document.body.removeChild(link)
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--foreground)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            다운로드
          </button>
        </div>

        {/* 구분선 */}
        <div style={{ borderTop: '1px solid var(--glass-border)' }} />

        {/* 공유 섹션 */}
        <div className="py-1">
          <button
            onClick={async (e) => {
              e.stopPropagation()
              closePhotoMenu()
              // 이미지 URL 복사
              const imageUrl = `${window.location.origin}${toProxyUrl(photo.url)}`
              await navigator.clipboard.writeText(imageUrl)
              alert('링크가 복사되었습니다')
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--foreground)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            링크 복사
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation()
              closePhotoMenu()
              // 공유 링크 생성
              try {
                const res = await fetch('/api/share', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ photoId: photo.id }),
                })
                if (res.ok) {
                  const data = await res.json()
                  const shareUrl = `${window.location.origin}/share/${data.token}`
                  await navigator.clipboard.writeText(shareUrl)
                  alert('공유 링크가 복사되었습니다')
                }
              } catch (error) {
                console.error('Share error:', error)
              }
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--foreground)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            공유
          </button>
        </div>

        {/* 구분선 */}
        <div style={{ borderTop: '1px solid var(--glass-border)' }} />

        {/* 편집/삭제 섹션 */}
        <div className="py-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              closePhotoMenu()
              setEditingPhoto(photo)
              setEditPhotoName(photo.name || photo.url.split('/').pop() || '')
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--foreground)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            이름 변경
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              closePhotoMenu()
              setSelectedIds(new Set([photo.id]))
              setSelectedFolderIds(new Set())
              setShowMoveModal(true)
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--foreground)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            이동
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation()
              closePhotoMenu()
              // 파일 복사 기능 (같은 폴더에 복사본 생성)
              try {
                const res = await fetch('/api/copy', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ photoId: photo.id }),
                })
                if (res.ok) {
                  const data = await res.json()
                  setPhotos(prev => [...prev, data.photo])
                  alert('파일이 복사되었습니다')
                }
              } catch (error) {
                console.error('Copy error:', error)
              }
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--foreground)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            복사
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation()
              closePhotoMenu()
              if (!confirm('이 파일을 삭제하시겠습니까?')) return
              try {
                const res = await fetch('/api/delete', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ photoIds: [photo.id] }),
                })
                if (res.ok) {
                  setPhotos(prev => prev.filter(p => p.id !== photo.id))
                }
              } catch (error) {
                console.error('Delete error:', error)
              }
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-red-500/10"
            style={{ color: 'var(--error)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            삭제
          </button>
        </div>

        {/* 구분선 */}
        <div style={{ borderTop: '1px solid var(--glass-border)' }} />

        {/* 정보 */}
        <div className="py-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              closePhotoMenu()
              setInfoPhoto(photo)
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--foreground)' }}
          >
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            파일 정보
          </button>
        </div>

        {/* 마지막 수정 정보 푸터 */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--glass-border)', background: 'var(--background-secondary)' }}>
          <p className="text-xs" style={{ color: 'var(--foreground-tertiary)' }}>
            마지막 수정: {new Date(photo.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>
    )
  }

  // 최초 로딩 시 간단한 로딩 표시
  if (isInitialLoad && (loading || userLoading)) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>불러오는 중...</p>
        </div>
      </main>
    )
  }

  return (
    <main
      className="min-h-screen select-none"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 사이드바 */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        storageUsed={storageUsed}
      />

      {/* 로딩 인디케이터 (비초기 로딩) */}
      {!isInitialLoad && loading && (
        <div className="fixed top-0 left-0 right-0 z-[300]">
          <div className="h-0.5 w-full overflow-hidden" style={{ background: 'var(--background-secondary)' }}>
            <div
              className="h-full w-full origin-left animate-[loading_1s_ease-in-out_infinite]"
              style={{ background: 'var(--accent-primary)' }}
            />
          </div>
        </div>
      )}

      {/* 드래그 오버레이 */}
      {isDragging && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none animate-fade-in" style={{ background: 'rgba(99, 102, 241, 0.1)', backdropFilter: 'blur(4px)' }}>
          <div className="p-8 sm:p-10 rounded-2xl border-2 border-dashed glass animate-fade-in-scale" style={{ borderColor: 'var(--accent-primary)' }}>
            <div className="text-center">
              <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
                <svg className="w-8 h-8 sm:w-10 sm:h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="text-lg sm:text-xl font-semibold">파일 또는 폴더를 놓으세요</p>
              <p className="text-sm mt-1" style={{ color: 'var(--foreground-secondary)' }}>이미지, 비디오 또는 폴더를 업로드합니다</p>
            </div>
          </div>
        </div>
      )}

      {/* 메인 컨텐츠 (사이드바 여백 + 모바일 하단 탭 여백) */}
      {/* 모바일에서 업로드/더보기 탭 활성화시 숨김 */}
      <div className={`xl:pl-64 pb-20 xl:pb-0 ${(showUploadPanel || showMoreScreen) ? 'hidden xl:block' : ''}`}>
        {/* 헤더 */}
        <header className="header safe-area-top">
          <div className="header-content">
            {/* 왼쪽: 뒤로가기/메뉴 버튼 + 타이틀 */}
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              {/* 모바일 뒤로가기 버튼 (폴더 안에 있을 때) */}
              {breadcrumbs.length > 0 && (
                <button
                  onClick={() => {
                    const parentId = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : null
                    router.push(parentId ? `/drive?folder=${parentId}` : '/drive')
                  }}
                  className="sm:hidden p-2 -ml-2 rounded-xl transition-colors active:bg-black/5 dark:active:bg-white/5"
                  style={{ color: 'var(--foreground)' }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}

              {/* 태블릿 메뉴 버튼 (모바일에선 하단탭 사용) */}
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="hidden sm:block xl:hidden p-2 -ml-2 rounded-xl transition-colors"
                style={{ color: 'var(--foreground)' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* 현재 위치 */}
              <div className="flex items-center gap-2">
                {currentCategory !== 'all' ? (
                  <h1 className="font-semibold text-base sm:text-lg whitespace-nowrap" style={{ color: 'var(--foreground)' }}>
                    {currentCategory === 'photos' && '사진'}
                    {currentCategory === 'videos' && '동영상'}
                    {currentCategory === 'documents' && '문서'}
                  </h1>
                ) : breadcrumbs.length > 0 ? (
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <button
                      onClick={() => router.push('/drive')}
                      onMouseEnter={() => {
                        // 루트 폴더 사진 미리 로드
                        if (user?.id) {
                          dataCache.prefetchFolder(user.id, null)
                        }
                      }}
                      className="text-xs sm:text-sm hover:underline hidden sm:block"
                      style={{ color: 'var(--foreground-secondary)' }}
                    >
                      드라이브
                    </button>
                    <svg className="w-3 h-3 sm:w-4 sm:h-4 opacity-40 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="font-medium text-sm sm:text-base truncate max-w-[120px] sm:max-w-[200px]" style={{ color: 'var(--foreground)' }}>
                      {breadcrumbs[breadcrumbs.length - 1]?.name}
                    </span>
                  </div>
                ) : (
                  <h1 className="font-semibold text-base sm:text-lg whitespace-nowrap" style={{ color: 'var(--foreground)' }}>내 드라이브</h1>
                )}
              </div>
            </div>

            {/* 모바일 오른쪽: 보기 옵션 */}
            <div className="flex xl:hidden items-center gap-1">
              {/* 뷰 모드 토글 */}
              {currentCategory === 'all' && (
                <div className="flex items-center rounded-lg p-0.5" style={{ background: 'var(--background-tertiary)' }}>
                  <button
                    onClick={() => setViewMode('grid')}
                    className="p-1.5 rounded-md transition-all"
                    style={viewMode === 'grid' ? { background: 'var(--background)', boxShadow: 'var(--shadow-sm)' } : { opacity: 0.5 }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className="p-1.5 rounded-md transition-all"
                    style={viewMode === 'list' ? { background: 'var(--background)', boxShadow: 'var(--shadow-sm)' } : { opacity: 0.5 }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* 오른쪽: 데스크톱 액션 버튼들 - 1280px 이상에서만 표시 */}
            <div className="hidden xl:flex items-center gap-2">
              {/* 업로드 버튼 */}
              <label className="btn btn-primary cursor-pointer">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>업로드</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={handleFileSelect}
                  disabled={uploading}
                  className="hidden"
                />
              </label>

              {/* 새 폴더 버튼 */}
              <button
                onClick={() => setShowNewFolderInput(true)}
                className="btn btn-secondary"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
                <span>새 폴더</span>
              </button>

              {/* 뷰 모드 토글 - 사진/동영상 카테고리에서는 숨김 */}
              {currentCategory === 'all' && (
                <div className="flex items-center rounded-lg p-0.5" style={{ background: 'var(--background-tertiary)' }}>
                  <button
                    onClick={() => setViewMode('grid')}
                    className="p-2 rounded-md transition-all"
                    style={viewMode === 'grid' ? { background: 'var(--background)', boxShadow: 'var(--shadow-sm)' } : { opacity: 0.5 }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className="p-2 rounded-md transition-all"
                    style={viewMode === 'list' ? { background: 'var(--background)', boxShadow: 'var(--shadow-sm)' } : { opacity: 0.5 }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                  </button>
                </div>
              )}

              {/* 테마 토글 */}
              <button
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                className="btn btn-ghost !p-2"
                title={isDark ? '라이트 모드' : '다크 모드'}
              >
                {isDark ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>

              {/* 설정 */}
              <button
                onClick={() => router.push('/settings')}
                className="btn btn-ghost !p-2"
                title="설정"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              {/* 로그아웃 */}
              <button
                onClick={handleLogout}
                className="btn btn-ghost !p-2"
                title="로그아웃"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </header>

      {/* 선택 모드 툴바 */}
      {isSelecting && (
        <div className="selection-toolbar">
          {/* 왼쪽: 닫기 & 선택 정보 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSelectedIds(new Set())
                setSelectedFolderIds(new Set())
              }}
              className="selection-toolbar-btn"
              title="선택 취소"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <span className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
              {selectedIds.size + selectedFolderIds.size}개 선택
            </span>
            <button
              onClick={selectAll}
              className="text-xs font-medium px-2.5 py-1 rounded-lg transition-colors hover:opacity-80"
              style={{ color: 'var(--accent-primary)', background: 'var(--accent-primary-alpha)' }}
            >
              전체 선택
            </button>
          </div>

          {/* 오른쪽: 액션 버튼들 */}
          <div className="flex items-center gap-0.5">
            {/* 다운로드 */}
            {selectedIds.size > 0 && (
              <button
                onClick={handleDownloadSelected}
                className="selection-toolbar-btn success"
                title="다운로드"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            )}
            {/* 이동 */}
            <button
              onClick={() => setShowMoveModal(true)}
              className="selection-toolbar-btn primary"
              title="폴더로 이동"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>
            {/* 삭제 */}
            <button
              onClick={handleDeleteSelected}
              className="selection-toolbar-btn danger"
              title="삭제"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 메인 콘텐츠 */}
      <div
        ref={gridContainerRef}
        className="p-3 sm:p-4 md:p-6 pb-24 sm:pb-6 relative select-none"
        onMouseDown={(e) => handleDragSelectStart(e, gridContainerRef)}
        onMouseMove={handleDragSelectMove}
        onMouseUp={handleDragSelectEnd}
        onMouseLeave={handleDragSelectEnd}
      >
        {/* 드래그 선택 박스 */}
        {isDragSelecting && dragSelectStart && dragSelectCurrent && (
          <div
            className="absolute border-2 border-blue-500 bg-blue-500/10 pointer-events-none z-50"
            style={{
              left: Math.min(dragSelectStart.x, dragSelectCurrent.x),
              top: Math.min(dragSelectStart.y, dragSelectCurrent.y),
              width: Math.abs(dragSelectCurrent.x - dragSelectStart.x),
              height: Math.abs(dragSelectCurrent.y - dragSelectStart.y),
            }}
          />
        )}

        {/* 그리드 뷰 */}
        {!userLoading && effectiveViewMode === 'grid' && (
          <>
            {/* 폴더 섹션 - 전체 보기에서만 표시 */}
            {currentCategory === 'all' && sortedFolders.length > 0 && (
              <div className="mb-6 sm:mb-8 animate-fade-in">
                <h2 className="text-xs sm:text-sm font-medium mb-3 sm:mb-4 uppercase tracking-wide" style={{ color: 'var(--foreground-muted)' }}>폴더</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2 sm:gap-3 md:gap-4">
                  {sortedFolders.map((folder, folderIndex) => (
                    <div
                      key={folder.id}
                      data-folder-id={folder.id}
                      className={`folder-item group relative min-w-0 ${selectedFolderIds.has(folder.id) ? 'selected' : ''}`}
                      onClick={(e) => {
                        if (isTouchDragging) return
                        if (isSelecting) {
                          toggleFolderSelect(folder.id, e, folderIndex)
                        } else {
                          router.push(`/drive?folder=${folder.id}`)
                        }
                      }}
                      onMouseEnter={() => {
                        // 폴더 호버 시 해당 폴더의 사진을 미리 로드
                        if (user?.id) {
                          dataCache.prefetchFolder(user.id, folder.id)
                        }
                      }}
                      onTouchStart={(e) => handleItemTouchStart(e, folder.id, true, folderIndex, sortedFolders.length)}
                      onTouchMove={handleItemTouchMove}
                      onTouchEnd={handleItemTouchEnd}
                    >
                      <div className="w-full aspect-[4/3] rounded-lg flex items-center justify-center" style={{ background: 'var(--background-tertiary)' }}>
                        <svg className="w-10 h-10 sm:w-12 sm:h-12" style={{ color: 'var(--accent-primary)', opacity: 0.6 }} fill="currentColor" viewBox="0 0 24 24">
                          <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                        </svg>
                      </div>
                      <p className="font-medium truncate text-xs sm:text-sm mt-2" title={folder.name}>{folder.name}</p>
                      <p className="text-caption text-[10px] sm:text-xs mt-0.5">폴더</p>

                      {/* 선택 체크박스 */}
                      <div
                        className={`absolute top-2 left-2 transition-all duration-200 ${isSelecting || selectedFolderIds.has(folder.id) ? 'opacity-100 scale-100' : 'opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100'}`}
                        onClick={(e) => toggleFolderSelect(folder.id, e, folderIndex)}
                      >
                        <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                          selectedFolderIds.has(folder.id)
                            ? 'border-transparent'
                            : 'border-white/70 bg-black/30 backdrop-blur-sm'
                        }`} style={selectedFolderIds.has(folder.id) ? { background: 'var(--accent-primary)' } : {}}>
                          {selectedFolderIds.has(folder.id) && (
                            <svg className="w-3 h-3 sm:w-4 sm:h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </div>

                      {/* 폴더 메뉴 버튼 */}
                      <div className="absolute top-2 right-2">
                        <button
                          data-menu-button
                          onClick={(e) => {
                            e.stopPropagation()
                            closePhotoMenu()
                            if (folderMenuId === folder.id) {
                              closeFolderMenu()
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect()
                              setFolderMenuPosition({ x: rect.right, y: rect.bottom + 4 })
                              setFolderMenuId(folder.id)
                            }
                          }}
                          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all backdrop-blur-sm"
                          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                        >
                          <svg className="w-4 h-4" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 사진 그리드 */}
            {sortedPhotos.length > 0 && (
              <div className="animate-fade-in">
                {currentCategory === 'all' && sortedFolders.length > 0 && (
                  <h2 className="text-xs sm:text-sm font-medium mb-3 sm:mb-4 uppercase tracking-wide" style={{ color: 'var(--foreground-muted)' }}>파일</h2>
                )}
                <div className="image-grid view-grid">
                  {sortedPhotos.map((photo, index) => (
                    <div
                      key={photo.id}
                      data-photo-id={photo.id}
                      className={`image-item group ${selectedIds.has(photo.id) ? 'selected' : ''}`}
                      onClick={(e) => {
                        if (isTouchDragging) return
                        if (isSelecting) {
                          toggleSelect(photo.id, e, index)
                        } else {
                          router.push(`/viewer?index=${index}${currentFolderId ? `&folder=${currentFolderId}` : ''}${currentCategory !== 'all' ? `&category=${currentCategory}` : ''}&sortBy=${sortBy}&sortOrder=${sortOrder}`)
                        }
                      }}
                      onTouchStart={(e) => handleItemTouchStart(e, photo.id, false, index, sortedFolders.length)}
                      onTouchMove={handleItemTouchMove}
                      onTouchEnd={handleItemTouchEnd}
                    >
                      <img
                        src={toProxyUrl(photo.thumbnail_url || photo.url)}
                        alt=""
                        className={`transition-transform duration-300 ${selectedIds.has(photo.id) ? 'scale-90' : ''}`}
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                      />

                      {/* 선택 체크박스 */}
                      <div
                        className={`absolute top-2 left-2 transition-all duration-200 z-10 ${isSelecting || selectedIds.has(photo.id) ? 'opacity-100 scale-100' : 'opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100'}`}
                        onClick={(e) => toggleSelect(photo.id, e, index)}
                      >
                        <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                          selectedIds.has(photo.id)
                            ? 'border-transparent'
                            : 'border-white/70 bg-black/30 backdrop-blur-sm'
                        }`} style={selectedIds.has(photo.id) ? { background: 'var(--accent-primary)' } : {}}>
                          {selectedIds.has(photo.id) && (
                            <svg className="w-3 h-3 sm:w-4 sm:h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </div>

                      {/* 더보기 버튼 */}
                      <div className="absolute top-2 right-2">
                        <button
                          data-menu-button
                          onClick={(e) => {
                            e.stopPropagation()
                            closeFolderMenu()
                            if (photoMenuId === photo.id) {
                              closePhotoMenu()
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect()
                              setPhotoMenuPosition({ x: rect.right, y: rect.bottom + 4 })
                              setPhotoMenuId(photo.id)
                            }
                          }}
                          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all backdrop-blur-sm"
                          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                        >
                          <svg className="w-4 h-4" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>
                      </div>

                      {/* 파일명 호버 시 표시 */}
                      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-white text-xs truncate">{photo.name}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 무한 스크롤 로더 */}
                {(currentCategory === 'photos' || currentCategory === 'videos') && (
                  <div ref={loadMoreRef} className="flex justify-center py-8">
                    {loadingMore && (
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
                        <span className="text-sm" style={{ color: 'var(--foreground-muted)' }}>불러오는 중...</span>
                      </div>
                    )}
                    {!hasMore && sortedPhotos.length > 0 && (
                      <span className="text-sm" style={{ color: 'var(--foreground-tertiary)' }}>
                        모든 {currentCategory === 'photos' ? '사진' : '동영상'}을 불러왔습니다
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* 리스트 뷰 */}
        {!userLoading && effectiveViewMode === 'list' && (
          <div className="sm:card">
            {/* 테이블 헤더 - 데스크톱만 */}
            <div className="hidden sm:grid grid-cols-[auto_minmax(200px,1fr)_80px_120px_auto] gap-4 px-4 py-2.5 text-xs font-medium uppercase tracking-wide" style={{ background: 'var(--background-secondary)', color: 'var(--foreground-muted)', borderBottom: '1px solid var(--border-default)' }}>
              <div className="w-5" />
              <button
                onClick={() => {
                  if (sortBy === 'name') {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                  } else {
                    setSortBy('name')
                    setSortOrder('asc')
                  }
                }}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-left"
              >
                이름
                {sortBy === 'name' && (
                  <span style={{ color: 'var(--accent-primary)' }}>
                    {sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </button>
              <div>유형</div>
              <button
                onClick={() => {
                  if (sortBy === 'date') {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                  } else {
                    setSortBy('date')
                    setSortOrder('desc')
                  }
                }}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-left"
              >
                수정일
                {sortBy === 'date' && (
                  <span style={{ color: 'var(--accent-primary)' }}>
                    {sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </button>
              <div className="w-8" />
            </div>

            {/* 모바일 정렬 헤더 */}
            <div className="sm:hidden flex items-center gap-2 px-4 py-2.5">
              <button
                onClick={() => {
                  if (sortBy === 'name') {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                  } else {
                    setSortBy('name')
                    setSortOrder('asc')
                  }
                }}
                className="flex items-center gap-1.5 text-sm font-medium"
                style={{ color: 'var(--foreground-secondary)' }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortOrder === 'asc' ? "M3 4h13M3 8h9M3 12h5m4 0l4-4m0 0l4 4m-4-4v12" : "M3 4h13M3 8h9M3 12h9m4 0l4 4m0 0l-4 4m4-4H9"} />
                </svg>
                {sortBy === 'name' ? '이름순' : '날짜순'}
                <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* 폴더 목록 - 전체 보기에서만 표시 */}
            {currentCategory === 'all' && sortedFolders.map((folder, folderIndex) => (
              <div
                key={folder.id}
                data-folder-id={folder.id}
                className="flex items-center px-4 py-3.5 sm:py-2 cursor-pointer transition-colors group sm:grid sm:grid-cols-[auto_minmax(200px,1fr)_80px_120px_auto] sm:gap-4 sm:border-b"
                style={{
                  background: selectedFolderIds.has(folder.id) ? 'var(--accent-primary-alpha)' : 'transparent',
                  borderColor: 'var(--border-default)'
                }}
                onClick={(e) => {
                  if (isSelecting) {
                    toggleFolderSelect(folder.id, e, folderIndex)
                  } else {
                    router.push(`/drive?folder=${folder.id}`)
                  }
                }}
                onMouseEnter={(e) => {
                  if (!selectedFolderIds.has(folder.id)) {
                    e.currentTarget.style.background = 'var(--background-secondary)'
                  }
                  // 폴더 호버 시 해당 폴더의 사진을 미리 로드
                  if (user?.id) {
                    dataCache.prefetchFolder(user.id, folder.id)
                  }
                }}
                onMouseLeave={(e) => !selectedFolderIds.has(folder.id) && (e.currentTarget.style.background = 'transparent')}
              >
                {/* 체크박스 - 선택 모드일 때만 모바일에서 표시 */}
                <div
                  className={`mr-3 sm:mr-0 ${isSelecting ? 'block' : 'hidden sm:block'}`}
                  onClick={(e) => toggleFolderSelect(folder.id, e, folderIndex)}
                >
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                    selectedFolderIds.has(folder.id)
                      ? 'border-transparent'
                      : ''
                  }`} style={selectedFolderIds.has(folder.id) ? { background: 'var(--accent-primary)' } : { borderColor: 'var(--border-default)' }}>
                    {selectedFolderIds.has(folder.id) && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
                {/* 폴더 아이콘 + 이름 */}
                <div className="flex items-center gap-3.5 sm:gap-3 min-w-0 flex-1">
                  {/* 모바일: 더 큰 폴더 아이콘 */}
                  <div className="w-12 h-12 sm:w-10 sm:h-10 rounded-xl sm:rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-primary-alpha)' }}>
                    <svg className="w-6 h-6 sm:w-5 sm:h-5" style={{ color: 'var(--accent-primary)' }} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate text-[15px] sm:text-sm">{folder.name}</p>
                    <p className="text-xs sm:hidden mt-0.5" style={{ color: 'var(--foreground-muted)' }}>폴더 · {formatDate(folder.created_at)}</p>
                  </div>
                </div>
                {/* 데스크톱 추가 컬럼 */}
                <div className="text-sm hidden sm:block" style={{ color: 'var(--foreground-muted)' }}>폴더</div>
                <div className="text-sm hidden sm:block" style={{ color: 'var(--foreground-muted)' }}>{formatDate(folder.created_at)}</div>
                {/* 더보기 버튼 */}
                <div className="w-10 sm:w-8 relative ml-1 sm:ml-0">
                  <button
                    data-menu-button
                    onClick={(e) => {
                      e.stopPropagation()
                      closePhotoMenu()
                      if (folderMenuId === folder.id) {
                        closeFolderMenu()
                      } else {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setFolderMenuPosition({ x: rect.right, y: rect.bottom + 4 })
                        setFolderMenuId(folder.id)
                      }
                    }}
                    className="w-10 h-10 sm:w-8 sm:h-8 rounded-full sm:rounded-lg flex items-center justify-center transition-all sm:opacity-0 sm:group-hover:opacity-100 active:bg-black/10 dark:active:bg-white/10"
                    style={{ color: 'var(--foreground-muted)' }}
                  >
                    <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="5" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="19" r="2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}

            {/* 사진 목록 */}
            {sortedPhotos.map((photo, index) => (
              <div
                key={photo.id}
                data-photo-id={photo.id}
                className="flex items-center px-4 py-3.5 sm:py-2 cursor-pointer transition-colors group sm:grid sm:grid-cols-[auto_minmax(200px,1fr)_80px_120px_auto] sm:gap-4 sm:border-b"
                style={{
                  background: selectedIds.has(photo.id) ? 'var(--accent-primary-alpha)' : 'transparent',
                  borderColor: 'var(--border-default)'
                }}
                onClick={(e) => {
                  if (isSelecting) {
                    toggleSelect(photo.id, e, index)
                  } else {
                    router.push(`/viewer?index=${index}${currentFolderId ? `&folder=${currentFolderId}` : ''}${currentCategory !== 'all' ? `&category=${currentCategory}` : ''}&sortBy=${sortBy}&sortOrder=${sortOrder}`)
                  }
                }}
                onMouseEnter={(e) => !selectedIds.has(photo.id) && (e.currentTarget.style.background = 'var(--background-secondary)')}
                onMouseLeave={(e) => !selectedIds.has(photo.id) && (e.currentTarget.style.background = 'transparent')}
              >
                {/* 체크박스 - 선택 모드일 때만 모바일에서 표시 */}
                <div
                  className={`mr-3 sm:mr-0 ${isSelecting ? 'block' : 'hidden sm:block'}`}
                  onClick={(e) => toggleSelect(photo.id, e, index)}
                >
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                    selectedIds.has(photo.id)
                      ? 'border-transparent'
                      : ''
                  }`} style={selectedIds.has(photo.id) ? { background: 'var(--accent-primary)' } : { borderColor: 'var(--border-default)' }}>
                    {selectedIds.has(photo.id) && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
                {/* 썸네일 + 이름 */}
                <div className="flex items-center gap-3.5 sm:gap-3 min-w-0 flex-1">
                  {/* 모바일: 더 큰 썸네일 */}
                  <div className="w-12 h-12 sm:w-10 sm:h-10 rounded-xl sm:rounded-lg overflow-hidden flex-shrink-0" style={{ background: 'var(--background-tertiary)' }}>
                    <img src={toProxyUrl(photo.thumbnail_url || photo.url)} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate text-[15px] sm:text-sm">{photo.name || photo.url.split('/').pop()}</p>
                    <p className="text-xs sm:hidden mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                      {photo.is_video ? '동영상' : '이미지'} · {formatDate(photo.created_at)}
                    </p>
                  </div>
                </div>
                {/* 데스크톱 추가 컬럼 */}
                <div className="text-sm hidden sm:block" style={{ color: 'var(--foreground-muted)' }}>
                  {photo.is_video ? '동영상' : '이미지'}
                </div>
                <div className="text-sm hidden sm:block" style={{ color: 'var(--foreground-muted)' }}>{formatDate(photo.created_at)}</div>
                {/* 더보기 버튼 */}
                <div className="w-10 sm:w-8 relative ml-1 sm:ml-0">
                  <button
                    data-menu-button
                    onClick={(e) => {
                      e.stopPropagation()
                      closeFolderMenu()
                      if (photoMenuId === photo.id) {
                        closePhotoMenu()
                      } else {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setPhotoMenuPosition({ x: rect.right, y: rect.bottom + 4 })
                        setPhotoMenuId(photo.id)
                      }
                    }}
                    className="w-10 h-10 sm:w-8 sm:h-8 rounded-full sm:rounded-lg flex items-center justify-center transition-all sm:opacity-0 sm:group-hover:opacity-100 active:bg-black/10 dark:active:bg-white/10"
                    style={{ color: 'var(--foreground-muted)' }}
                  >
                    <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="5" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="19" r="2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}

            {/* 빈 상태 */}
            {sortedPhotos.length === 0 && sortedFolders.length === 0 && (
              <div className="py-16 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'var(--background-secondary)' }}>
                  <svg className="w-8 h-8" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="font-medium mb-1">아직 비어있어요</p>
                <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                  <span className="xl:hidden">+ 버튼을 눌러 파일을 추가하세요</span>
                  <span className="hidden xl:inline">업로드 버튼 또는 드래그앤드롭으로 추가해보세요</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* 빈 상태 (그리드 뷰) */}
        {!loading && !userLoading && viewMode === 'grid' && sortedPhotos.length === 0 && sortedFolders.length === 0 && (
          <div className="empty-state h-[60vh] animate-fade-in">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex items-center justify-center mb-4 sm:mb-6" style={{ background: 'var(--background-secondary)' }}>
              <svg className="empty-state-icon !w-10 !h-10 sm:!w-12 sm:!h-12 !mb-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="empty-state-title text-base sm:text-lg">아직 비어있어요</p>
            <p className="empty-state-description text-xs sm:text-sm">
              <span className="xl:hidden">+ 버튼을 눌러 파일을 추가하세요</span>
              <span className="hidden xl:inline">업로드 버튼 또는 드래그앤드롭으로 추가해보세요</span>
            </p>
          </div>
        )}
      </div>

      {/* 새 폴더 모달 - TDS Style */}
      {showNewFolderInput && (
        <div className="tds-modal-backdrop" onClick={() => { setShowNewFolderInput(false); setNewFolderName('') }}>
          <div className="tds-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tds-modal-handle" />
            <div className="tds-modal-header">
              <h2>새 폴더</h2>
            </div>
            <div className="tds-modal-body">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="폴더 이름을 입력하세요"
                className="tds-input"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              />
            </div>
            <div className="tds-modal-footer">
              <button
                onClick={() => {
                  setShowNewFolderInput(false)
                  setNewFolderName('')
                }}
                className="tds-btn tds-btn-secondary"
              >
                취소
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="tds-btn tds-btn-primary"
              >
                만들기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 폴더 이름 수정 모달 - TDS Style */}
      {editingFolder && (
        <div className="tds-modal-backdrop" onClick={() => { setEditingFolder(null); setEditFolderName('') }}>
          <div className="tds-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tds-modal-handle" />
            <div className="tds-modal-header">
              <h2>폴더 이름 변경</h2>
            </div>
            <div className="tds-modal-body">
              <input
                type="text"
                value={editFolderName}
                onChange={(e) => setEditFolderName(e.target.value)}
                placeholder="새 폴더 이름을 입력하세요"
                className="tds-input"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleRenameFolder()}
              />
            </div>
            <div className="tds-modal-footer">
              <button
                onClick={() => {
                  setEditingFolder(null)
                  setEditFolderName('')
                }}
                className="tds-btn tds-btn-secondary"
              >
                취소
              </button>
              <button
                onClick={handleRenameFolder}
                disabled={!editFolderName.trim()}
                className="tds-btn tds-btn-primary"
              >
                변경
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 폴더 선택 모달 (업로드 위치) - TDS Style */}
      {showFolderPicker && (
        <div className="tds-modal-backdrop" onClick={() => { setShowFolderPicker(false); setPendingFiles([]) }}>
          <div className="tds-modal !max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="tds-modal-handle" />
            {/* 헤더 */}
            <div className="tds-modal-header">
              <h2>폴더 선택</h2>
              <p>{pendingFiles.length}개 파일을 업로드할 위치</p>
            </div>

            {/* 폴더 목록 */}
            <div className="flex-1 overflow-y-auto py-2 max-h-[50vh]">
              {buildFolderTree(null).map(({ folder, depth }) => {
                const isCurrentFolder = (folder?.id || null) === currentFolderId
                const isRoot = !folder
                return (
                  <button
                    key={folder?.id || 'root'}
                    onClick={() => handleUploadToFolder(folder?.id || null)}
                    className={`
                      folder-picker-item w-full flex items-center gap-3 px-5 py-3
                      transition-all duration-150 text-left
                      ${isCurrentFolder ? 'folder-picker-item-active' : ''}
                    `}
                    style={{
                      paddingLeft: `${20 + depth * 24}px`,
                      background: isCurrentFolder ? 'var(--accent-gradient-subtle)' : 'transparent',
                    }}
                  >
                    {/* 폴더 아이콘 */}
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform duration-150"
                      style={{
                        background: isRoot
                          ? 'var(--accent-gradient)'
                          : isCurrentFolder
                            ? 'rgba(49, 130, 246, 0.15)'
                            : 'var(--background-tertiary)',
                      }}
                    >
                      <svg
                        className="w-5 h-5"
                        style={{ color: isRoot ? 'white' : isCurrentFolder ? 'var(--accent-primary)' : 'var(--foreground-muted)' }}
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                      </svg>
                    </div>

                    {/* 폴더 이름 */}
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm truncate ${isCurrentFolder ? 'font-semibold' : 'font-medium'}`}
                        style={{ color: isCurrentFolder ? 'var(--accent-primary)' : 'var(--foreground)' }}
                      >
                        {folder ? folder.name : '홈'}
                      </p>
                      {isRoot && (
                        <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>루트 폴더</p>
                      )}
                    </div>

                    {/* 현재 위치 표시 */}
                    {isCurrentFolder && (
                      <span className="tds-badge tds-badge-primary flex-shrink-0">
                        현재
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* 하단 안내 */}
            <div className="tds-modal-footer !justify-center" style={{ background: 'var(--background-secondary)' }}>
              <p className="tds-text-caption tds-text-tertiary">
                폴더를 선택하면 바로 업로드가 시작됩니다
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 중복 파일 처리 모달 - TDS Style */}
      {showDuplicateModal && (
        <div className="tds-modal-backdrop" style={{ zIndex: 10000 }} onClick={() => {
          setShowDuplicateModal(false)
          setDuplicateFiles([])
          setNonDuplicateFiles([])
          setPendingUploadFolderId(null)
        }}>
          <div className="tds-modal !max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="tds-modal-handle" />
            {/* 헤더 */}
            <div className="tds-modal-header">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(245, 158, 11, 0.15)' }}>
                  <svg className="w-5 h-5" style={{ color: '#f59e0b' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h2>중복 파일 발견</h2>
                  <p>{duplicateFiles.length}개의 파일이 이미 존재합니다</p>
                </div>
              </div>
            </div>

            {/* 중복 파일 목록 */}
            <div className="max-h-40 overflow-y-auto" style={{ background: 'var(--background-secondary)' }}>
              {duplicateFiles.map((dup, idx) => (
                <div key={idx} className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: 'var(--glass-border)' }}>
                  <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0" style={{ background: 'var(--background-tertiary)' }}>
                    <img src={toProxyUrl(dup.existingPhoto.thumbnail_url || dup.existingPhoto.url)} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="tds-text-body truncate" style={{ fontWeight: 500 }}>{dup.file.name}</p>
                    <p className="tds-text-caption tds-text-tertiary">
                      {(dup.file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* 액션 버튼 */}
            <div className="tds-modal-body space-y-2">
              <button
                onClick={() => handleDuplicateAction('overwrite')}
                className="tds-list-item w-full rounded-xl"
                style={{ background: 'var(--background-tertiary)' }}
              >
                <svg className="w-5 h-5 flex-shrink-0" style={{ color: '#ef4444' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <div className="text-left flex-1">
                  <p className="tds-text-body" style={{ fontWeight: 500 }}>덮어쓰기</p>
                  <p className="tds-text-caption tds-text-tertiary">기존 파일을 새 파일로 교체</p>
                </div>
              </button>

              <button
                onClick={() => handleDuplicateAction('keep')}
                className="tds-list-item w-full rounded-xl"
                style={{ background: 'var(--background-tertiary)' }}
              >
                <svg className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <div className="text-left flex-1">
                  <p className="tds-text-body" style={{ fontWeight: 500 }}>둘 다 유지</p>
                  <p className="tds-text-caption tds-text-tertiary">새 파일 이름에 번호 추가</p>
                </div>
              </button>

              <button
                onClick={() => handleDuplicateAction('skip')}
                className="tds-list-item w-full rounded-xl"
                style={{ background: 'var(--background-tertiary)' }}
              >
                <svg className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                <div className="text-left flex-1">
                  <p className="tds-text-body" style={{ fontWeight: 500 }}>건너뛰기</p>
                  <p className="tds-text-caption tds-text-tertiary">중복 파일은 업로드하지 않음</p>
                </div>
              </button>
            </div>

            <div className="tds-modal-footer">
              <button
                onClick={() => {
                  setShowDuplicateModal(false)
                  setDuplicateFiles([])
                  setNonDuplicateFiles([])
                  setPendingUploadFolderId(null)
                }}
                className="tds-btn tds-btn-ghost flex-1"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이동 대상 폴더 선택 모달 - TDS Style */}
      {showMoveModal && (
        <div className="tds-modal-backdrop" style={{ zIndex: 10000 }} onClick={() => setShowMoveModal(false)}>
          <div className="tds-modal" style={{ zIndex: 10001 }} onClick={(e) => e.stopPropagation()}>
            <div className="tds-modal-handle" />
            <div className="tds-modal-header">
              <h2>이동할 폴더 선택</h2>
              <p>
                {selectedIds.size > 0 && `${selectedIds.size}개 파일`}
                {selectedIds.size > 0 && selectedFolderIds.size > 0 && ', '}
                {selectedFolderIds.size > 0 && `${selectedFolderIds.size}개 폴더`}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto py-2 max-h-[50vh]">
              {buildFolderTree(null).map(({ folder, depth }) => {
                const isSelected = folder && selectedFolderIds.has(folder.id)
                const isCurrent = (folder?.id || null) === currentFolderId

                if (isSelected) return null

                return (
                  <button
                    key={folder?.id || 'root'}
                    onClick={() => handleMoveSelected(folder?.id || null)}
                    disabled={moving || isCurrent}
                    className={`folder-picker-item w-full flex items-center gap-3 px-5 py-3 text-left ${isCurrent ? 'opacity-50 cursor-not-allowed' : ''}`}
                    style={{ paddingLeft: `${20 + depth * 20}px` }}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--background-tertiary)' }}
                    >
                      <svg className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                      </svg>
                    </div>
                    <span className="text-sm truncate flex-1" style={{ color: 'var(--foreground)' }}>
                      {folder ? folder.name : '홈 (루트)'}
                    </span>
                    {isCurrent && <span className="tds-badge">현재</span>}
                  </button>
                )
              })}
            </div>

            {moving && (
              <div className="tds-modal-footer !justify-center">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-default)', borderTopColor: 'var(--accent-primary)' }} />
                  <span className="tds-text-body tds-text-secondary">이동 중...</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 삭제 진행 오버레이 - TDS Style */}
      {deleting && (
        <div className="tds-dialog-backdrop" style={{ zIndex: 300 }}>
          <div className="tds-dialog !max-w-xs">
            <div className="tds-dialog-body">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 border-3 rounded-full animate-spin" style={{ borderColor: 'var(--border-default)', borderTopColor: '#ef4444' }} />
                <div>
                  <p className="tds-text-body font-medium" style={{ color: 'var(--foreground)' }}>삭제 중</p>
                  <p className="tds-text-caption tds-text-secondary">{deleteStatus}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 파일 이름 변경 모달 */}
      {editingPhoto && (
        <div className="tds-modal-backdrop" onClick={() => { setEditingPhoto(null); setEditPhotoName('') }}>
          <div className="tds-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tds-modal-handle" />
            <div className="tds-modal-header">
              <h2>파일 이름 변경</h2>
            </div>
            <div className="tds-modal-body">
              <input
                type="text"
                value={editPhotoName}
                onChange={(e) => setEditPhotoName(e.target.value)}
                placeholder="새 파일 이름을 입력하세요"
                className="tds-input"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleRenamePhoto()}
              />
            </div>
            <div className="tds-modal-footer">
              <button
                onClick={() => {
                  setEditingPhoto(null)
                  setEditPhotoName('')
                }}
                className="tds-btn tds-btn-secondary"
              >
                취소
              </button>
              <button
                onClick={handleRenamePhoto}
                disabled={!editPhotoName.trim()}
                className="tds-btn tds-btn-primary"
              >
                변경
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 폴더 컨텍스트 메뉴 (fixed 포지션) */}
      {folderMenuId && folderMenuPosition && (() => {
        const folder = [...folders, ...allFolders].find(f => f.id === folderMenuId)
        return folder ? <FolderContextMenu folder={folder} /> : null
      })()}

      {/* 파일 컨텍스트 메뉴 (fixed 포지션) */}
      {photoMenuId && photoMenuPosition && (() => {
        const photo = photos.find(p => p.id === photoMenuId)
        return photo ? <PhotoContextMenu photo={photo} /> : null
      })()}

      {/* 파일 정보 모달 - 드롭박스 스타일 */}
      {infoPhoto && (
        <div className="tds-modal-backdrop" onClick={() => setInfoPhoto(null)}>
          <div className="tds-modal !max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="tds-modal-handle" />
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--glass-border)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>정보</span>
              </div>
              <button
                onClick={() => setInfoPhoto(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <svg className="w-5 h-5" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="tds-modal-body space-y-5">
              {/* 썸네일 프리뷰 */}
              <div className="w-full aspect-square max-w-[120px] mx-auto rounded-xl overflow-hidden" style={{ background: 'var(--background-tertiary)' }}>
                {infoPhoto.is_video ? (
                  <video
                    src={toProxyUrl(infoPhoto.url)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <img
                    src={toProxyUrl(infoPhoto.thumbnail_url || infoPhoto.url)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}
              </div>

              {/* 속성 섹션 */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide mb-3" style={{ color: 'var(--foreground-muted)' }}>속성</h3>
                <div className="space-y-0">
                  <div className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>이름</span>
                    <span className="text-sm font-medium truncate ml-4 max-w-[180px]" style={{ color: 'var(--foreground)' }}>
                      {infoPhoto.name || infoPhoto.url.split('/').pop()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>저장 위치</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      Cloody{infoPhoto.folder_id ? ` > ${allFolders.find(f => f.id === infoPhoto.folder_id)?.name || '폴더'}` : ''}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>크기</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {infoPhoto.file_size ? (
                        infoPhoto.file_size >= 1024 * 1024
                          ? `${(infoPhoto.file_size / (1024 * 1024)).toFixed(2)} MB`
                          : `${(infoPhoto.file_size / 1024).toFixed(2)} KB`
                      ) : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>수정 일시</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {new Date(infoPhoto.created_at).toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      })} {new Date(infoPhoto.created_at).toLocaleTimeString('ko-KR', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>유형</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {infoPhoto.is_video ? '동영상' : '이미지'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>업로드한 날짜</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {new Date(infoPhoto.created_at).toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })} {new Date(infoPhoto.created_at).toLocaleTimeString('ko-KR', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  {(infoPhoto.width && infoPhoto.height) && (
                    <div className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                      <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>크기</span>
                      <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                        {infoPhoto.width} x {infoPhoto.height}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 폴더 정보 모달 - 드롭박스 스타일 */}
      {infoFolder && (
        <div className="tds-modal-backdrop" onClick={() => setInfoFolder(null)}>
          <div className="tds-modal !max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="tds-modal-handle" />
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--glass-border)' }}>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>정보</span>
              </div>
              <button
                onClick={() => setInfoFolder(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <svg className="w-5 h-5" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="tds-modal-body space-y-5">
              {/* 폴더 아이콘 프리뷰 */}
              <div className="w-32 h-32 mx-auto rounded-xl flex items-center justify-center" style={{ background: 'var(--background-tertiary)' }}>
                <svg className="w-16 h-16" style={{ color: 'var(--accent-primary)', opacity: 0.7 }} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                </svg>
              </div>

              {/* 속성 섹션 */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide mb-3" style={{ color: 'var(--foreground-muted)' }}>속성</h3>
                <div className="space-y-0">
                  <div className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>이름</span>
                    <span className="text-sm font-medium truncate ml-4 max-w-[180px]" style={{ color: 'var(--foreground)' }}>{infoFolder.name}</span>
                  </div>
                  <div className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>저장 위치</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {infoFolder.parent_id ? folders.find(f => f.id === infoFolder.parent_id)?.name || 'Cloody' : 'Cloody'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>항목</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {infoFolderCounts ? (() => {
                        const { files: fileCount, folders: folderCount } = infoFolderCounts
                        const total = fileCount + folderCount
                        if (folderCount > 0 && fileCount > 0) {
                          return `${total}개 항목 (폴더 ${folderCount}, 파일 ${fileCount})`
                        } else if (folderCount > 0) {
                          return `${folderCount}개 폴더`
                        } else {
                          return `${fileCount}개 파일`
                        }
                      })() : '불러오는 중...'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>수정 일시</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {new Date(infoFolder.created_at).toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      })} {new Date(infoFolder.created_at).toLocaleTimeString('ko-KR', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      </div>{/* lg:pl-64 끝 */}

      {/* 모바일 하단 탭 네비게이션 - Toss Style */}
      <nav className="tds-bottom-nav xl:hidden" style={{ zIndex: 70 }}>
        <button
          onClick={() => {
            setShowUploadPanel(false)
            setShowMoreScreen(false)
            router.push('/drive')
          }}
          className={`tds-bottom-nav-item ${currentCategory === 'all' && !showUploadPanel && !showMoreScreen ? 'active' : ''}`}
        >
          <Home
            size={26}
            strokeWidth={currentCategory === 'all' && !showUploadPanel && !showMoreScreen ? 2.5 : 1.5}
            fill={currentCategory === 'all' && !showUploadPanel && !showMoreScreen ? 'currentColor' : 'none'}
          />
          <span>홈</span>
        </button>

        <button
          onClick={() => {
            setShowUploadPanel(false)
            setShowMoreScreen(false)
            router.push('/drive?category=photos')
          }}
          className={`tds-bottom-nav-item ${currentCategory === 'photos' && !showUploadPanel && !showMoreScreen ? 'active' : ''}`}
        >
          <ImageIcon
            size={26}
            strokeWidth={currentCategory === 'photos' && !showUploadPanel && !showMoreScreen ? 2.5 : 1.5}
            fill={currentCategory === 'photos' && !showUploadPanel && !showMoreScreen ? 'currentColor' : 'none'}
          />
          <span>사진</span>
        </button>

        <button
          onClick={() => {
            setShowMoreScreen(false)
            setShowUploadPanel(true)
          }}
          className={`tds-bottom-nav-item ${showUploadPanel && !showMoreScreen ? 'active' : ''}`}
        >
          <div className="relative">
            <CloudUpload
              size={26}
              strokeWidth={showUploadPanel && !showMoreScreen ? 2.5 : 1.5}
              fill={showUploadPanel && !showMoreScreen ? 'currentColor' : 'none'}
            />
            {uploading && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: 'var(--accent-primary)' }} />
            )}
          </div>
          <span>업로드</span>
        </button>

        <button
          onClick={() => setShowMoreScreen(!showMoreScreen)}
          className={`tds-bottom-nav-item ${showMoreScreen ? 'active' : ''}`}
        >
          <Menu size={26} strokeWidth={showMoreScreen ? 2.5 : 1.5} />
          <span>더보기</span>
        </button>
      </nav>

      {/* 모바일 FAB (플로팅 액션 버튼) - TDS Style */}
      {/* 더보기/업로드 탭에서는 숨김 */}
      {!showMoreScreen && !showUploadPanel && (
      <div className="xl:hidden">
        {/* FAB 메뉴 배경 (딤 레이어) */}
        {showFabMenu && (
          <div
            className="tds-sheet-backdrop"
            onClick={() => setShowFabMenu(false)}
          />
        )}

        {/* FAB 메뉴 - TDS Action Sheet 스타일 */}
        {showFabMenu && (
          <div className="fixed right-4 bottom-28 w-48 z-[102] animate-fade-in-up">
            <div className="tds-card tds-card-elevated">
              {/* 파일 업로드 */}
              <label className="tds-list-item cursor-pointer">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--accent-primary)' }}
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <span className="tds-text-body" style={{ fontWeight: 500 }}>파일 업로드</span>
                <input
                  ref={fabFileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={(e) => {
                    setShowFabMenu(false)
                    handleFileSelect(e)
                  }}
                  disabled={uploading}
                  className="hidden"
                />
              </label>

              <div className="tds-divider mx-4" />

              {/* 새 폴더 */}
              <button
                onClick={() => {
                  setShowFabMenu(false)
                  setShowNewFolderInput(true)
                }}
                className="tds-list-item w-full"
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--background-tertiary)' }}
                >
                  <svg className="w-5 h-5" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <span className="tds-text-body" style={{ fontWeight: 500 }}>새 폴더</span>
              </button>
            </div>
          </div>
        )}

        {/* FAB 버튼 - TDS Style */}
        <button
          onClick={() => setShowFabMenu(!showFabMenu)}
          className="tds-fab"
          style={{
            background: showFabMenu ? 'var(--foreground)' : undefined,
            boxShadow: showFabMenu ? '0 4px 16px rgba(0, 0, 0, 0.2)' : undefined,
          }}
          aria-label={showFabMenu ? '메뉴 닫기' : '새로 만들기'}
        >
          <svg
            className="transition-transform duration-200"
            style={{ transform: showFabMenu ? 'rotate(45deg)' : 'rotate(0deg)' }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
      )}

      {/* 더보기 화면 (모바일 전용 탭) */}
      {showMoreScreen && (
        <div className="xl:hidden min-h-screen pb-20" style={{ background: 'var(--background)' }}>
          {/* 헤더 */}
          <div className="sticky top-0 z-10 safe-area-top" style={{ background: 'var(--background)', borderBottom: '1px solid var(--glass-border)' }}>
            <div className="flex items-center h-14 px-4">
              <h1 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>더보기</h1>
            </div>
          </div>

          {/* 내용 */}
          <div className="overflow-y-auto pb-4 h-full">
            {/* 사용자 프로필 */}
            <div className="p-4">
              <div className="flex items-center gap-4 p-4 rounded-2xl" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-semibold" style={{ background: 'var(--accent-gradient-subtle)', color: 'var(--accent-primary)' }}>
                  {user?.display_name?.[0] || user?.email?.[0] || 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-base truncate" style={{ color: 'var(--foreground)' }}>
                    {user?.display_name || '사용자'}
                  </p>
                  <p className="text-sm truncate" style={{ color: 'var(--foreground-muted)' }}>
                    {user?.email}
                  </p>
                </div>
              </div>
            </div>

            {/* 저장공간 */}
            <div className="px-4 mb-6">
              <div className="p-4 rounded-2xl" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>저장공간</span>
                  <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                    {formatBytes(storageUsed)} / 10 GB
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--background-tertiary)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min((storageUsed / (10 * 1024 * 1024 * 1024)) * 100, 100)}%`,
                      background: 'var(--accent-primary)'
                    }}
                  />
                </div>
              </div>
            </div>

            {/* 카테고리 */}
            <div className="px-4 mb-6">
              <p className="text-xs font-medium uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--foreground-muted)' }}>
                파일
              </p>
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                {[
                  { id: 'all', label: '모든 파일', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
                  { id: 'photos', label: '사진', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
                  { id: 'videos', label: '동영상', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
                ].map((category, index) => {
                  const isActive = currentCategory === category.id
                  return (
                    <button
                      key={category.id}
                      onClick={() => {
                        setShowMoreScreen(false)
                        if (category.id === 'all') {
                          router.push('/drive')
                        } else {
                          router.push(`/drive?category=${category.id}`)
                        }
                      }}
                      className="w-full flex items-center gap-4 px-4 py-4 transition-colors active:bg-black/5"
                      style={{
                        borderTop: index > 0 ? '1px solid var(--glass-border)' : 'none',
                        color: isActive ? 'var(--accent-primary)' : 'var(--foreground)'
                      }}
                    >
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{
                          background: isActive ? 'var(--accent-gradient-subtle)' : 'var(--background-tertiary)',
                        }}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={category.icon} />
                        </svg>
                      </div>
                      <span className="text-[15px] font-medium">{category.label}</span>
                      {isActive && (
                        <svg className="w-5 h-5 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 설정 */}
            <div className="px-4 mb-6">
              <p className="text-xs font-medium uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--foreground-muted)' }}>
                설정
              </p>
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <button
                  onClick={() => {
                    setShowMoreScreen(false)
                    router.push('/settings')
                  }}
                  className="w-full flex items-center gap-4 px-4 py-4 transition-colors active:bg-black/5"
                  style={{ color: 'var(--foreground)' }}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--background-tertiary)' }}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <span className="text-[15px] font-medium">환경설정</span>
                  <svg className="w-5 h-5 ml-auto" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <button
                  onClick={() => setTheme(isDark ? 'light' : 'dark')}
                  className="w-full flex items-center gap-4 px-4 py-4 transition-colors active:bg-black/5"
                  style={{ color: 'var(--foreground)', borderTop: '1px solid var(--glass-border)' }}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--background-tertiary)' }}>
                    {isDark ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                    )}
                  </div>
                  <span className="text-[15px] font-medium">{isDark ? '라이트 모드' : '다크 모드'}</span>
                  <div
                    className="ml-auto w-12 h-7 rounded-full p-1 transition-colors"
                    style={{ background: isDark ? 'var(--accent-primary)' : 'var(--background-tertiary)' }}
                  >
                    <div
                      className="w-5 h-5 rounded-full transition-transform"
                      style={{
                        background: 'white',
                        transform: isDark ? 'translateX(20px)' : 'translateX(0)',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                      }}
                    />
                  </div>
                </button>
              </div>
            </div>

            {/* 로그아웃 */}
            <div className="px-4">
              <button
                onClick={async () => {
                  setShowMoreScreen(false)
                  await fetch('/api/auth/logout', { method: 'POST' })
                  router.push('/login')
                }}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl transition-colors active:bg-red-500/10"
                style={{ color: 'var(--error)', background: 'rgba(244, 67, 54, 0.08)', border: '1px solid rgba(244, 67, 54, 0.2)' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="text-[15px] font-medium">로그아웃</span>
              </button>
            </div>

            {/* 앱 정보 */}
            <div className="px-4 mt-8 text-center">
              <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                Cloody v1.0.0
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--foreground-muted)' }}>
                Secure • Private • Simple
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 업로드 현황 패널 (모바일 탭) */}
      {showUploadPanel && (
        <div className="xl:hidden min-h-screen pb-20" style={{ background: 'var(--background)' }}>
          {/* 헤더 */}
          <div className="sticky top-0 z-10 safe-area-top" style={{ background: 'var(--background)', borderBottom: '1px solid var(--glass-border)' }}>
            <div className="flex items-center h-14 px-4">
              <h1 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>업로드</h1>
            </div>
          </div>
          <div className="p-4" style={{ background: 'var(--background)' }}>
            {uploadQueue.length > 0 && (
              <div className="flex items-center justify-end mb-4">
                <button
                  onClick={clearCompleted}
                  className="text-sm"
                  style={{ color: 'var(--foreground-muted)' }}
                >
                  완료 항목 삭제
                </button>
              </div>
            )}

            {uploadQueue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--glass-bg)' }}>
                  <svg className="w-8 h-8" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>업로드 내역이 없습니다</p>
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>우측 하단의 + 버튼으로 파일을 업로드하세요</p>
              </div>
            ) : (
              <div className="space-y-2">
                {uploadQueue.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl"
                    style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                  >
                    <div className="flex items-center gap-3">
                      {/* 상태 아이콘 */}
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--background-tertiary)' }}>
                        {item.status === 'uploading' && (
                          <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
                        )}
                        {item.status === 'done' && (
                          <svg className="w-5 h-5" style={{ color: 'var(--success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {item.status === 'error' && (
                          <svg className="w-5 h-5" style={{ color: 'var(--error)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        {item.status === 'pending' && (
                          <svg className="w-5 h-5" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )}
                      </div>

                      {/* 파일 정보 */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>{item.name}</p>
                        <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                          {item.status === 'uploading' && '업로드 중...'}
                          {item.status === 'done' && '완료'}
                          {item.status === 'error' && '업로드 실패'}
                          {item.status === 'pending' && '대기 중'}
                        </p>
                      </div>
                    </div>

                    {/* 진행 바 - 전체 업로드 진행률 표시 */}
                    {item.status === 'uploading' && (
                      <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--glass-border)' }}>
                        <div
                          className="h-full rounded-full transition-all animate-pulse"
                          style={{ width: '100%', background: 'var(--accent-gradient)' }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
