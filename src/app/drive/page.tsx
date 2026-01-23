'use client'

import { useState, useEffect, useCallback, useRef, DragEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { useUpload } from '@/lib/upload-context'
import { useDownload } from '@/lib/download-context'
import { useSignedUrl } from '@/lib/signed-url-context'
import { useUser } from '@/lib/user-context'
import Sidebar, { FileCategory } from '@/components/Sidebar'

interface Photo {
  id: string
  url: string
  thumbnail_url: string | null
  name: string
  order: number
  folder_id: string | null
  created_at: string
}

// 썸네일 생성 함수 (400px 리사이즈)
const generateThumbnail = (file: File, maxSize: number = 400): Promise<Blob | null> => {
  return new Promise((resolve) => {
    // 비디오는 썸네일 생성 스킵
    if (file.type.startsWith('video/')) {
      resolve(null)
      return
    }

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
  const { uploading, uploadQueue, uploadProgress, setShowUploadPanel, addToQueue, updateQueueItem } = useUpload()
  const { startDownload } = useDownload()
  const { getSignedUrls } = useSignedUrl()
  const { user } = useUser()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [folders, setFolders] = useState<Folder[]>([])
  const [allFolders, setAllFolders] = useState<Folder[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [currentFolder, setCurrentFolder] = useState<Folder | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set())
  const [lastSelectedIndex, setLastSelectedIndex] = useState<{ type: 'photo' | 'folder', index: number } | null>(null)
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  // 폴더 수정 관련
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [editFolderName, setEditFolderName] = useState('')
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null)

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

  const fetchData = useCallback(async (folderId: string | null) => {
    // 사용자 ID가 없으면 빈 데이터 표시
    if (!user?.id) {
      setAllFolders([])
      setFolders([])
      setPhotos([])
      setLoading(false)
      return
    }

    // 현재 사용자의 폴더만 조회
    const { data: allFoldersData } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    const fetchedFolders = allFoldersData || []
    setAllFolders(fetchedFolders)

    const childFolders = fetchedFolders.filter(f =>
      folderId ? f.parent_id === folderId : f.parent_id === null
    )
    setFolders(childFolders)

    await buildBreadcrumbs(folderId, fetchedFolders)

    // 현재 사용자의 사진만 조회
    let query = supabase
      .from('photos')
      .select('*')
      .eq('user_id', user.id)
      .order('order', { ascending: true })

    if (folderId) {
      query = query.eq('folder_id', folderId)
    } else {
      query = query.is('folder_id', null)
    }

    const { data: photosData } = await query
    if (photosData) setPhotos(photosData)

    setLoading(false)
  }, [buildBreadcrumbs, user?.id])

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

  useEffect(() => {
    const folderId = searchParams.get('folder')
    setCurrentFolderId(folderId)
    fetchData(folderId)
    fetchStorageUsage()
  }, [searchParams, fetchData, fetchStorageUsage])

  // Signed URL 가져오기 (사진 로드 시)
  useEffect(() => {
    if (photos.length === 0) return

    const fetchSignedUrls = async () => {
      // 모든 URL 수집 (원본 + 썸네일)
      const urlsToSign = new Set<string>()
      photos.forEach(photo => {
        if (photo.url) urlsToSign.add(photo.url)
        if (photo.thumbnail_url) urlsToSign.add(photo.thumbnail_url)
      })

      const urls = Array.from(urlsToSign)
      if (urls.length === 0) return

      const signed = await getSignedUrls(urls)
      setSignedUrls(prev => ({ ...prev, ...signed }))
    }

    fetchSignedUrls()
  }, [photos, getSignedUrls])

  // 이미지 프리로드 (signed URL 사용)
  useEffect(() => {
    if (photos.length === 0 || Object.keys(signedUrls).length === 0) return

    const preloadImages = () => {
      const imagesToPreload = photos.slice(0, 20)
      imagesToPreload.forEach(photo => {
        const url = signedUrls[photo.thumbnail_url || photo.url] || photo.thumbnail_url || photo.url
        if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i) || url.includes('X-Amz-Signature')) {
          const img = new window.Image()
          img.src = url
        }
      })
    }

    const timer = setTimeout(preloadImages, 100)
    return () => clearTimeout(timer)
  }, [photos, signedUrls])

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
        const uploadResults: { url: string, thumbnailUrl: string | null, name: string, folderId: string | null, index: number }[] = []

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

            uploadResults.push({ url, thumbnailUrl, name: file.name, folderId: targetFolderId, index })

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
            }))

            await supabase.from('photos').insert(insertData)
          }
        }

        await fetchData(currentFolderId)
        await fetchStorageUsage()
      } else {
        // 파일 없이 폴더만 드롭한 경우
        await fetchData(currentFolderId)
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
    const uploadResults: { url: string, thumbnailUrl: string | null, name: string, index: number }[] = []

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

        uploadResults.push({ url, thumbnailUrl, name: file.name, index })

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
      }))

      await supabase.from('photos').insert(insertData)
    }

    setPendingFiles([])
    setDuplicateFiles([])
    setNonDuplicateFiles([])
    await fetchData(currentFolderId)
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
      for (let j = items.folders.length - 1; j >= 0; j--) {
        await supabase.from('folders').delete().eq('id', items.folders[j]).eq('user_id', user?.id)
      }
    }

    // 사진 삭제 (병렬 처리)
    const photosToDelete = photos.filter(p => selectedIds.has(p.id))
    if (photosToDelete.length > 0) {
      setDeleteStatus(`사진 삭제 중... (${photosToDelete.length}개)`)

      // R2 파일 삭제 (병렬) - 원본 + 썸네일
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

      // DB 삭제 (배치) - 소유자 확인
      const photoIds = photosToDelete.map(p => p.id)
      await supabase.from('photos').delete().in('id', photoIds).eq('user_id', user?.id)
    }

    setDeleting(false)
    setDeleteStatus('')
    setSelectedIds(new Set())
    setSelectedFolderIds(new Set())
    await fetchData(currentFolderId)
    await fetchStorageUsage()
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
      await fetchData(currentFolderId)
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
    await fetchData(currentFolderId)
  }

  const handleRenameFolder = async () => {
    if (!editingFolder || !editFolderName.trim()) return

    await supabase.from('folders')
      .update({ name: editFolderName.trim() })
      .eq('id', editingFolder.id)

    setEditingFolder(null)
    setEditFolderName('')
    await fetchData(currentFolderId)
  }

  const handleDeleteFolder = async (folderId: string) => {
    setFolderMenuId(null)

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
      setDeleteStatus(`사진 삭제 중... (${totalPhotos}개)`)

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
    await fetchData(currentFolderId)
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
    return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  // 정렬된 사진 목록
  const sortedPhotos = [...photos].sort((a, b) => {
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

  // 정렬된 폴더 목록
  const sortedFolders = [...folders].sort((a, b) => {
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

  // 폴더 컨텍스트 메뉴 컴포넌트
  const FolderContextMenu = ({ folder }: { folder: Folder }) => (
    <>
      <div
        className="fixed inset-0 z-[100]"
        onClick={(e) => {
          e.stopPropagation()
          setFolderMenuId(null)
        }}
      />
      <div
        className="dropdown-menu right-0 bottom-full mb-1 z-[101]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            setEditingFolder(folder)
            setEditFolderName(folder.name)
            setFolderMenuId(null)
          }}
          className="dropdown-item w-full"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          이름 변경
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleDeleteFolder(folder.id)
          }}
          className="dropdown-item dropdown-item-danger w-full"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          삭제
        </button>
      </div>
    </>
  )

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        </div>
      </main>
    )
  }

  const currentCategory = (searchParams.get('category') as FileCategory) || 'all'

  // 카테고리별 파일 필터링
  const filteredPhotos = photos.filter(photo => {
    if (currentCategory === 'all') return true
    const ext = photo.name.split('.').pop()?.toLowerCase() || ''
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif']
    const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'm4v']
    const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv']

    if (currentCategory === 'photos') return imageExts.includes(ext)
    if (currentCategory === 'videos') return videoExts.includes(ext)
    if (currentCategory === 'documents') return docExts.includes(ext)
    return true
  })

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

      {/* 메인 컨텐츠 (사이드바 여백) */}
      <div className="lg:pl-72">
        {/* 헤더 */}
        <header className="header safe-area-top">
          <div className="header-content">
            {/* 왼쪽: 메뉴 버튼 + 타이틀 */}
            <div className="flex items-center gap-3 min-w-0">
              {/* 모바일 메뉴 버튼 */}
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="lg:hidden p-2 rounded-xl hover:bg-white/10 transition-colors"
              >
                <svg className="w-6 h-6" style={{ color: 'var(--foreground)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* 현재 위치 */}
              <div className="flex items-center gap-2">
                {currentCategory !== 'all' ? (
                  <h1 className="font-bold text-lg" style={{ color: 'var(--foreground)' }}>
                    {currentCategory === 'photos' && '사진'}
                    {currentCategory === 'videos' && '동영상'}
                    {currentCategory === 'documents' && '문서'}
                  </h1>
                ) : breadcrumbs.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => router.push('/drive')}
                      className="text-sm hover:underline"
                      style={{ color: 'var(--foreground-secondary)' }}
                    >
                      내 드라이브
                    </button>
                    <svg className="w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="font-medium truncate max-w-[150px]" style={{ color: 'var(--foreground)' }}>
                      {breadcrumbs[breadcrumbs.length - 1]?.name}
                    </span>
                  </div>
                ) : (
                  <h1 className="font-bold text-lg" style={{ color: 'var(--foreground)' }}>내 드라이브</h1>
                )}
              </div>
            </div>

            {/* 오른쪽: 액션 버튼들 */}
          <div className="flex items-center gap-2">
            {/* 업로드 버튼 */}
            <label className="btn btn-primary cursor-pointer">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span className="hidden sm:inline">업로드</span>
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
              <span className="hidden sm:inline">새 폴더</span>
            </button>

            {/* 뷰 모드 토글 */}
            <div className="hidden sm:flex items-center rounded-lg p-0.5" style={{ background: 'var(--background-tertiary)' }}>
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
              className="btn btn-ghost !p-2 hidden sm:flex"
              title="로그아웃"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* 선택 모드 툴바 - 모바일: 하단 고정, 데스크톱: 헤더 하단 */}
      {isSelecting && (
        <div className="selection-toolbar safe-area-bottom animate-fade-in-up">
          <div className="flex items-center gap-2">
            <span className="badge badge-primary">
              {selectedIds.size + selectedFolderIds.size}개
            </span>
            <button
              onClick={selectAll}
              className="text-xs sm:text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
            >
              전체 선택
            </button>
          </div>
          <div className="flex items-center gap-1">
            {/* 다운로드 버튼 (사진만 선택했을 때) */}
            {selectedIds.size > 0 && (
              <button
                onClick={handleDownloadSelected}
                className="btn btn-ghost !p-2 !text-green-500"
                title="다운로드"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            )}
            {/* 이동 버튼 */}
            <button
              onClick={() => setShowMoveModal(true)}
              className="btn btn-ghost !p-2"
              title="이동"
              style={{ color: 'var(--accent-primary)' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>
            {/* 삭제 버튼 */}
            <button
              onClick={handleDeleteSelected}
              className="btn btn-ghost !p-2 !text-red-500"
              title="삭제"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
            {/* 취소 버튼 */}
            <button
              onClick={() => {
                setSelectedIds(new Set())
                setSelectedFolderIds(new Set())
              }}
              className="btn btn-ghost !p-2 opacity-60"
              title="취소"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 메인 콘텐츠 */}
      <div className="p-3 sm:p-4 md:p-6 pb-24 sm:pb-6">
        {/* 그리드 뷰 */}
        {viewMode === 'grid' && (
          <>
            {/* 폴더 섹션 */}
            {sortedFolders.length > 0 && (
              <div className="mb-6 sm:mb-8 animate-fade-in">
                <h2 className="text-xs sm:text-sm font-medium mb-3 sm:mb-4 uppercase tracking-wide" style={{ color: 'var(--foreground-muted)' }}>폴더</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2 sm:gap-3 md:gap-4">
                  {sortedFolders.map((folder, folderIndex) => (
                    <div
                      key={folder.id}
                      className={`folder-item group relative ${selectedFolderIds.has(folder.id) ? 'selected' : ''}`}
                      onClick={(e) => {
                        if (isSelecting) {
                          toggleFolderSelect(folder.id, e, folderIndex)
                        } else {
                          router.push(`/gallery?folder=${folder.id}`)
                        }
                      }}
                    >
                      <div className="w-full aspect-[4/3] rounded-lg flex items-center justify-center" style={{ background: 'var(--background-tertiary)' }}>
                        <svg className="w-10 h-10 sm:w-12 sm:h-12" style={{ color: 'var(--accent-primary)', opacity: 0.6 }} fill="currentColor" viewBox="0 0 24 24">
                          <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                        </svg>
                      </div>
                      <p className="font-medium truncate text-xs sm:text-sm mt-2">{folder.name}</p>
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
                          onClick={(e) => {
                            e.stopPropagation()
                            setFolderMenuId(folderMenuId === folder.id ? null : folder.id)
                          }}
                          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all backdrop-blur-sm"
                          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                        >
                          <svg className="w-4 h-4" style={{ color: 'var(--foreground-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>
                        {folderMenuId === folder.id && <FolderContextMenu folder={folder} />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 사진 그리드 */}
            {sortedPhotos.length > 0 && (
              <div className="animate-fade-in">
                {sortedFolders.length > 0 && (
                  <h2 className="text-xs sm:text-sm font-medium mb-3 sm:mb-4 uppercase tracking-wide" style={{ color: 'var(--foreground-muted)' }}>파일</h2>
                )}
                <div className="image-grid view-grid">
                  {sortedPhotos.map((photo, index) => (
                    <div
                      key={photo.id}
                      className={`image-item group ${selectedIds.has(photo.id) ? 'selected' : ''}`}
                      onClick={(e) => {
                        if (isSelecting) {
                          toggleSelect(photo.id, e, index)
                        } else {
                          router.push(`/viewer?index=${index}${currentFolderId ? `&folder=${currentFolderId}` : ''}&sortBy=${sortBy}&sortOrder=${sortOrder}`)
                        }
                      }}
                    >
                      <img
                        src={signedUrls[photo.thumbnail_url || photo.url] || photo.thumbnail_url || photo.url}
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

                      {/* 파일명 호버 시 표시 */}
                      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-white text-xs truncate">{photo.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* 리스트 뷰 */}
        {viewMode === 'list' && (
          <div className="card overflow-hidden">
            {/* 테이블 헤더 */}
            <div className="grid grid-cols-[auto_1fr_100px_100px_auto] gap-3 px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ background: 'var(--background-secondary)', color: 'var(--foreground-muted)', borderBottom: '1px solid var(--border-default)' }}>
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
              <div className="hidden sm:block">유형</div>
              <button
                onClick={() => {
                  if (sortBy === 'date') {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                  } else {
                    setSortBy('date')
                    setSortOrder('desc')
                  }
                }}
                className="hidden sm:flex items-center gap-1.5 hover:opacity-80 transition-opacity text-left"
              >
                날짜
                {sortBy === 'date' && (
                  <span style={{ color: 'var(--accent-primary)' }}>
                    {sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </button>
              <div className="w-8" />
            </div>

            {/* 폴더 목록 */}
            {sortedFolders.map((folder, folderIndex) => (
              <div
                key={folder.id}
                className="grid grid-cols-[auto_1fr_100px_100px_auto] gap-3 px-4 py-3 items-center cursor-pointer transition-colors group"
                style={{
                  background: selectedFolderIds.has(folder.id) ? 'var(--accent-primary-alpha)' : 'transparent',
                  borderBottom: '1px solid var(--border-light)'
                }}
                onClick={(e) => {
                  if (isSelecting) {
                    toggleFolderSelect(folder.id, e, folderIndex)
                  } else {
                    router.push(`/gallery?folder=${folder.id}`)
                  }
                }}
                onMouseEnter={(e) => !selectedFolderIds.has(folder.id) && (e.currentTarget.style.background = 'var(--background-secondary)')}
                onMouseLeave={(e) => !selectedFolderIds.has(folder.id) && (e.currentTarget.style.background = 'transparent')}
              >
                <div
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
                <div className="flex items-center gap-3 min-w-0">
                  <svg className="w-8 h-8 flex-shrink-0" style={{ color: 'var(--accent-primary)', opacity: 0.7 }} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                  </svg>
                  <span className="font-medium truncate">{folder.name}</span>
                </div>
                <div className="text-sm hidden sm:block" style={{ color: 'var(--foreground-muted)' }}>폴더</div>
                <div className="text-sm hidden sm:block" style={{ color: 'var(--foreground-muted)' }}>{formatDate(folder.created_at)}</div>
                <div className="w-8 relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setFolderMenuId(folderMenuId === folder.id ? null : folder.id)
                    }}
                    className="w-8 h-8 rounded-lg opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ color: 'var(--foreground-secondary)' }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                    </svg>
                  </button>
                  {folderMenuId === folder.id && <FolderContextMenu folder={folder} />}
                </div>
              </div>
            ))}

            {/* 사진 목록 */}
            {sortedPhotos.map((photo, index) => (
              <div
                key={photo.id}
                className="grid grid-cols-[auto_1fr_100px_100px_auto] gap-3 px-4 py-2.5 items-center cursor-pointer transition-colors group"
                style={{
                  background: selectedIds.has(photo.id) ? 'var(--accent-primary-alpha)' : 'transparent',
                  borderBottom: '1px solid var(--border-light)'
                }}
                onClick={(e) => {
                  if (isSelecting) {
                    toggleSelect(photo.id, e, index)
                  } else {
                    router.push(`/viewer?index=${index}${currentFolderId ? `&folder=${currentFolderId}` : ''}&sortBy=${sortBy}&sortOrder=${sortOrder}`)
                  }
                }}
                onMouseEnter={(e) => !selectedIds.has(photo.id) && (e.currentTarget.style.background = 'var(--background-secondary)')}
                onMouseLeave={(e) => !selectedIds.has(photo.id) && (e.currentTarget.style.background = 'transparent')}
              >
                <div
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
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0" style={{ background: 'var(--background-tertiary)' }}>
                    <img src={signedUrls[photo.thumbnail_url || photo.url] || photo.thumbnail_url || photo.url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  </div>
                  <span className="truncate font-medium">
                    {photo.name || photo.url.split('/').pop()}
                  </span>
                </div>
                <div className="text-sm hidden sm:block" style={{ color: 'var(--foreground-muted)' }}>이미지</div>
                <div className="text-sm hidden sm:block" style={{ color: 'var(--foreground-muted)' }}>{formatDate(photo.created_at)}</div>
                <div className="w-8" />
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
                <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>상단의 업로드 버튼 또는 드래그앤드롭으로 추가해보세요</p>
              </div>
            )}
          </div>
        )}

        {/* 빈 상태 (그리드 뷰) */}
        {viewMode === 'grid' && sortedPhotos.length === 0 && sortedFolders.length === 0 && (
          <div className="empty-state h-[60vh] animate-fade-in">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex items-center justify-center mb-4 sm:mb-6" style={{ background: 'var(--background-secondary)' }}>
              <svg className="empty-state-icon !w-10 !h-10 sm:!w-12 sm:!h-12 !mb-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="empty-state-title text-base sm:text-lg">아직 비어있어요</p>
            <p className="empty-state-description text-xs sm:text-sm">상단의 업로드 버튼 또는 드래그앤드롭으로 추가해보세요</p>
          </div>
        )}
      </div>

      {/* 새 폴더 모달 */}
      {showNewFolderInput && (
        <>
          <div className="modal-backdrop" onClick={() => { setShowNewFolderInput(false); setNewFolderName('') }} />
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="text-title">새 폴더</h2>
            </div>
            <div className="modal-body">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="폴더 이름을 입력하세요"
                className="input"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              />
            </div>
            <div className="modal-footer">
              <button
                onClick={() => {
                  setShowNewFolderInput(false)
                  setNewFolderName('')
                }}
                className="btn btn-secondary"
              >
                취소
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="btn btn-primary disabled:opacity-50"
              >
                만들기
              </button>
            </div>
          </div>
        </>
      )}

      {/* 폴더 이름 수정 모달 */}
      {editingFolder && (
        <>
          <div className="modal-backdrop" onClick={() => { setEditingFolder(null); setEditFolderName('') }} />
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="text-title">폴더 이름 변경</h2>
            </div>
            <div className="modal-body">
              <input
                type="text"
                value={editFolderName}
                onChange={(e) => setEditFolderName(e.target.value)}
                placeholder="새 폴더 이름을 입력하세요"
                className="input"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleRenameFolder()}
              />
            </div>
            <div className="modal-footer">
              <button
                onClick={() => {
                  setEditingFolder(null)
                  setEditFolderName('')
                }}
                className="btn btn-secondary"
              >
                취소
              </button>
              <button
                onClick={handleRenameFolder}
                disabled={!editFolderName.trim()}
                className="btn btn-primary disabled:opacity-50"
              >
                변경
              </button>
            </div>
          </div>
        </>
      )}

      {/* 폴더 선택 모달 (업로드 위치) */}
      {showFolderPicker && (
        <>
          <div className="modal-backdrop" onClick={() => { setShowFolderPicker(false); setPendingFiles([]) }} />
          <div className="modal-content !max-h-[70vh] flex flex-col">
            <div className="modal-header flex items-center justify-between">
              <h2 className="text-title">업로드 위치 선택</h2>
              <button
                onClick={() => {
                  setShowFolderPicker(false)
                  setPendingFiles([])
                }}
                className="btn btn-ghost !p-1.5"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
              <p className="text-small badge badge-primary">{pendingFiles.length}개 파일 선택됨</p>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {buildFolderTree(null).map(({ folder, depth }) => (
                <button
                  key={folder?.id || 'root'}
                  onClick={() => handleUploadToFolder(folder?.id || null)}
                  className="dropdown-item w-full rounded-lg"
                  style={{ paddingLeft: `${12 + depth * 20}px` }}
                >
                  <svg className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                  </svg>
                  <span className="text-sm truncate flex-1">
                    {folder ? folder.name : '홈 (루트)'}
                  </span>
                  {(folder?.id || null) === currentFolderId && (
                    <span className="badge">현재 위치</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 중복 파일 처리 모달 */}
      {showDuplicateModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className={`rounded-2xl w-full max-w-md overflow-hidden ${isDark ? 'bg-zinc-900' : 'bg-white'}`}>
            <div className={`p-5 border-b ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? 'bg-yellow-500/20' : 'bg-yellow-100'}`}>
                  <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>중복 파일 발견</h2>
                  <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                    {duplicateFiles.length}개의 파일이 이미 존재합니다
                  </p>
                </div>
              </div>
            </div>

            {/* 중복 파일 목록 */}
            <div className={`max-h-48 overflow-y-auto ${isDark ? 'bg-zinc-800/50' : 'bg-gray-50'}`}>
              {duplicateFiles.map((dup, idx) => (
                <div key={idx} className={`flex items-center gap-3 px-5 py-3 ${isDark ? 'border-b border-zinc-800' : 'border-b border-gray-100'}`}>
                  <div className={`w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 ${isDark ? 'bg-zinc-700' : 'bg-gray-200'}`}>
                    <img src={signedUrls[dup.existingPhoto.thumbnail_url || dup.existingPhoto.url] || dup.existingPhoto.thumbnail_url || dup.existingPhoto.url} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{dup.file.name}</p>
                    <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
                      {(dup.file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* 액션 버튼 */}
            <div className="p-4 space-y-2">
              <button
                onClick={() => handleDuplicateAction('overwrite')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'}`}
              >
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <div className="text-left">
                  <p className="font-medium">덮어쓰기</p>
                  <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>기존 파일을 새 파일로 교체</p>
                </div>
              </button>

              <button
                onClick={() => handleDuplicateAction('keep')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'}`}
              >
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <div className="text-left">
                  <p className="font-medium">둘 다 유지</p>
                  <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>새 파일 이름에 번호 추가</p>
                </div>
              </button>

              <button
                onClick={() => handleDuplicateAction('skip')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'}`}
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                <div className="text-left">
                  <p className="font-medium">건너뛰기</p>
                  <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>중복 파일은 업로드하지 않음</p>
                </div>
              </button>

              <button
                onClick={() => {
                  setShowDuplicateModal(false)
                  setDuplicateFiles([])
                  setNonDuplicateFiles([])
                  setPendingUploadFolderId(null)
                }}
                className={`w-full py-3 rounded-xl font-medium transition-colors ${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이동 대상 폴더 선택 모달 */}
      {showMoveModal && (
        <>
          <div className="modal-backdrop" style={{ zIndex: 10000 }} onClick={() => setShowMoveModal(false)} />
          <div className="modal-content !max-h-[70vh] flex flex-col" style={{ zIndex: 10001 }}>
            <div className="modal-header flex items-center justify-between">
              <h2 className="text-title">이동할 폴더 선택</h2>
              <button
                onClick={() => setShowMoveModal(false)}
                className="btn btn-ghost !p-1.5"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
              <div className="flex gap-2">
                {selectedIds.size > 0 && <span className="badge badge-primary">{selectedIds.size}개 파일</span>}
                {selectedFolderIds.size > 0 && <span className="badge badge-primary">{selectedFolderIds.size}개 폴더</span>}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {buildFolderTree(null).map(({ folder, depth }) => {
                const isSelected = folder && selectedFolderIds.has(folder.id)
                const isCurrent = (folder?.id || null) === currentFolderId

                if (isSelected) return null

                return (
                  <button
                    key={folder?.id || 'root'}
                    onClick={() => handleMoveSelected(folder?.id || null)}
                    disabled={moving || isCurrent}
                    className={`dropdown-item w-full rounded-lg ${isCurrent ? 'opacity-50 cursor-not-allowed' : ''}`}
                    style={{ paddingLeft: `${12 + depth * 20}px` }}
                  >
                    <svg className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                    </svg>
                    <span className="text-sm truncate flex-1">
                      {folder ? folder.name : '홈 (루트)'}
                    </span>
                    {isCurrent && <span className="badge">현재 위치</span>}
                  </button>
                )
              })}
            </div>

            {moving && (
              <div className="modal-footer !justify-start">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-default)', borderTopColor: 'var(--accent-primary)' }} />
                  <span className="text-small" style={{ color: 'var(--foreground-secondary)' }}>이동 중...</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* 삭제 진행 오버레이 */}
      {deleting && (
        <div className="modal-backdrop !z-[300] flex items-center justify-center">
          <div className="card p-6 !transform-none animate-fade-in-scale">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 border-3 rounded-full animate-spin" style={{ borderColor: 'var(--border-default)', borderTopColor: '#ef4444' }} />
              <div>
                <p className="font-medium">삭제 중</p>
                <p className="text-small" style={{ color: 'var(--foreground-secondary)' }}>{deleteStatus}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      </div>{/* lg:pl-72 끝 */}
    </main>
  )
}
