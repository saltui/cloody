'use client'

import { useState, useEffect, useCallback, useRef, useMemo, DragEvent, memo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { useUpload } from '@/lib/upload-context'
import { useDownload } from '@/lib/download-context'
import { useUser } from '@/lib/user-context'
import { useDataCache, type CategoryFilter } from '@/lib/data-cache'
import { useToast } from '@/components/Toast'
import Sidebar, { FileCategory } from '@/components/Sidebar'
import { Home, Image as ImageIcon, CloudUpload, Menu } from 'lucide-react'
import { FileThumbnail, isMediaFile, getFileTypeLabel } from '@/lib/file-icons'
import LazyVideoThumbnail from '@/components/LazyVideoThumbnail'
import { isVideoFile } from '@/lib/url-utils'
import heic2any from 'heic2any'

// file_type을 DB 컬럼 크기(50자)에 맞게 제한
function truncateFileType(fileType: string | undefined): string | undefined {
  if (!fileType) return fileType
  return fileType.slice(0, 50)
}

const MIN_UPLOAD_CONCURRENCY = 4
const MAX_UPLOAD_CONCURRENCY = 16
const DEBUG_UPLOAD_LOGS = process.env.NEXT_PUBLIC_DEBUG_UPLOAD_LOGS === '1'
const MAX_SERVER_FALLBACK_SIZE = 4 * 1024 * 1024 // 4MB (Vercel 본문 제한 안전 구간)
const ENABLE_SERVER_UPLOAD_FALLBACK = process.env.NODE_ENV !== 'production'
  || process.env.NEXT_PUBLIC_ENABLE_SERVER_UPLOAD_FALLBACK === '1'

function uploadDebugInfo(...args: unknown[]) {
  if (DEBUG_UPLOAD_LOGS) {
    console.info(...args)
  }
}

function uploadDebugLog(...args: unknown[]) {
  if (DEBUG_UPLOAD_LOGS) {
    console.log(...args)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getUploadConcurrency(files: Array<{ size: number }>): number {
  if (files.length === 0) return MIN_UPLOAD_CONCURRENCY

  // 운영 중 빠른 튜닝을 위해 환경 변수로 강제 오버라이드 지원
  const configured = Number(process.env.NEXT_PUBLIC_UPLOAD_CONCURRENCY)
  if (Number.isFinite(configured) && configured > 0) {
    return clamp(Math.floor(configured), MIN_UPLOAD_CONCURRENCY, MAX_UPLOAD_CONCURRENCY)
  }

  const fileCount = files.length
  const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0)
  const avgSizeMb = totalBytes / fileCount / (1024 * 1024)

  // CPU 코어 수 기준 상한 (브라우저 과부하 방지)
  const hardwareThreads = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 8
  const hardwareCap = clamp(Math.round(hardwareThreads * 1.5), 8, MAX_UPLOAD_CONCURRENCY)

  let concurrency = 8
  if (fileCount >= 300) concurrency = 14
  else if (fileCount >= 120) concurrency = 12
  else if (fileCount >= 40) concurrency = 10

  // 평균 파일 크기가 크면 동시성은 조금 낮춰 브라우저 렉/실패율을 줄임
  if (avgSizeMb >= 300) concurrency -= 3
  else if (avgSizeMb >= 150) concurrency -= 2
  else if (avgSizeMb >= 80) concurrency -= 1

  return clamp(concurrency, MIN_UPLOAD_CONCURRENCY, hardwareCap)
}

async function runWithConcurrency(
  total: number,
  concurrency: number,
  worker: (index: number) => Promise<void>
): Promise<void> {
  if (total <= 0) return

  const limit = Math.max(1, Math.min(concurrency, total))
  let nextIndex = 0

  const runners = Array.from({ length: limit }, async () => {
    while (nextIndex < total) {
      const index = nextIndex
      nextIndex += 1
      await worker(index)
    }
  })

  await Promise.all(runners)
}

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

// XMLHttpRequest를 사용한 업로드 (진행률 추적 지원)
function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress?: (percent: number, loaded: number, total: number) => void
): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100)
        onProgress(percent, event.loaded, event.total)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText)
          resolve(response)
        } catch (error) {
          console.error('[upload] uploadWithProgress response parse failed:', error)
          reject(new Error('Invalid response'))
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`))
      }
    })

    xhr.addEventListener('error', () => {
      reject(new Error('Network error'))
    })

    xhr.open('POST', url)
    xhr.send(formData)
  })
}

// 확장자 기반 MIME 타입 결정 (확장자 우선, 브라우저 타입은 폴백)
// HEIC/HEIF는 일부 브라우저/R2에서 CORS preflight 문제가 있어 octet-stream 사용
function getMimeTypeFromExtension(fileName: string, browserType: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const mimeMap: Record<string, string> = {
    // 이미지 (HEIC/HEIF는 CORS 호환성을 위해 octet-stream 사용)
    heic: 'application/octet-stream',
    heif: 'application/octet-stream',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    // 비디오
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    m4v: 'video/mp4',
    '3gp': 'video/3gpp',
    // 문서
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    // 개발 파일
    json: 'application/json',
    js: 'text/javascript',
    ts: 'text/javascript',
    jsx: 'text/javascript',
    tsx: 'text/javascript',
    html: 'text/html',
    css: 'text/css',
    md: 'text/markdown',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    sh: 'text/x-sh',
    bash: 'text/x-sh',
    py: 'text/x-python',
    java: 'text/x-java-source',
    go: 'text/x-go',
    rs: 'text/x-rust',
    sql: 'text/x-sql',
    toml: 'application/toml',
    xml: 'application/xml',
  }

  // 확장자 기반 MIME 타입 우선 사용
  if (ext && mimeMap[ext]) {
    return mimeMap[ext]
  }

  // 확장자가 알 수 없는 경우 브라우저 타입 사용
  if (browserType && browserType !== 'application/octet-stream') {
    return browserType
  }

  return 'application/octet-stream'
}

async function uploadViaServerApi(
  file: File,
  fileName: string,
  onProgress?: (percent: number, loaded: number, total: number) => void
): Promise<{ url: string }> {
  const formData = new FormData()
  formData.append('file', file, fileName)
  formData.append('fileName', fileName)

  if (onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.timeout = 10 * 60 * 1000

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100)
          onProgress(percent, event.loaded, event.total)
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText)
            if (!data?.url) {
              reject(new Error('Upload succeeded but response URL is missing'))
              return
            }
            resolve({ url: data.url as string })
          } catch (error) {
            console.error('[upload] uploadViaServerApi response parse failed:', error)
            reject(new Error('Upload succeeded but response parsing failed'))
          }
        } else if (xhr.status === 413) {
          reject(new Error('요청 파일이 서버 업로드 제한을 초과했습니다. 직접 업로드를 다시 시도해주세요.'))
        } else {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`))
        }
      })

      xhr.addEventListener('error', () => {
        reject(new Error('Network error during server upload'))
      })
      xhr.addEventListener('timeout', () => {
        reject(new Error('Server upload timeout (10 minutes)'))
      })
      xhr.addEventListener('abort', () => {
        reject(new Error('Server upload aborted'))
      })

      xhr.open('POST', '/api/upload')
      xhr.send(formData)
    })
  }

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    if (response.status === 413) {
      throw new Error('요청 파일이 서버 업로드 제한을 초과했습니다. 직접 업로드를 다시 시도해주세요.')
    }
    const errorText = await response.text()
    throw new Error(`Server upload failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  if (!data?.url) {
    throw new Error('Server upload response URL is missing')
  }

  return { url: data.url as string }
}

// Presigned URL을 사용한 직접 R2 업로드 (Vercel body size 제한 우회)
async function uploadWithPresignedUrl(
  file: File,
  fileName: string,
  onProgress?: (percent: number, loaded: number, total: number) => void
): Promise<{ url: string }> {
  let canFallbackToServer = ENABLE_SERVER_UPLOAD_FALLBACK && file.size <= MAX_SERVER_FALLBACK_SIZE
  try {
    // 확장자 기반으로 MIME 타입 결정 (브라우저가 HEIC/MOV 등을 인식하지 못할 때)
    const fileType = getMimeTypeFromExtension(file.name, file.type)

    // 1. Presigned URL 요청
    const presignRes = await fetch('/api/upload/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName,
        fileType,
        fileSize: file.size,
      }),
    })

    if (!presignRes.ok) {
      let message = 'Presign failed'
      try {
        const error = await presignRes.json() as { error?: string }
        message = error.error || message
      } catch (error) {
        console.error('[upload] presign error response parse failed:', error)
      }
      // Presign이 비즈니스 규칙으로 거절된 경우(4xx)는 서버 업로드 폴백 대상이 아님
      if (presignRes.status >= 400 && presignRes.status < 500) {
        canFallbackToServer = false
      }
      throw new Error(message)
    }

    // 서버에서 반환한 contentType 사용 (presign과 upload가 동일한 타입 사용 보장)
    const { uploadUrl, publicUrl, contentType } = await presignRes.json()
    const uploadContentType = contentType || fileType

    // 진행률 추적이 필요하면 XHR 사용, 아니면 fetch 사용
    if (onProgress) {
      return await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        // 파일 크기에 비례한 타임아웃 (최소 5분, 100MB당 5분 추가, 최대 60분)
        const baseTimeout = 5 * 60 * 1000
        const sizeBasedTimeout = Math.ceil(file.size / (100 * 1024 * 1024)) * 5 * 60 * 1000
        xhr.timeout = Math.min(Math.max(baseTimeout, sizeBasedTimeout), 60 * 60 * 1000)

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100)
            onProgress(percent, event.loaded, event.total)
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ url: publicUrl })
          } else {
            uploadDebugInfo('[R2Upload] Direct upload failed:', xhr.status, xhr.responseText)
            reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`))
          }
        })

        xhr.addEventListener('error', () => {
          uploadDebugInfo('[R2Upload] Direct upload network error, fallback 예정:', fileName)
          reject(new Error('Network error during upload'))
        })

        xhr.addEventListener('timeout', () => {
          uploadDebugInfo('[R2Upload] Direct upload timeout, fallback 예정:', fileName)
          reject(new Error('Upload timeout (5 minutes)'))
        })

        xhr.addEventListener('abort', () => {
          uploadDebugInfo('[R2Upload] Direct upload aborted, fallback 예정:', fileName)
          reject(new Error('Upload aborted'))
        })

        xhr.open('PUT', uploadUrl)
        xhr.setRequestHeader('Content-Type', uploadContentType)
        xhr.send(file)
      })
    }

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': uploadContentType,
      },
      body: file,
    })

    if (!response.ok) {
      const errorText = await response.text()
      uploadDebugInfo('[R2Upload] Direct fetch upload failed:', response.status, errorText)
      throw new Error(`Upload failed: ${response.status}`)
    }

    return { url: publicUrl }
  } catch (error) {
    if (canFallbackToServer) {
      uploadDebugInfo('[R2Upload] Falling back to /api/upload:', error)
      return uploadViaServerApi(file, fileName, onProgress)
    }
    throw error
  }
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
    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    video.preload = 'auto'
    video.muted = true
    video.playsInline = true

    const objectUrl = URL.createObjectURL(file)
    let resolved = false

    // 타임아웃 설정 (15초)
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
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

      try {
        let { videoWidth: width, videoHeight: height } = video

        if (width === 0 || height === 0) {
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
            if (!resolved) {
              resolved = true
              cleanup()
              resolve(blob)
            }
          },
          'image/webp',
          0.8
        )
      } catch (error) {
        console.error('[drive] captureFrame canvas.toBlob failed:', error)
        if (!resolved) {
          resolved = true
          cleanup()
          resolve(null)
        }
      }
    }

    video.onloadeddata = () => {
      if (resolved) return
      const seekTime = Math.min(1, (video.duration || 1) * 0.1)
      video.currentTime = seekTime
    }

    video.onseeked = () => {
      if (resolved) return
      setTimeout(captureFrame, 100)
    }

    video.onerror = () => {
      if (!resolved) {
        resolved = true
        cleanup()
        resolve(null)
      }
    }

    video.src = objectUrl
    video.load()
  })
}

// HEIC/HEIF 파일인지 확인
const isHeicFile = (file: File): boolean => {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  return type === 'image/heic' || type === 'image/heif' ||
         name.endsWith('.heic') || name.endsWith('.heif')
}

// 이미지 썸네일 생성 함수 (400px 리사이즈)
const generateImageThumbnail = async (file: File, maxSize: number = 400): Promise<Blob | null> => {
  try {
    let imageFile: File | Blob = file

    // HEIC/HEIF 파일은 JPEG로 변환
    if (isHeicFile(file)) {
      uploadDebugLog('[ImageThumb] HEIC detected, converting:', file.name)
      try {
        const convertedBlob = await heic2any({
          blob: file,
          toType: 'image/jpeg',
          quality: 0.9
        })
        imageFile = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob
        uploadDebugLog('[ImageThumb] HEIC converted successfully')
      } catch (heicError) {
        uploadDebugInfo('[ImageThumb] HEIC conversion failed:', heicError)
        return null
      }
    }

    return new Promise((resolve) => {
      const img = new Image()
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const objectUrl = URL.createObjectURL(imageFile)

      img.onload = () => {
        URL.revokeObjectURL(objectUrl)
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

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        resolve(null)
      }
      img.src = objectUrl
    })
  } catch (error) {
    uploadDebugInfo('[ImageThumb] Error:', error)
    return null
  }
}

// 통합 썸네일 생성 함수
const generateThumbnail = (file: File, maxSize: number = 400): Promise<Blob | null> => {
  if (file.type.startsWith('video/')) {
    return generateVideoThumbnail(file, maxSize)
  }
  if (file.type.startsWith('image/') || isHeicFile(file)) {
    return generateImageThumbnail(file, maxSize)
  }
  return Promise.resolve(null)
}

// 서버 측 HEIC 썸네일 생성 (클라이언트 heic2any 실패 시 폴백)
async function generateHeicThumbnailServerSide(
  originalFileName: string,
  thumbnailFileName: string
): Promise<string | null> {
  try {
    uploadDebugLog('[ServerThumb] Requesting server-side HEIC thumbnail:', originalFileName)
    const res = await fetch('/api/thumbnail/heic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: originalFileName,
        thumbnailName: thumbnailFileName,
      }),
    })

    if (!res.ok) {
      uploadDebugInfo('[ServerThumb] Server thumbnail generation failed:', res.status)
      return null
    }

    const { thumbnailUrl } = await res.json()
    uploadDebugLog('[ServerThumb] Server thumbnail generated:', thumbnailUrl)
    return thumbnailUrl
  } catch (error) {
    uploadDebugInfo('[ServerThumb] Error:', error)
    return null
  }
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

interface ExistingDuplicatePhoto {
  id: string
  name: string
  url: string
  thumbnail_url: string | null
}

interface DuplicateFile {
  file: File
  existingPhoto: ExistingDuplicatePhoto
}

interface FileWithFolderPath {
  file: File
  folderPath: string
}

type FolderParentColumn = 'parent_id' | 'parent_folder_id'

interface SupabaseErrorLike {
  code?: string
  message?: string
  details?: string
  hint?: string
}

const BLOCKED_FOLDER_PATTERNS = [
  /^\./, // .으로 시작하는 폴더
  /^node_modules$/i,
  /^__pycache__$/i,
  /^__tests__$/i,
  /^\.next$/i,
  /^\.git$/i,
  /^\.vscode$/i,
  /^dist$/i,
  /^build$/i,
  /^coverage$/i,
  /^vendor$/i,
]

function isBlockedFolderName(name: string): boolean {
  return BLOCKED_FOLDER_PATTERNS.some(pattern => pattern.test(name))
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function normalizeSupabaseError(error: unknown): SupabaseErrorLike {
  if (!error || typeof error !== 'object') {
    return { message: String(error || 'Unknown error') }
  }
  const candidate = error as SupabaseErrorLike
  return {
    code: candidate.code,
    message: candidate.message || 'Unknown error',
    details: candidate.details,
    hint: candidate.hint,
  }
}

function formatSupabaseError(error: unknown): string {
  const normalized = normalizeSupabaseError(error)
  return [normalized.code, normalized.message, normalized.details, normalized.hint]
    .filter(Boolean)
    .join(' | ')
}

function isMissingColumnError(error: unknown, columnName?: string): boolean {
  const normalized = normalizeSupabaseError(error)
  const code = normalized.code || ''
  const message = `${normalized.message || ''} ${normalized.details || ''} ${normalized.hint || ''}`.toLowerCase()
  if (code === '42703' || code === 'PGRST204') {
    return !columnName || message.includes(columnName.toLowerCase())
  }
  return message.includes('column') && (!columnName || message.includes(columnName.toLowerCase()))
}

export default function DrivePage() {
  const { theme, viewMode, setTheme, setViewMode } = useTheme()
  const { uploading, uploadQueue, uploadProgress, showUploadPanel, setShowUploadPanel, addToQueue, updateQueueItem, removeFromQueue, clearCompleted, clearAll } = useUpload()
  const { startDownload, startZipDownload } = useDownload()
  const { user, isLoading: userLoading } = useUser()
  const { showToast } = useToast()
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
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [showMoreScreen, setShowMoreScreen] = useState(false)
  const [isDesktopViewport, setIsDesktopViewport] = useState(false)

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

  // 검색
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [allPhotosForSearch, setAllPhotosForSearch] = useState<Photo[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

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
  // Shift 키 상태 추적 (드래그 선택 중 추가 선택용)
  const shiftKeyRef = useRef(false)
  // 범위 선택을 위한 정렬된 배열 refs
  const sortedFoldersRef = useRef<Folder[]>([])
  const sortedPhotosRef = useRef<Photo[]>([])

  // Pull to refresh (모바일)
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const pullStartY = useRef<number | null>(null)
  const isPulling = useRef(false)
  const PULL_THRESHOLD = 80

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

  // isInitialLoad를 ref로 추적 (useCallback 의존성에서 제외하여 무한 재호출 방지)
  const isInitialLoadRef = useRef(isInitialLoad)
  isInitialLoadRef.current = isInitialLoad

  // fetch 요청 카운터 (race condition 방지)
  const fetchCounterRef = useRef(0)
  const folderParentColumnRef = useRef<FolderParentColumn>('parent_id')
  const uploadProgressSnapshotRef = useRef<Map<string, { percent: number; loaded: number; ts: number }>>(new Map())
  const uploadQueueSizeRef = useRef(0)
  const optimisticPhotoBufferRef = useRef<Photo[]>([])
  const optimisticPhotoFlushTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingStorageDeltaRef = useRef(0)
  const pendingStorageFlushTimerRef = useRef<NodeJS.Timeout | null>(null)
  const storageUsageRequestIdRef = useRef(0)
  const getFolderParentColumns = useCallback((): FolderParentColumn[] => {
    return folderParentColumnRef.current === 'parent_folder_id'
      ? ['parent_folder_id', 'parent_id']
      : ['parent_id', 'parent_folder_id']
  }, [])

  const shouldDisplayUploadedInCurrentView = useCallback((folderId: string | null, isVideo: boolean, fileType?: string): boolean => {
    const category = searchParams.get('category') || 'all'
    if (category === 'all') {
      return (folderId === null && currentFolderId === null) || folderId === currentFolderId
    }
    if (category === 'photos') return !isVideo
    if (category === 'videos') return isVideo
    if (category === 'documents') {
      const normalizedType = (fileType || '').toLowerCase()
      return !isVideo && !normalizedType.startsWith('image/')
    }
    return false
  }, [searchParams, currentFolderId])

  const flushOptimisticPhotos = useCallback(() => {
    const queued = optimisticPhotoBufferRef.current
    if (queued.length === 0) return
    optimisticPhotoBufferRef.current = []

    setPhotos(prev => {
      const existingUrls = new Set(prev.map(item => item.url))
      const appended = queued.filter(item => !existingUrls.has(item.url))
      if (appended.length === 0) return prev
      return [...prev, ...appended]
    })
  }, [])

  const flushStorageDelta = useCallback(() => {
    if (pendingStorageDeltaRef.current === 0) return
    const delta = pendingStorageDeltaRef.current
    pendingStorageDeltaRef.current = 0
    setStorageUsed(prev => Math.max(0, prev + delta))
  }, [])

  const enqueueStorageDelta = useCallback((delta: number) => {
    if (!Number.isFinite(delta) || delta === 0) return
    pendingStorageDeltaRef.current += delta
    if (pendingStorageFlushTimerRef.current) return

    pendingStorageFlushTimerRef.current = setTimeout(() => {
      pendingStorageFlushTimerRef.current = null
      flushStorageDelta()
    }, 250)
  }, [flushStorageDelta])

  const enqueueOptimisticPhoto = useCallback((photo: Photo) => {
    optimisticPhotoBufferRef.current.push(photo)
    if (optimisticPhotoFlushTimerRef.current) return

    optimisticPhotoFlushTimerRef.current = setTimeout(() => {
      optimisticPhotoFlushTimerRef.current = null
      flushOptimisticPhotos()
    }, 200)
  }, [flushOptimisticPhotos])

  useEffect(() => {
    return () => {
      if (optimisticPhotoFlushTimerRef.current) {
        clearTimeout(optimisticPhotoFlushTimerRef.current)
        optimisticPhotoFlushTimerRef.current = null
      }
      if (pendingStorageFlushTimerRef.current) {
        clearTimeout(pendingStorageFlushTimerRef.current)
        pendingStorageFlushTimerRef.current = null
      }
      pendingStorageDeltaRef.current = 0
      flushOptimisticPhotos()
      uploadProgressSnapshotRef.current.clear()
    }
  }, [flushOptimisticPhotos])

  useEffect(() => {
    uploadQueueSizeRef.current = uploadQueue.length
  }, [uploadQueue.length])

  const updateQueueProgressThrottled = useCallback((itemId: string, percent: number, loaded: number) => {
    const roundedPercent = Math.max(0, Math.min(99, Math.round(percent)))
    const now = Date.now()
    const previous = uploadProgressSnapshotRef.current.get(itemId)
    const queueSize = uploadQueueSizeRef.current
    const minPercentDelta = queueSize >= 1200 ? 6 : queueSize >= 600 ? 4 : queueSize >= 250 ? 3 : 2
    const minLoadedDelta = queueSize >= 1200 ? 1024 * 1024 : queueSize >= 600 ? 768 * 1024 : 256 * 1024
    const minElapsedMs = queueSize >= 1200 ? 600 : queueSize >= 600 ? 450 : 250

    if (previous) {
      const percentAdvanced = roundedPercent - previous.percent
      const loadedAdvanced = loaded - previous.loaded
      const elapsed = now - previous.ts
      if (percentAdvanced < minPercentDelta && loadedAdvanced < minLoadedDelta && elapsed < minElapsedMs) {
        return
      }
    }

    uploadProgressSnapshotRef.current.set(itemId, {
      percent: roundedPercent,
      loaded,
      ts: now,
    })
    updateQueueItem(itemId, { progress: roundedPercent, uploadedSize: loaded })
  }, [updateQueueItem])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1280px)')
    const updateViewport = () => setIsDesktopViewport(mediaQuery.matches)
    updateViewport()

    mediaQuery.addEventListener('change', updateViewport)
    return () => mediaQuery.removeEventListener('change', updateViewport)
  }, [])

  const mobileUploadItems = useMemo(() => {
    if (uploadQueue.length <= 200) return uploadQueue
    return uploadQueue.slice(-200)
  }, [uploadQueue])

  const hiddenMobileUploadCount = Math.max(0, uploadQueue.length - mobileUploadItems.length)

  const fetchData = useCallback(async (folderId: string | null, category: string = 'all') => {
    // 사용자 ID가 없으면 로딩 유지 (사용자 로딩 완료될 때까지)
    if (!user?.id) {
      return
    }

    // 현재 fetch ID 기록 (새 요청이 오면 이전 결과 무시)
    const currentFetchId = ++fetchCounterRef.current

    // 초기 로딩일 때만 로딩 표시 (캐시 데이터가 있으면 바로 표시)
    if (isInitialLoadRef.current) {
      setLoading(true)
    }

    // 페이지네이션 초기화
    setCursor(0)
    setHasMore(true)

    // 캐시에서 폴더 데이터 가져오기
    const fetchedFolders = await dataCache.getFolders(user.id)

    // 이미 다른 요청이 시작되었으면 이 결과 무시
    if (currentFetchId !== fetchCounterRef.current) {
      return
    }

    setAllFolders(fetchedFolders)

    const childFolders = fetchedFolders.filter(f => {
      const normalizedParentId = f.parent_id ?? null
      return folderId ? normalizedParentId === folderId : normalizedParentId === null
    })
    setFolders(childFolders)

    await buildBreadcrumbs(folderId, fetchedFolders)

    // 이미 다른 요청이 시작되었으면 이 결과 무시
    if (currentFetchId !== fetchCounterRef.current) {
      return
    }

    // 카테고리가 'all'이면 현재 폴더의 파일만 가져옴
    // 카테고리가 photos/videos/documents면 페이지네이션으로 가져옴
    if (category === 'all') {
      // 캐시에서 현재 폴더의 사진 가져오기
      const photosData = await dataCache.getPhotos(user.id, folderId)

      // 이미 다른 요청이 시작되었으면 이 결과 무시
      if (currentFetchId !== fetchCounterRef.current) {
        return
      }

      setPhotos(photosData as Photo[])
      setHasMore(false) // 폴더 뷰는 전체 로드
    } else if (category === 'photos' || category === 'videos' || category === 'documents') {
      // 페이지네이션으로 첫 페이지 가져오기
      const result = await dataCache.getPhotosPaginated(user.id, {
        category: category as CategoryFilter,
        limit: 40,
        cursor: 0,
      })

      // 이미 다른 요청이 시작되었으면 이 결과 무시
      if (currentFetchId !== fetchCounterRef.current) {
        return
      }

      setPhotos(result.data as Photo[])
      setHasMore(result.hasMore)
      setCursor(result.nextCursor)
    } else {
      // 기타 카테고리는 전체 로드 (fallback)
      const allPhotos = await dataCache.getAllPhotos(user.id)

      // 이미 다른 요청이 시작되었으면 이 결과 무시
      if (currentFetchId !== fetchCounterRef.current) {
        return
      }

      setPhotos(allPhotos as Photo[])
      setHasMore(false)
    }

    setLoading(false)
    setIsInitialLoad(false)
  }, [buildBreadcrumbs, user?.id, dataCache])

  // 무한 스크롤: 더 불러오기
  const loadMore = useCallback(async () => {
    const category = searchParams.get('category') || 'all'
    if (!user?.id || loadingMore || !hasMore) return
    if (category !== 'photos' && category !== 'videos' && category !== 'documents') return

    setLoadingMore(true)

    try {
      const result = await dataCache.getPhotosPaginated(user.id, {
        category: category as CategoryFilter,
        limit: 40,
        cursor,
      })

      // 중복 방지: ID로 중복 체크 후 새 항목만 추가
      setPhotos(prev => {
        const existingIds = new Set(prev.map(p => p.id))
        const newPhotos = (result.data as Photo[]).filter(p => !existingIds.has(p.id))
        return [...prev, ...newPhotos]
      })
      setHasMore(result.hasMore)
      setCursor(result.nextCursor)
    } catch (error) {
      console.error('Load more error:', error)
    } finally {
      setLoadingMore(false)
    }
  }, [user?.id, loadingMore, hasMore, cursor, searchParams, dataCache])

  const fetchStorageUsage = useCallback(async (forceRefresh = false) => {
    const requestId = ++storageUsageRequestIdRef.current
    try {
      if (!user?.id) {
        if (requestId === storageUsageRequestIdRef.current) {
          setStorageUsed(0)
        }
        return
      }
      const endpoint = forceRefresh
        ? `/api/storage?refresh=1&includeR2=1&ts=${Date.now()}`
        : '/api/storage'
      const res = await fetch(endpoint, {
        credentials: 'include', // 쿠키 포함
        cache: forceRefresh ? 'no-store' : 'default',
        headers: {
          'x-user-id': user.id,
        },
      })
      if (!res.ok) {
        console.error('Storage usage error:', res.status)
        return
      }
      const payload = await res.json() as {
        usage?: number | string
        logicalUsage?: number | string
        maxUsage?: number | string
      }
      if (requestId !== storageUsageRequestIdRef.current) {
        return
      }
      // 실사용(과금) 기준에 가깝게 서버의 usage(=max/logical+bucket 보정값)를 우선 표시
      const usageCandidate = payload.usage ?? payload.maxUsage ?? payload.logicalUsage ?? 0
      const parsedUsage = Number(usageCandidate)
      setStorageUsed(Number.isFinite(parsedUsage) ? parsedUsage : 0)
    } catch (err) {
      console.error('Failed to fetch storage usage:', err)
    }
  }, [user?.id])

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
    window.scrollTo(0, 0)
    gridContainerRef.current?.scrollTo(0, 0)
    fetchData(folderId, category)
    fetchStorageUsage(true)
  }, [searchParams, fetchData, fetchStorageUsage])

  useEffect(() => {
    if (!uploading || !user?.id) return

    const timer = window.setInterval(() => {
      void fetchStorageUsage(true)
    }, 8000)

    return () => {
      window.clearInterval(timer)
    }
  }, [uploading, user?.id, fetchStorageUsage])

  // tab=more 쿼리 파라미터 처리 (휴지통 등에서 뒤로가기 시)
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'more') {
      setShowMoreScreen(true)
      setShowUploadPanel(false)
      // URL에서 tab 파라미터 제거 (히스토리 깔끔하게)
      const url = new URL(window.location.href)
      url.searchParams.delete('tab')
      window.history.replaceState({}, '', url.pathname + url.search)
    }
  }, [searchParams])

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
    // photos/videos/documents 탭에서만 무한 스크롤 활성화
    if (category !== 'photos' && category !== 'videos' && category !== 'documents') return
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
      let folderCount = 0
      for (const parentColumn of getFolderParentColumns()) {
        const { count, error } = await supabase
          .from('folders')
          .select('*', { count: 'exact', head: true })
          .eq(parentColumn, infoFolder.id)
          .eq('user_id', user.id)

        if (!error) {
          folderParentColumnRef.current = parentColumn
          folderCount = count || 0
          break
        }

        if (!isMissingColumnError(error, parentColumn)) {
          console.error('[Folder Info] Child folder count error:', formatSupabaseError(error))
          break
        }
      }

      setInfoFolderCounts({
        files: fileCount || 0,
        folders: folderCount
      })
    }

    fetchFolderCounts()
  }, [infoFolder, user, getFolderParentColumns])

  // 모달이 열릴 때 body 스크롤 차단 (입력 모달 제외 - 키보드 문제 방지)
  useEffect(() => {
    const isInputModal = showNewFolderInput || !!editingFolder || !!editingPhoto
    const isInfoModal = !!infoPhoto || !!infoFolder || showFolderPicker

    if (isInfoModal && !isInputModal) {
      // 정보 모달: position fixed로 완전 차단
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      const scrollY = window.scrollY
      document.body.style.overflow = 'hidden'
      document.body.style.paddingRight = `${scrollbarWidth}px`
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
      document.body.style.top = `-${scrollY}px`
      document.body.dataset.scrollY = String(scrollY)
    } else if (isInputModal) {
      // 입력 모달: overflow hidden만 (키보드 동작 허용)
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      document.body.style.overflow = 'hidden'
      document.body.style.paddingRight = `${scrollbarWidth}px`
    } else {
      // 모달 닫힘
      const scrollY = document.body.dataset.scrollY
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
      delete document.body.dataset.scrollY
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY))
      }
    }
    return () => {
      const scrollY = document.body.dataset.scrollY
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
      delete document.body.dataset.scrollY
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY))
      }
    }
  }, [infoPhoto, infoFolder, showNewFolderInput, editingFolder, editingPhoto, showFolderPicker])

  // iCloud 파일 준비 (다운로드 대기)
  const [iCloudDownloading, setICloudDownloading] = useState(false)
  const [iCloudProgress, setICloudProgress] = useState({ current: 0, total: 0, fileName: '' })

  const prepareFileForUpload = async (file: File, onProgress?: (fileName: string) => void): Promise<File | null> => {
    if (file.size > 0) {
      return file
    }

    // 파일 크기가 0이면 iCloud에서 아직 다운로드 안 됨
    // 파일을 읽으려고 시도하면 macOS가 자동으로 다운로드 시작
    try {
      onProgress?.(file.name)
      // 전체 파일을 읽어서 iCloud 다운로드 트리거 (타임아웃 5분)
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5 * 60 * 1000)
      )
      const readPromise = file.arrayBuffer().then(() => file)
      const result = await Promise.race([readPromise, timeoutPromise])
      return result
    } catch (error) {
      console.error('[drive] iCloud file prepare failed:', error)
      return null
    }
  }

  const uploadFolderStructure = async (
    filesWithPath: FileWithFolderPath[],
    rawFolderPaths: string[],
    skippedFiles: string[] = []
  ) => {
    const userId = user?.id
    if (!userId) {
      showToast('로그인 정보를 확인한 뒤 다시 시도해주세요.', 'error')
      return
    }

    const parentColumns = getFolderParentColumns()

    const normalizedRawPaths = rawFolderPaths
      .map(normalizePath)
      .filter(path => path.length > 0)

    const filteredPaths = normalizedRawPaths.filter(path => {
      const parts = path.split('/')
      return !parts.some(part => isBlockedFolderName(part))
    })

    const blockedPathCount = normalizedRawPaths.length - filteredPaths.length
    if (blockedPathCount > 0) {
      showToast(`개발 관련 폴더 ${blockedPathCount}개가 제외되었습니다.`, 'info')
    }

    const filteredFilesWithPath = filesWithPath.filter(({ folderPath }) => {
      const normalized = normalizePath(folderPath)
      if (!normalized) return false
      const parts = normalized.split('/')
      return !parts.some(part => isBlockedFolderName(part))
    })

    const blockedFileCount = filesWithPath.length - filteredFilesWithPath.length
    if (blockedFileCount > 0) {
      showToast(`차단된 폴더 내 파일 ${blockedFileCount}개가 제외되었습니다.`, 'info')
    }

    // 폴더 경로를 정렬 (상위 폴더가 먼저 생성되도록)
    const sortedPaths = [...new Set(filteredPaths)].sort((a, b) => a.split('/').length - b.split('/').length)

    // 폴더 경로 -> ID 매핑
    const folderIdMap: Record<string, string> = {}

    const findExistingFolderId = async (folderName: string, parentId: string | null): Promise<string | null> => {
      let lastError: unknown = null

      for (const parentColumn of parentColumns) {
        for (const useDeletedAtFilter of [true, false]) {
          let query = supabase
            .from('folders')
            .select('id')
            .eq('user_id', userId)
            .eq('name', folderName)
            .limit(1)

          if (useDeletedAtFilter) {
            query = query.is('deleted_at', null)
          }

          if (parentId) {
            query = query.eq(parentColumn, parentId)
          } else {
            query = query.is(parentColumn, null)
          }

          const { data, error } = await query
          if (!error) {
            folderParentColumnRef.current = parentColumn
            return data?.[0]?.id || null
          }

          lastError = error
          const missingParentColumn = isMissingColumnError(error, parentColumn)
          const missingDeletedAt = useDeletedAtFilter && isMissingColumnError(error, 'deleted_at')

          if (missingDeletedAt) {
            continue
          }
          if (!missingParentColumn) {
            break
          }
        }
      }

      if (lastError) {
        console.error('[Upload Folder] Existing folder lookup error:', {
          folderName,
          parentId,
          detail: formatSupabaseError(lastError),
        })
      }
      return null
    }

    const createFolder = async (
      folderName: string,
      parentId: string | null
    ): Promise<{ id: string | null; error: unknown }> => {
      let lastError: unknown = null

      for (const parentColumn of parentColumns) {
        const payload: Record<string, unknown> = {
          name: folderName,
          user_id: userId,
          [parentColumn]: parentId,
        }

        const { data, error } = await supabase
          .from('folders')
          .insert(payload)
          .select('id')
          .single()

        if (!error) {
          folderParentColumnRef.current = parentColumn
          return { id: data?.id || null, error: null }
        }

        lastError = error
        if (!isMissingColumnError(error, parentColumn)) {
          break
        }
      }

      return { id: null, error: lastError }
    }

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

      // 이미 있는 폴더면 재사용
      const existingFolderId = await findExistingFolderId(folderName, parentId)
      if (existingFolderId) {
        folderIdMap[folderPath] = existingFolderId
        continue
      }

      const { id: createdFolderId, error: createError } = await createFolder(folderName, parentId)

      if (createError) {
        console.error('[Upload Folder] Folder create error:', {
          folderPath,
          folderName,
          parentId,
          detail: formatSupabaseError(createError),
        })
      }

      const resolvedFolderId = createdFolderId || await findExistingFolderId(folderName, parentId)
      if (!resolvedFolderId) {
        throw new Error(`폴더 생성 실패: ${folderPath} (${formatSupabaseError(createError) || '원인 미상'})`)
      }

      folderIdMap[folderPath] = resolvedFolderId
    }

    // iCloud 등에서 다운로드되지 않은 파일 경고
    if (skippedFiles.length > 0) {
      showToast(`${skippedFiles.length}개 파일을 업로드할 수 없습니다. iCloud에서 다운로드 후 다시 시도해주세요.`, 'error')
    }

    // 파일이 없고 폴더만 있는 경우
    if (filteredFilesWithPath.length === 0) {
      dataCache.invalidateFolders()
      await fetchData(currentFolderId, searchParams.get('category') || 'all')
      return
    }

    const uploadId = Date.now().toString()
    const currentFolderName = currentFolderId
      ? folders.find(f => f.id === currentFolderId)?.name || '내 드라이브'
      : '내 드라이브'

    const newItems = filteredFilesWithPath.map((f, i) => ({
      id: `${uploadId}-${i}`,
      name: f.file.name,
      status: 'pending' as const,
      fileType: f.file.name.split('.').pop()?.toUpperCase() || '',
      fileSize: f.file.size,
      folderName: f.folderPath || currentFolderName,
    }))
    addToQueue(newItems)
    setShowUploadPanel(true)

    // 병렬 업로드 (파일 수/평균 크기/기기 코어 수 기반 자동 조절)
    const CONCURRENT_UPLOADS = getUploadConcurrency(filteredFilesWithPath.map(item => item.file))
    const uploadResults: { url: string, thumbnailUrl: string | null, name: string, folderId: string | null, index: number, fileType?: string, fileSize?: number, isVideo?: boolean }[] = []

    const uploadFile = async (index: number) => {
      const { file, folderPath } = filteredFilesWithPath[index]
      const itemId = `${uploadId}-${index}`
      const normalizedFolderPath = normalizePath(folderPath)
      let targetFolderId: string | null = currentFolderId
      if (normalizedFolderPath && folderIdMap[normalizedFolderPath]) {
        targetFolderId = folderIdMap[normalizedFolderPath]
      }

      updateQueueItem(itemId, { status: 'uploading', progress: 0, startedAt: Date.now() })
      uploadProgressSnapshotRef.current.set(itemId, { percent: 0, loaded: 0, ts: Date.now() })

      const timestamp = Date.now()
      const uniqueFileName = `${timestamp}_${index}_${file.name}`

      try {
        // 1. 원본 업로드 (Presigned URL로 R2 직접 업로드)
        const { url } = await uploadWithPresignedUrl(file, uniqueFileName, (percent, loaded) => {
          // 원본 업로드는 90%까지, 썸네일은 10%
          updateQueueProgressThrottled(itemId, percent * 0.9, loaded)
        })

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
        } else if (isHeicFile(file)) {
          const thumbFileName = `thumb_${timestamp}_${index}_${file.name.replace(/\.[^.]+$/, '.jpg')}`
          thumbnailUrl = await generateHeicThumbnailServerSide(uniqueFileName, thumbFileName)
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

        if (shouldDisplayUploadedInCurrentView(targetFolderId, isVideo, file.type)) {
          enqueueOptimisticPhoto({
            id: `temp-${Date.now()}-${index}`,
            url,
            thumbnail_url: thumbnailUrl,
            name: file.name,
            order: 0,
            folder_id: targetFolderId,
            created_at: new Date().toISOString(),
            file_type: truncateFileType(file.type),
            file_size: file.size,
            is_video: isVideo,
          })
        }

        uploadProgressSnapshotRef.current.delete(itemId)
        updateQueueItem(itemId, { status: 'done', progress: 100, url, uploadedSize: file.size })
        enqueueStorageDelta(file.size)
      } catch (error) {
        console.error('[upload] uploadFile failed:', error)
        uploadProgressSnapshotRef.current.delete(itemId)
        updateQueueItem(itemId, { status: 'error' })
      }
    }

    await runWithConcurrency(filteredFilesWithPath.length, CONCURRENT_UPLOADS, uploadFile)

    // DB 배치 인서트 (folder upload)
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

        const sortedItems = [...items].sort((a, b) => a.index - b.index)
        const insertData = sortedItems.map((item, idx) => ({
          url: item.url,
          thumbnail_url: item.thumbnailUrl,
          name: item.name,
          order: baseOrder + idx + 1,
          folder_id: folderId,
          user_id: user?.id,
          file_type: truncateFileType(item.fileType),
          file_size: item.fileSize,
          is_video: item.isVideo,
          hls_status: item.isVideo ? 'pending' : 'not_applicable',
        }))

        const { error: insertError } = await supabase.from('photos').insert(insertData)
        if (insertError) {
          console.error('[Upload Folder] DB insert error:', insertError)
        }
      }
    }

    dataCache.invalidateFolders()
    dataCache.invalidatePhotos()
    await fetchData(currentFolderId, searchParams.get('category') || 'all')
    await fetchStorageUsage(true)
  }

  const handleFolderFileList = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const fileArray = Array.from(files)
    const filesWithPath: FileWithFolderPath[] = []
    const folderPathSet = new Set<string>()
    const skippedFiles: string[] = []
    const blockedFiles: string[] = []

    const hasICloudFiles = fileArray.some(f => f.size === 0)
    if (hasICloudFiles) {
      setICloudDownloading(true)
      setICloudProgress({ current: 0, total: fileArray.length, fileName: '' })
    }

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]
      if (hasICloudFiles) {
        setICloudProgress({ current: i + 1, total: fileArray.length, fileName: file.name })
      }

      const relativePath = normalizePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
      const pathParts = relativePath.split('/').filter(Boolean)

      // 폴더 경로가 없는 일반 파일 선택은 제외
      if (pathParts.length < 2) {
        continue
      }

      const folderParts = pathParts.slice(0, -1)
      if (folderParts.some(part => isBlockedFolderName(part))) {
        blockedFiles.push(relativePath)
        continue
      }

      for (let depth = 1; depth <= folderParts.length; depth++) {
        folderPathSet.add(folderParts.slice(0, depth).join('/'))
      }

      const preparedFile = file.size > 0
        ? file
        : await prepareFileForUpload(file, (name) => {
            if (!hasICloudFiles) return
            setICloudProgress(prev => ({ ...prev, fileName: name }))
          })

      if (preparedFile) {
        filesWithPath.push({ file: preparedFile, folderPath: folderParts.join('/') })
      } else {
        skippedFiles.push(file.name)
      }
    }

    if (hasICloudFiles) {
      setICloudDownloading(false)
    }

    if (blockedFiles.length > 0) {
      showToast(`차단된 폴더 내 파일 ${blockedFiles.length}개가 제외되었습니다.`, 'info')
    }

    if (filesWithPath.length === 0) {
      showToast('업로드 가능한 폴더 파일을 찾지 못했습니다.', 'info')
      return
    }

    await uploadFolderStructure(filesWithPath, Array.from(folderPathSet), skippedFiles)
  }

  const openFolderPicker = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true

    const folderInput = input as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean }
    if (!('webkitdirectory' in folderInput)) {
      showToast('현재 브라우저는 폴더 업로드를 지원하지 않습니다.', 'error')
      return
    }
    folderInput.webkitdirectory = true
    folderInput.directory = true

    input.onchange = async () => {
      await handleFolderFileList(input.files)
      input.remove()
    }

    input.click()
  }

  // 파일 선택 시
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const fileArray = Array.from(files)

    // iCloud 파일이 있는지 확인 (크기가 0인 파일)
    const hasICloudFiles = fileArray.some(f => f.size === 0)

    if (hasICloudFiles) {
      setICloudDownloading(true)
      setICloudProgress({ current: 0, total: fileArray.length, fileName: '' })
    }

    const validFiles: File[] = []
    const skippedFiles: string[] = []

    // 각 파일 준비 (iCloud 다운로드 대기)
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]
      if (hasICloudFiles) {
        setICloudProgress({ current: i + 1, total: fileArray.length, fileName: file.name })
      }

      const preparedFile = file.size > 0
        ? file
        : await prepareFileForUpload(file, (name) => {
            if (!hasICloudFiles) return
            setICloudProgress(prev => ({ ...prev, fileName: name }))
          })

      if (preparedFile) {
        validFiles.push(preparedFile)
      } else {
        skippedFiles.push(file.name)
      }
    }

    if (hasICloudFiles) {
      setICloudDownloading(false)
    }

    // 건너뛴 파일 알림
    if (skippedFiles.length > 0) {
      showToast(`${skippedFiles.length}개 파일을 준비할 수 없습니다. (타임아웃 또는 접근 불가)`, 'error')
    }

    if (validFiles.length > 0) {
      // 현재 폴더가 있으면 바로 업로드 (폴더 피커 생략)
      if (currentFolderId) {
        await handleUploadToFolder(currentFolderId, validFiles)
      } else {
        setPendingFiles(validFiles)
        setShowFolderPicker(true)
      }
    }
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
    // relatedTarget이 null이면 창 밖으로 나간 것 - 이때만 드래그 해제
    if (!e.relatedTarget) {
      setIsDragging(false)
      dragCounter.current = 0
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
    const filesWithPath: FileWithFolderPath[] = []
    const folderPathSet = new Set<string>()
    let hasDroppedFolders = false

    const addFolderPathChain = (folderPath: string) => {
      const normalized = normalizePath(folderPath)
      if (!normalized) return
      const parts = normalized.split('/').filter(Boolean)
      for (let depth = 1; depth <= parts.length; depth++) {
        folderPathSet.add(parts.slice(0, depth).join('/'))
      }
    }

    // iCloud 파일 준비 함수 (다운로드 대기)
    const prepareFile = async (file: File): Promise<File | null> => {
      if (file.size > 0) {
        return file
      }

      try {
        // 전체 파일을 읽어서 iCloud 다운로드 트리거 (타임아웃 5분)
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5 * 60 * 1000)
        )
        const readPromise = file.arrayBuffer().then(() => file)
        return await Promise.race([readPromise, timeoutPromise])
      } catch (error) {
        console.error('[drive] iCloud prepareFile failed:', error)
        return null
      }
    }

    // 폴더와 파일 처리
    const skippedFiles: string[] = []
    const processEntry = async (entry: FileSystemEntry, path: string = ''): Promise<void> => {
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry
        return new Promise((resolve) => {
          fileEntry.file(
            async (file) => {
              // iCloud 파일 준비 (다운로드 대기)
              const preparedFile = await prepareFile(file)
              if (preparedFile) {
                let folderPath = normalizePath(path)
                if (!folderPath) {
                  const entryFullPath = normalizePath((entry as FileSystemEntry & { fullPath?: string }).fullPath || '')
                  const relativePath = normalizePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || '')
                  const candidatePath = entryFullPath || relativePath
                  if (candidatePath) {
                    const parts = candidatePath.split('/').filter(Boolean)
                    if (parts.length > 1) {
                      folderPath = parts.slice(0, -1).join('/')
                      hasDroppedFolders = true
                      addFolderPathChain(folderPath)
                    }
                  }
                }
                filesWithPath.push({ file: preparedFile, folderPath })
              } else {
                skippedFiles.push(file.name)
              }
              resolve()
            },
            (error) => {
              // iCloud 파일 접근 에러 처리
              console.warn(`파일 접근 실패: ${entry.name}`, error)
              skippedFiles.push(entry.name)
              resolve()
            }
          )
        })
      } else if (entry.isDirectory) {
        hasDroppedFolders = true
        const dirEntry = entry as FileSystemDirectoryEntry
        const fullPath = path ? `${path}/${entry.name}` : entry.name
        addFolderPathChain(fullPath)
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
      const entry = (items[i] as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.()
      if (entry) {
        entries.push(entry)
      }
    }

    if (entries.length > 0) {
      // 모든 엔트리 처리
      for (const entry of entries) {
        await processEntry(entry)
      }
    } else {
      // 브라우저가 webkitGetAsEntry를 제공하지 않는 경우 폴백
      const droppedFiles = Array.from(e.dataTransfer.files || [])
      for (const file of droppedFiles) {
        const preparedFile = await prepareFile(file)
        if (!preparedFile) {
          skippedFiles.push(file.name)
          continue
        }

        const relativePath = normalizePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || '')
        let folderPath = ''
        if (relativePath) {
          const parts = relativePath.split('/').filter(Boolean)
          if (parts.length > 1) {
            folderPath = parts.slice(0, -1).join('/')
            hasDroppedFolders = true
            addFolderPathChain(folderPath)
          }
        }

        filesWithPath.push({ file: preparedFile, folderPath })
      }
    }

    // 폴더가 드롭된 경우: 폴더 구조 생성 후 파일 자동 업로드
    if (hasDroppedFolders && folderPathSet.size > 0) {
      await uploadFolderStructure(filesWithPath, Array.from(folderPathSet), skippedFiles)
    } else if (filesWithPath.length > 0) {
      // 폴더 없이 파일만 드롭한 경우: 현재 디렉토리에 바로 업로드
      const files = filesWithPath.map(f => f.file)

      // 중복 체크 후 업로드
      const { duplicates, nonDuplicates } = await checkDuplicates(files, currentFolderId)
      if (duplicates.length > 0) {
        setPendingFiles(files)
        setPendingUploadFolderId(currentFolderId)
        setDuplicateFiles(duplicates)
        setNonDuplicateFiles(nonDuplicates)
        setShowDuplicateModal(true)
      } else {
        await executeUpload(files, currentFolderId)
      }
    }
  }

  // 중복 파일 체크
  const checkDuplicates = async (files: File[], targetFolderId: string | null): Promise<{ duplicates: DuplicateFile[], nonDuplicates: File[] }> => {
    if (!user?.id || files.length === 0) {
      return { duplicates: [], nonDuplicates: files }
    }

    // 대상 폴더의 기존 파일 목록 가져오기 (필요 최소 컬럼만 조회)
    const baseQuery = supabase
      .from('photos')
      .select('id,name,url,thumbnail_url')
      .eq('user_id', user.id)

    let query = baseQuery.is('deleted_at', null)
    if (targetFolderId) {
      query = query.eq('folder_id', targetFolderId)
    } else {
      query = query.is('folder_id', null)
    }

    let { data: existingPhotos, error } = await query

    if (error && isMissingColumnError(error, 'deleted_at')) {
      query = baseQuery
      if (targetFolderId) {
        query = query.eq('folder_id', targetFolderId)
      } else {
        query = query.is('folder_id', null)
      }
      const fallback = await query
      existingPhotos = fallback.data
      error = fallback.error
    }

    if (error) {
      console.error('[Upload] Duplicate check error:', formatSupabaseError(error))
      return { duplicates: [], nonDuplicates: files }
    }

    const existingByName = new Map<string, ExistingDuplicatePhoto>()
    for (const photo of (existingPhotos || []) as ExistingDuplicatePhoto[]) {
      const derivedName = photo.name || photo.url.split('/').pop()?.replace(/^\d+_\d+_/, '') || ''
      if (!derivedName) continue
      if (!existingByName.has(derivedName)) {
        existingByName.set(derivedName, photo)
      }
    }

    const duplicates: DuplicateFile[] = []
    const nonDuplicates: File[] = []

    for (const file of files) {
      const existingPhoto = existingByName.get(file.name)
      if (existingPhoto) {
        duplicates.push({ file, existingPhoto })
      } else {
        nonDuplicates.push(file)
      }
    }

    return { duplicates, nonDuplicates }
  }

  // 폴더 선택 후 업로드
  const handleUploadToFolder = async (targetFolderId: string | null, files?: File[]) => {
    const filesToProcess = files || pendingFiles
    if (filesToProcess.length === 0) return

    setShowFolderPicker(false)

    // 중복 파일 체크
    const { duplicates, nonDuplicates } = await checkDuplicates(filesToProcess, targetFolderId)

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
    await executeUpload(filesToProcess, targetFolderId)
  }

  // 중복 처리 후 실제 업로드 실행
  const executeUpload = async (
    filesToUpload: File[],
    targetFolderId: string | null,
    photosToDelete?: ExistingDuplicatePhoto[]
  ) => {
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
    // 폴더명 가져오기
    const targetFolderName = targetFolderId
      ? folders.find(f => f.id === targetFolderId)?.name || '내 드라이브'
      : '내 드라이브'
    const newItems = fileList.map((f, i) => ({
      id: `${uploadId}-${i}`,
      name: f.name,
      status: 'pending' as const,
      fileType: f.name.split('.').pop()?.toUpperCase() || '',
      fileSize: f.size,
      folderName: targetFolderName,
    }))
    addToQueue(newItems)
    setShowUploadPanel(true)

    // 병렬 업로드 (파일 수/평균 크기/기기 코어 수 기반 자동 조절)
    const CONCURRENT_UPLOADS = getUploadConcurrency(fileList)
    const uploadResults: { url: string, thumbnailUrl: string | null, name: string, index: number, fileType?: string, fileSize?: number, isVideo?: boolean }[] = []

    const uploadFile = async (index: number) => {
      const file = fileList[index]
      const itemId = `${uploadId}-${index}`

      updateQueueItem(itemId, { status: 'uploading', progress: 0, startedAt: Date.now() })
      uploadProgressSnapshotRef.current.set(itemId, { percent: 0, loaded: 0, ts: Date.now() })

      const timestamp = Date.now()
      const uniqueFileName = `${timestamp}_${index}_${file.name}`

      try {
        // 1. 원본 업로드 (Presigned URL로 R2 직접 업로드)
        const { url } = await uploadWithPresignedUrl(file, uniqueFileName, (percent, loaded) => {
          // 원본 업로드는 90%까지, 썸네일은 10%
          updateQueueProgressThrottled(itemId, percent * 0.9, loaded)
        })

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
        } else if (isHeicFile(file)) {
          // 클라이언트 측 HEIC 변환 실패 시 서버 측 생성 시도
          const thumbFileName = `thumb_${timestamp}_${index}_${file.name.replace(/\.[^.]+$/, '.jpg')}`
          thumbnailUrl = await generateHeicThumbnailServerSide(uniqueFileName, thumbFileName)
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

        if (shouldDisplayUploadedInCurrentView(targetFolderId, isVideo, file.type)) {
          enqueueOptimisticPhoto({
            id: `temp-${Date.now()}-${index}`,
            url,
            thumbnail_url: thumbnailUrl,
            name: file.name,
            order: 0,
            folder_id: targetFolderId,
            created_at: new Date().toISOString(),
            file_type: truncateFileType(file.type),
            file_size: file.size,
            is_video: isVideo,
          })
        }

        uploadProgressSnapshotRef.current.delete(itemId)
        updateQueueItem(itemId, { status: 'done', progress: 100, url, uploadedSize: file.size })
        enqueueStorageDelta(file.size)
      } catch (error) {
        console.error('[upload] uploadFile failed:', error)
        uploadProgressSnapshotRef.current.delete(itemId)
        updateQueueItem(itemId, { status: 'error' })
      }
    }

    await runWithConcurrency(fileList.length, CONCURRENT_UPLOADS, uploadFile)

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
        file_type: truncateFileType(item.fileType),
        file_size: item.fileSize,
        is_video: item.isVideo,
        hls_status: item.isVideo ? 'pending' : 'not_applicable',
      }))

      const { error: insertError } = await supabase.from('photos').insert(insertData)
      if (insertError) {
        console.error('[Upload] DB insert error:', insertError)
      }
    }

    setPendingFiles([])
    setDuplicateFiles([])
    setNonDuplicateFiles([])
    dataCache.invalidatePhotos()
    await fetchData(currentFolderId, searchParams.get('category') || 'all')
    await fetchStorageUsage(true)
  }

  // 중복 파일 처리 선택
  const handleDuplicateAction = async (action: 'overwrite' | 'keep' | 'skip') => {
    setShowDuplicateModal(false)

    let filesToUpload: File[] = [...nonDuplicateFiles]
    let photosToDelete: ExistingDuplicatePhoto[] = []

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
    if (!confirm(`${totalItems}개 항목을 휴지통으로 이동할까요?`)) return

    setDeleting(true)
    setDeleteStatus('휴지통으로 이동 중...')

    try {
      // 휴지통 API 호출 (soft delete)
      const res = await fetch('/api/trash', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.id || '',
        },
        body: JSON.stringify({
          photoIds: Array.from(selectedIds),
          folderIds: Array.from(selectedFolderIds),
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to move to trash')
      }

      setSelectedIds(new Set())
      setSelectedFolderIds(new Set())
      dataCache.invalidateFolders()
      dataCache.invalidatePhotos()
      await fetchData(currentFolderId, searchParams.get('category') || 'all')
      await fetchStorageUsage(true)
    } catch (error) {
      console.error('Delete error:', error)
      showToast('삭제 중 오류가 발생했습니다.', 'error')
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

          let moved = false
          for (const parentColumn of getFolderParentColumns()) {
            const { error } = await supabase
              .from('folders')
              .update({ [parentColumn]: targetFolderId })
              .eq('id', folderId)
              .eq('user_id', user?.id)

            if (!error) {
              folderParentColumnRef.current = parentColumn
              moved = true
              break
            }
            if (!isMissingColumnError(error, parentColumn)) {
              throw error
            }
          }

          if (!moved) {
            throw new Error('폴더 이동 실패: parent column not resolved')
          }
        }
      }

      setShowMoveModal(false)
      setSelectedIds(new Set())
      setSelectedFolderIds(new Set())
      dataCache.invalidateFolders()
      dataCache.invalidatePhotos()
      await fetchData(currentFolderId, searchParams.get('category') || 'all')
      await fetchStorageUsage(true)
    } catch (error) {
      console.error('Move error:', error)
    } finally {
      setMoving(false)
    }
  }

  // 선택된 사진/폴더 다운로드
  const handleDownloadSelected = async () => {
    if (selectedIds.size === 0 && selectedFolderIds.size === 0) return

    const selectedPhotos = photos.filter(p => selectedIds.has(p.id))
    const selectedFolders = folders.filter(f => selectedFolderIds.has(f.id))

    // 단일 파일이고 폴더가 없으면 개별 다운로드
    if (selectedPhotos.length === 1 && selectedFolders.length === 0) {
      await startDownload(selectedPhotos.map(photo => ({
        id: photo.id,
        name: photo.name,
        url: photo.url,
      })))
    } else {
      // 여러 파일이거나 폴더가 포함된 경우 ZIP 다운로드
      const items: { id: string; name: string; url: string; type: 'photo' | 'folder'; folderId?: string | null }[] = [
        ...selectedPhotos.map(photo => ({
          id: photo.id,
          name: photo.name,
          url: photo.url,
          type: 'photo' as const,
          folderId: photo.folder_id,
        })),
        ...selectedFolders.map(folder => ({
          id: folder.id,
          name: folder.name,
          url: '',
          type: 'folder' as const,
        })),
      ]

      // 폴더 내용 가져오는 함수
      const fetchFolderContents = async (folderId: string) => {
        const { data: folderPhotos } = await supabase
          .from('photos')
          .select('id, name, url')
          .eq('folder_id', folderId)
          .eq('user_id', user?.id)
          .is('deleted_at', null)

        let subFolders: { id: string; name: string }[] = []
        for (const parentColumn of getFolderParentColumns()) {
          const { data, error } = await supabase
            .from('folders')
            .select('id, name')
            .eq(parentColumn, folderId)
            .eq('user_id', user?.id)
            .is('deleted_at', null)

          if (!error) {
            folderParentColumnRef.current = parentColumn
            subFolders = (data || []) as { id: string; name: string }[]
            break
          }

          if (!isMissingColumnError(error, parentColumn)) {
            console.error('[Download] Folder fetch error:', formatSupabaseError(error))
            break
          }
        }

        return [
          ...(folderPhotos || []).map(p => ({ id: p.id, name: p.name, url: p.url, type: 'photo' as const })),
          ...(subFolders || []).map(f => ({ id: f.id, name: f.name, url: '', type: 'folder' as const })),
        ]
      }

      await startZipDownload(
        items,
        allFolders.map(f => ({ id: f.id, name: f.name, parentId: f.parent_id })),
        fetchFolderContents
      )
    }

    // 선택 해제
    setSelectedIds(new Set())
    setSelectedFolderIds(new Set())
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !user?.id || isCreatingFolder) return

    setIsCreatingFolder(true)
    try {
      let created = false
      for (const parentColumn of getFolderParentColumns()) {
        const { error } = await supabase.from('folders').insert({
          name: newFolderName.trim(),
          [parentColumn]: currentFolderId,
          user_id: user.id
        })

        if (!error) {
          folderParentColumnRef.current = parentColumn
          created = true
          break
        }
        if (!isMissingColumnError(error, parentColumn)) {
          throw error
        }
      }

      if (!created) {
        throw new Error('폴더 생성 실패: parent column not resolved')
      }

      setNewFolderName('')
      setShowNewFolderInput(false)
      dataCache.invalidateFolders()
      await fetchData(currentFolderId, searchParams.get('category') || 'all')
    } catch (error) {
      console.error('[Create Folder] Error:', formatSupabaseError(error))
      showToast('폴더 생성에 실패했습니다.', 'error')
    } finally {
      setIsCreatingFolder(false)
    }
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
    if (target.closest('.image-item, .folder-item, .list-row, button, input, [data-checkbox], .modal-backdrop, .tds-modal-backdrop, .tds-dialog-backdrop')) return

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

  const handleDragSelectMove = useCallback((e: React.MouseEvent | MouseEvent) => {
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

    // 아이템들과 겹치는지 확인 (Shift 누르면 기존 선택 유지)
    const newSelectedIds = new Set<string>(shiftKeyRef.current ? selectedIds : [])
    const newSelectedFolderIds = new Set<string>(shiftKeyRef.current ? selectedFolderIds : [])

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
  }, [isDragSelecting, dragSelectStart])

  const handleDragSelectEnd = useCallback(() => {
    setIsDragSelecting(false)
    setDragSelectStart(null)
    setDragSelectCurrent(null)
    activeDragContainerRef.current = null
  }, [])

  // Document 레벨에서 mousemove/mouseup 감지 - 드래그 선택이 목록 밖에서도 유지되도록
  useEffect(() => {
    if (!isDragSelecting) return

    const handleMouseMove = (e: MouseEvent) => handleDragSelectMove(e)
    const handleMouseUp = () => handleDragSelectEnd()
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragSelecting, handleDragSelectMove, handleDragSelectEnd])

  // Shift 키 상태 추적
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftKeyRef.current = true
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftKeyRef.current = false
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

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

  // 터치 이동 여부 추적 (스크롤 vs 탭 구분용)
  const touchMovedRef = useRef(false)

  // 모바일: 꾹 누르면 선택 모드 진입, 드래그 선택은 제거
  const handleItemTouchStart = useCallback((e: React.TouchEvent, itemId: string, isFolder: boolean) => {
    const touch = e.touches[0]
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY }
    touchMovedRef.current = false

    // 선택 모드가 아닐 때만 길게 누르기 타이머 시작
    if (!isSelecting) {
      longPressTimerRef.current = setTimeout(() => {
        handleLongPress(itemId, isFolder)
        longPressTimerRef.current = null
      }, 500)
    }
  }, [isSelecting, handleLongPress])

  const handleItemTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]

    // 움직임 감지 - 스크롤로 간주
    if (touchStartPosRef.current) {
      const dx = touch.clientX - touchStartPosRef.current.x
      const dy = touch.clientY - touchStartPosRef.current.y
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        // 길게 누르기 취소
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current)
          longPressTimerRef.current = null
        }
        touchMovedRef.current = true
      }
    }
  }, [])

  const handleItemTouchEnd = useCallback(() => {
    // 길게 누르기 타이머 정리
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }

    touchStartPosRef.current = null

    // 터치 이동 플래그는 약간의 지연 후 리셋 (onClick보다 늦게)
    setTimeout(() => {
      touchMovedRef.current = false
    }, 100)
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

  // Pull to refresh 핸들러 (모바일)
  const handlePullStart = useCallback((e: React.TouchEvent) => {
    // 선택 모드, 검색 모드, 업로드 패널, 더보기 화면에서는 비활성화
    if (isSelecting || searchQuery || showUploadPanel || showMoreScreen) return
    // 스크롤이 맨 위가 아니면 비활성화
    if (window.scrollY > 0) return

    pullStartY.current = e.touches[0].clientY
    isPulling.current = true
  }, [isSelecting, searchQuery, showUploadPanel, showMoreScreen])

  const handlePullMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current || pullStartY.current === null || isRefreshing) return
    if (window.scrollY > 0) {
      isPulling.current = false
      setPullDistance(0)
      return
    }

    const currentY = e.touches[0].clientY
    const diff = currentY - pullStartY.current

    if (diff > 0) {
      // 저항감 있는 당기기 효과 (점점 느려짐)
      const resistance = 0.4
      const newDistance = Math.min(diff * resistance, PULL_THRESHOLD * 1.5)
      setPullDistance(newDistance)
    }
  }, [isRefreshing, PULL_THRESHOLD])

  const handlePullEnd = useCallback(async () => {
    if (!isPulling.current) return
    isPulling.current = false
    pullStartY.current = null

    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true)
      setPullDistance(PULL_THRESHOLD) // 새로고침 중에는 고정

      try {
        // 캐시 무효화 후 새로 로드
        dataCache.invalidateAll()
        const category = searchParams.get('category') || 'all'
        await fetchData(currentFolderId, category)
      } finally {
        setIsRefreshing(false)
        setPullDistance(0)
      }
    } else {
      setPullDistance(0)
    }
  }, [pullDistance, isRefreshing, PULL_THRESHOLD, dataCache, searchParams, fetchData, currentFolderId])

  // 선택 모드에서 아이템 탭으로 선택 토글
  const handleItemTap = useCallback((e: React.MouseEvent | React.TouchEvent, itemId: string, isFolder: boolean, index?: number) => {
    // 터치 드래그 중이거나 스크롤 중이면 무시
    if (isTouchDragging || touchMovedRef.current) return

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

    if (!confirm('폴더와 모든 내용을 휴지통으로 이동할까요?')) return

    setDeleting(true)
    setDeleteStatus('휴지통으로 이동 중...')

    try {
      // 휴지통 API 호출 (soft delete)
      const res = await fetch('/api/trash', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.id || '',
        },
        body: JSON.stringify({
          folderIds: [folderId],
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to move to trash')
      }

      dataCache.invalidateFolders()
      dataCache.invalidatePhotos()
      await fetchData(currentFolderId, searchParams.get('category') || 'all')
    } catch (error) {
      console.error('Delete error:', error)
      showToast('삭제 중 오류가 발생했습니다.', 'error')
    } finally {
      setDeleting(false)
      setDeleteStatus('')
    }
  }

  const toggleSelect = (id: string, e: React.MouseEvent, index: number, forcePreserve = false) => {
    e.stopPropagation()

    // Cmd/Ctrl 없이 클릭하면 기존 선택 해제 후 새로 선택 (단, 이미 선택 모드 또는 forcePreserve면 추가 선택)
    const isMultiSelectKey = e.shiftKey || e.metaKey || e.ctrlKey
    const shouldPreserve = isMultiSelectKey || isSelecting || forcePreserve

    const newSet = shouldPreserve ? new Set(selectedIds) : new Set<string>()

    // Shift+클릭: 범위 선택
    if (e.shiftKey && lastSelectedIndex?.type === 'photo') {
      const start = Math.min(lastSelectedIndex.index, index)
      const end = Math.max(lastSelectedIndex.index, index)
      for (let i = start; i <= end; i++) {
        if (sortedPhotos[i]) {
          newSet.add(sortedPhotos[i].id)
        }
      }
    } else if (newSet.has(id) && shouldPreserve) {
      // 이미 선택된 항목 클릭 시 선택 해제
      newSet.delete(id)
    } else {
      newSet.add(id)
    }

    setSelectedIds(newSet)
    setLastSelectedIndex({ type: 'photo', index })
  }

  const toggleFolderSelect = (id: string, e: React.MouseEvent, index?: number, forcePreserve = false) => {
    e.stopPropagation()
    const currentIndex = index ?? sortedFolders.findIndex(f => f.id === id)

    // Cmd/Ctrl 없이 클릭하면 기존 선택 해제 후 새로 선택 (단, 이미 선택 모드 또는 forcePreserve면 추가 선택)
    const isMultiSelectKey = e.shiftKey || e.metaKey || e.ctrlKey
    const shouldPreserve = isMultiSelectKey || isSelecting || forcePreserve

    const newSet = shouldPreserve ? new Set(selectedFolderIds) : new Set<string>()

    // Shift+클릭: 범위 선택
    if (e.shiftKey && lastSelectedIndex?.type === 'folder') {
      const start = Math.min(lastSelectedIndex.index, currentIndex)
      const end = Math.max(lastSelectedIndex.index, currentIndex)
      for (let i = start; i <= end; i++) {
        if (sortedFolders[i]) {
          newSet.add(sortedFolders[i].id)
        }
      }
    } else if (newSet.has(id) && shouldPreserve) {
      // 이미 선택된 항목 클릭 시 선택 해제
      newSet.delete(id)
    } else {
      newSet.add(id)
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

  // 사진/동영상은 그리드, 문서는 목록뷰 강제
  const effectiveViewMode = (currentCategory === 'photos' || currentCategory === 'videos') ? 'grid' : (currentCategory === 'documents') ? 'list' : viewMode

  // 한국어 정렬을 위한 Collator (재사용하여 성능 최적화)
  const koreanCollator = useMemo(() => new Intl.Collator('ko', { sensitivity: 'base' }), [])

  const filteredPhotos = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()

    // 검색어가 있으면 전체 파일에서 검색
    const sourcePhotos = query ? allPhotosForSearch : photos

    const result = sourcePhotos.filter(photo => {
      // 검색 필터
      if (query && !photo.name?.toLowerCase().includes(query)) {
        return false
      }

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
  }, [photos, allPhotosForSearch, currentCategory, searchQuery])

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
        const cmp = koreanCollator.compare(nameA, nameB)
        return sortOrder === 'asc' ? cmp : -cmp
      } else {
        const dateA = new Date(a.created_at).getTime()
        const dateB = new Date(b.created_at).getTime()
        return sortOrder === 'asc' ? dateA - dateB : dateB - dateA
      }
    })
  }, [filteredPhotos, sortBy, sortOrder, currentCategory, koreanCollator])

  // 정렬된 폴더 목록
  const sortedFolders = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    // 검색어가 있으면 전체 폴더에서 검색, 없으면 현재 폴더만
    const sourceFolders = query ? allFolders : folders
    return [...sourceFolders]
      .filter(folder => !query || folder.name.toLowerCase().includes(query))
      .sort((a, b) => {
        if (sortBy === 'name') {
          const cmp = koreanCollator.compare(a.name, b.name)
          return sortOrder === 'asc' ? cmp : -cmp
        } else {
          const dateA = new Date(a.created_at).getTime()
          const dateB = new Date(b.created_at).getTime()
          return sortOrder === 'asc' ? dateA - dateB : dateB - dateA
        }
      })
  }, [folders, allFolders, sortBy, sortOrder, searchQuery, koreanCollator])

  // refs 업데이트 (범위 선택용)
  useEffect(() => {
    sortedFoldersRef.current = sortedFolders
    sortedPhotosRef.current = sortedPhotos
  }, [sortedFolders, sortedPhotos])

  // 폴더 ID → 폴더 객체 Map (O(1) 조회용)
  const folderMap = useMemo(() => {
    const map = new Map<string, Folder>()
    allFolders.forEach(f => map.set(f.id, f))
    return map
  }, [allFolders])

  // 폴더 경로 캐시 (재귀 호출 최적화)
  const folderPathCache = useMemo(() => {
    const cache = new Map<string, string>()

    const getPath = (folderId: string | null): string => {
      if (!folderId) return '내 드라이브'

      const cached = cache.get(folderId)
      if (cached) return cached

      const folder = folderMap.get(folderId)
      if (!folder) return '내 드라이브'

      const path = !folder.parent_id
        ? folder.name
        : `${getPath(folder.parent_id)} / ${folder.name}`

      cache.set(folderId, path)
      return path
    }

    // 모든 폴더 경로 미리 계산
    allFolders.forEach(f => getPath(f.id))
    return cache
  }, [allFolders, folderMap])

  // 검색 결과에서 파일의 폴더 경로 가져오기 (캐시 사용)
  const getFolderPath = useCallback((folderId: string | null): string => {
    if (!folderId) return '내 드라이브'
    return folderPathCache.get(folderId) || '내 드라이브'
  }, [folderPathCache])

  // 검색 모드 여부
  const isSearchMode = searchQuery.trim().length > 0

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

  // 검색 단축키 (Ctrl+K 또는 Cmd+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsSearchFocused(true)
        setTimeout(() => searchInputRef.current?.focus(), 50)
      }
      // ESC로 검색 닫기
      if (e.key === 'Escape' && isSearchFocused) {
        setSearchQuery('')
        setIsSearchFocused(false)
        searchInputRef.current?.blur()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isSearchFocused])

  // 검색어 입력 시 전체 파일 로드 (디바운스 적용)
  useEffect(() => {
    if (!searchQuery.trim() || !user?.id) {
      setAllPhotosForSearch([])
      return
    }

    // 300ms 디바운스로 타이핑 중 과도한 API 호출 방지
    const debounceTimer = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const allPhotos = await dataCache.getAllPhotos(user.id)
        setAllPhotosForSearch(allPhotos)
      } catch (e) {
        console.error('Failed to load all photos for search:', e)
      } finally {
        setSearchLoading(false)
      }
    }, 300)

    return () => clearTimeout(debounceTimer)
  }, [searchQuery, user?.id, dataCache])

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
              showToast('링크가 복사되었습니다', 'success')
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
              showToast('링크가 복사되었습니다', 'success')
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
                  showToast('공유 링크가 복사되었습니다', 'success')
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
                  showToast('파일이 복사되었습니다', 'success')
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
              if (!confirm('이 파일을 휴지통으로 이동하시겠습니까?')) return
              try {
                const res = await fetch('/api/trash', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': user?.id || '',
                  },
                  body: JSON.stringify({ photoIds: [photo.id] }),
                })
                if (res.ok) {
                  setPhotos(prev => prev.filter(p => p.id !== photo.id))
                  dataCache.invalidatePhotos()
                  await fetchStorageUsage(true)
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
      className="h-screen select-none flex flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onTouchStart={handlePullStart}
      onTouchMove={handlePullMove}
      onTouchEnd={handlePullEnd}
    >
      {/* Pull to Refresh 인디케이터 (모바일) */}
      {(pullDistance > 0 || isRefreshing) && (
        <div
          className="fixed left-0 right-0 z-[250] flex items-center justify-center xl:hidden transition-transform duration-200"
          style={{
            top: 'env(safe-area-inset-top, 0px)',
            transform: `translateY(${Math.min(pullDistance, PULL_THRESHOLD)}px)`,
            opacity: Math.min(pullDistance / PULL_THRESHOLD, 1),
          }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg"
            style={{ background: 'var(--background-elevated)' }}
          >
            {isRefreshing ? (
              <div
                className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }}
              />
            ) : (
              <svg
                className="w-5 h-5 transition-transform duration-200"
                style={{
                  color: 'var(--accent-primary)',
                  transform: pullDistance >= PULL_THRESHOLD ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            )}
          </div>
        </div>
      )}

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

      {/* iCloud 다운로드 진행률 오버레이 */}
      {iCloudDownloading && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in" style={{ background: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="p-8 rounded-2xl glass animate-fade-in-scale max-w-sm w-full mx-4">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #5AC8FA 0%, #007AFF 100%)' }}>
                <svg className="w-8 h-8 text-white animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
              </div>
              <p className="text-lg font-semibold mb-2">iCloud에서 다운로드 중...</p>
              <p className="text-sm mb-4" style={{ color: 'var(--foreground-secondary)' }}>
                {iCloudProgress.current}/{iCloudProgress.total} 파일 준비 중
              </p>
              {iCloudProgress.fileName && (
                <p className="text-xs truncate px-4" style={{ color: 'var(--foreground-muted)' }}>
                  {iCloudProgress.fileName}
                </p>
              )}
              <div className="mt-4 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--background-secondary)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${iCloudProgress.total > 0 ? (iCloudProgress.current / iCloudProgress.total) * 100 : 0}%`,
                    background: 'linear-gradient(90deg, #5AC8FA 0%, #007AFF 100%)'
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 메인 컨텐츠 (사이드바 여백 + 모바일 하단 탭 여백 + safe area) */}
      {/* 모바일에서 업로드/더보기 탭 활성화시 숨김 */}
      <div
        className={`xl:pl-64 xl:pb-0 flex-1 flex flex-col overflow-hidden ${(showUploadPanel || showMoreScreen) ? 'hidden xl:block' : ''}`}
        style={{ paddingBottom: currentCategory !== 'all' ? 'env(safe-area-inset-bottom, 0px)' : 'calc(80px + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* 헤더 */}
        <header className="header safe-area-top">
          <div className="header-content">
            {/* 왼쪽: 뒤로가기/메뉴 버튼 + 타이틀 */}
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              {/* 모바일 뒤로가기 버튼 (폴더 안에 있을 때 또는 카테고리 필터링 시) */}
              {(breadcrumbs.length > 0 || currentCategory !== 'all') && (
                <button
                  onClick={() => {
                    if (currentCategory !== 'all') {
                      // 카테고리에서 홈으로
                      router.push('/drive')
                    } else {
                      // 폴더에서 상위로
                      const parentId = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : null
                      router.push(parentId ? `/drive?folder=${parentId}` : '/drive')
                    }
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

            {/* 모바일 오른쪽: 검색 + 보기 옵션 */}
            <div className="flex xl:hidden items-center gap-1">
              {/* 검색 버튼 */}
              <button
                onClick={() => {
                  setIsSearchFocused(true)
                  setTimeout(() => searchInputRef.current?.focus(), 100)
                }}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--foreground-secondary)' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>

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

            {/* 검색창 - 데스크톱 */}
            <div className="hidden xl:flex flex-1 max-w-md mx-4">
              <div className="relative w-full">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                  style={{ color: 'var(--foreground-muted)' }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="파일 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setIsSearchFocused(false)}
                  className="w-full h-9 pl-9 pr-8 rounded-lg transition-all outline-none"
                  style={{
                    fontSize: 16,
                    background: isSearchFocused ? 'var(--background)' : 'var(--background-secondary)',
                    border: isSearchFocused ? '1px solid var(--accent-primary)' : '1px solid transparent',
                    color: 'var(--foreground)',
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ color: 'var(--foreground-muted)' }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
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

        {/* 모바일 검색바 */}
        {isSearchFocused && (
          <div className="xl:hidden px-4 py-3 border-b" style={{ background: 'var(--background)', borderColor: 'var(--border-default)' }}>
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                style={{ color: 'var(--foreground-muted)' }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="파일 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={() => {
                  if (!searchQuery) setIsSearchFocused(false)
                }}
                autoFocus
                className="w-full h-10 pl-10 pr-10 rounded-lg outline-none"
                style={{
                  fontSize: 16,
                  background: 'var(--background-secondary)',
                  border: '1px solid var(--accent-primary)',
                  color: 'var(--foreground)',
                }}
              />
              <button
                onClick={() => {
                  setSearchQuery('')
                  setIsSearchFocused(false)
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full"
                style={{ color: 'var(--foreground-muted)' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

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
            {(selectedIds.size > 0 || selectedFolderIds.size > 0) && (
              <button
                onClick={handleDownloadSelected}
                className="selection-toolbar-btn success"
                title={selectedIds.size + selectedFolderIds.size > 1 || selectedFolderIds.size > 0 ? 'ZIP으로 다운로드' : '다운로드'}
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

      {/* 리스트뷰 테이블 헤더 - 스크롤 영역 바깥에 고정 */}
      {!userLoading && effectiveViewMode === 'list' && (
        <div className="hidden sm:grid grid-cols-[auto_minmax(200px,1fr)_80px_120px_auto] gap-4 px-4 md:px-6 py-2.5 text-xs font-medium uppercase tracking-wide flex-shrink-0" style={{ background: 'var(--background-secondary)', color: 'var(--foreground-muted)', borderBottom: '1px solid var(--border-default)' }}>
          <button
            onClick={() => {
              const allPhotoIds = sortedPhotos.map(p => p.id)
              const allFolderIds = sortedFolders.map(f => f.id)
              const allSelected = allPhotoIds.every(id => selectedIds.has(id)) && allFolderIds.every(id => selectedFolderIds.has(id))
              if (allSelected) {
                setSelectedIds(new Set())
                setSelectedFolderIds(new Set())
              } else {
                setSelectedIds(new Set(allPhotoIds))
                setSelectedFolderIds(new Set(allFolderIds))
              }
            }}
            className="w-5 h-5 rounded border-2 flex items-center justify-center transition-all hover:border-[var(--accent-primary)]"
            style={{
              borderColor: (sortedPhotos.length > 0 || sortedFolders.length > 0) && sortedPhotos.every(p => selectedIds.has(p.id)) && sortedFolders.every(f => selectedFolderIds.has(f.id)) ? 'var(--accent-primary)' : 'var(--border-default)',
              background: (sortedPhotos.length > 0 || sortedFolders.length > 0) && sortedPhotos.every(p => selectedIds.has(p.id)) && sortedFolders.every(f => selectedFolderIds.has(f.id)) ? 'var(--accent-primary)' : 'transparent',
            }}
          >
            {(sortedPhotos.length > 0 || sortedFolders.length > 0) && sortedPhotos.every(p => selectedIds.has(p.id)) && sortedFolders.every(f => selectedFolderIds.has(f.id)) && (
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
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
      )}

      {/* 메인 콘텐츠 */}
      <div
        ref={gridContainerRef}
        className="p-3 sm:p-4 md:p-6 pb-24 sm:pb-24 relative select-none flex-1 overflow-y-auto"
        onMouseDown={(e) => handleDragSelectStart(e, gridContainerRef)}
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
                        // 터치로 스크롤하다가 클릭된 경우 무시
                        if (isTouchDragging || touchMovedRef.current) return
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
                      onTouchStart={(e) => handleItemTouchStart(e, folder.id, true)}
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

            {/* 검색 결과 헤더 */}
            {isSearchMode && (
              <div className="mb-4 flex items-center gap-2">
                <h2 className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  &quot;{searchQuery}&quot; 검색 결과
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-primary-alpha)', color: 'var(--accent-primary)' }}>
                  {sortedPhotos.length + sortedFolders.length}개
                </span>
                {searchLoading && (
                  <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
                )}
              </div>
            )}

            {/* 사진 그리드 */}
            {sortedPhotos.length > 0 && (
              <div className="animate-fade-in">
                {currentCategory === 'all' && sortedFolders.length > 0 && !isSearchMode && (
                  <h2 className="text-xs sm:text-sm font-medium mb-3 sm:mb-4 uppercase tracking-wide" style={{ color: 'var(--foreground-muted)' }}>파일</h2>
                )}
                <div className={`image-grid ${currentCategory === 'documents' ? 'view-large' : 'view-grid'}`}>
                  {sortedPhotos.map((photo, index) => (
                    <div
                      key={photo.id}
                      data-photo-id={photo.id}
                      className={`image-item group ${selectedIds.has(photo.id) ? 'selected' : ''}`}
                      onClick={(e) => {
                        // 터치로 스크롤하다가 클릭된 경우 무시
                        if (isTouchDragging || touchMovedRef.current) return
                        if (isSelecting) {
                          toggleSelect(photo.id, e, index)
                        } else if (isSearchMode) {
                          // 검색 모드: 해당 파일의 폴더로 이동 후 뷰어 열기
                          setSearchQuery('')
                          setIsSearchFocused(false)
                          const folderId = photo.folder_id
                          router.push(`/viewer?photoId=${photo.id}${folderId ? `&folder=${folderId}` : ''}&sortBy=${sortBy}&sortOrder=${sortOrder}`)
                        } else {
                          router.push(`/viewer?index=${index}${currentFolderId ? `&folder=${currentFolderId}` : ''}${currentCategory !== 'all' ? `&category=${currentCategory}` : ''}&sortBy=${sortBy}&sortOrder=${sortOrder}`)
                        }
                      }}
                      onTouchStart={(e) => handleItemTouchStart(e, photo.id, false)}
                      onTouchMove={handleItemTouchMove}
                      onTouchEnd={handleItemTouchEnd}
                    >
                      {/* 미디어 파일이면 썸네일, 아니면 파일 아이콘 */}
                      {isMediaFile(photo.name) ? (
                        isVideoFile(photo.name) && !photo.thumbnail_url ? (
                          <LazyVideoThumbnail
                            photoId={photo.id}
                            videoUrl={photo.url}
                            className={`transition-transform duration-300 ${selectedIds.has(photo.id) ? 'scale-90' : ''}`}
                            onThumbnailGenerated={(url) => {
                              setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, thumbnail_url: url } : p))
                            }}
                          />
                        ) : (
                          <img
                            src={toProxyUrl(photo.thumbnail_url || photo.url)}
                            alt=""
                            className={`transition-transform duration-300 ${selectedIds.has(photo.id) ? 'scale-90' : ''}`}
                            draggable={false}
                            loading="lazy"
                            decoding="async"
                          />
                        )
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center" style={{ background: 'var(--background-tertiary)' }}>
                          <FileThumbnail
                            filename={photo.name}
                            size={currentCategory === 'documents' ? 'lg' : 'md'}
                            className={`transition-transform duration-300 !bg-transparent ${selectedIds.has(photo.id) ? 'scale-90' : ''}`}
                          />
                          {/* 문서 카테고리거나 전체 보기일 때 파일명/용량 표시 (사진/동영상 탭 제외) */}
                          {currentCategory !== 'photos' && currentCategory !== 'videos' && (
                            <div className="absolute bottom-0 left-0 right-0 p-2 text-center" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' }}>
                              <p className="text-xs text-white truncate font-medium">{photo.name}</p>
                              {photo.file_size && (
                                <p className="text-[10px] text-white/70">
                                  {photo.file_size < 1024 ? `${photo.file_size} B` :
                                   photo.file_size < 1024 * 1024 ? `${(photo.file_size / 1024).toFixed(1)} KB` :
                                   `${(photo.file_size / (1024 * 1024)).toFixed(1)} MB`}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

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
                        {isSearchMode && photo.folder_id !== currentFolderId && (
                          <p className="text-white/70 text-[10px] truncate mt-0.5">
                            📁 {getFolderPath(photo.folder_id)}
                          </p>
                        )}
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
                className="list-row flex items-center px-4 py-2.5 cursor-pointer transition-colors group sm:grid sm:grid-cols-[auto_minmax(200px,1fr)_80px_120px_auto] sm:gap-4 border-b"
                style={{
                  background: selectedFolderIds.has(folder.id) ? 'var(--accent-primary-alpha)' : 'transparent',
                  borderColor: 'var(--border-default)'
                }}
                onClick={(e) => {
                  // 터치로 스크롤하다가 클릭된 경우 무시
                  if (isTouchDragging || touchMovedRef.current) return
                  if (isSelecting) {
                    toggleFolderSelect(folder.id, e, folderIndex)
                  } else {
                    router.push(`/drive?folder=${folder.id}`)
                  }
                }}
                onTouchStart={(e) => handleItemTouchStart(e, folder.id, true)}
                onTouchMove={handleItemTouchMove}
                onTouchEnd={handleItemTouchEnd}
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
                {/* 체크박스 - 선택 모드일 때만 모바일에서 표시, 항상 다중선택 */}
                <div
                  className={`mr-3 sm:mr-0 ${isSelecting ? 'block' : 'hidden sm:block'}`}
                  onClick={(e) => toggleFolderSelect(folder.id, e, folderIndex, true)}
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
                <div className="w-10 sm:w-8 relative ml-1 sm:ml-0 flex-shrink-0">
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
                className="list-row flex items-center px-4 py-2.5 cursor-pointer transition-colors group sm:grid sm:grid-cols-[auto_minmax(200px,1fr)_80px_120px_auto] sm:gap-4 border-b"
                style={{
                  background: selectedIds.has(photo.id) ? 'var(--accent-primary-alpha)' : 'transparent',
                  borderColor: 'var(--border-default)'
                }}
                onClick={(e) => {
                  // 터치로 스크롤하다가 클릭된 경우 무시
                  if (isTouchDragging || touchMovedRef.current) return
                  if (isSelecting) {
                    toggleSelect(photo.id, e, index)
                  } else if (isSearchMode) {
                    // 검색 모드: 해당 파일의 폴더로 이동 후 뷰어 열기
                    setSearchQuery('')
                    setIsSearchFocused(false)
                    const folderId = photo.folder_id
                    router.push(`/viewer?photoId=${photo.id}${folderId ? `&folder=${folderId}` : ''}&sortBy=${sortBy}&sortOrder=${sortOrder}`)
                  } else {
                    router.push(`/viewer?index=${index}${currentFolderId ? `&folder=${currentFolderId}` : ''}${currentCategory !== 'all' ? `&category=${currentCategory}` : ''}&sortBy=${sortBy}&sortOrder=${sortOrder}`)
                  }
                }}
                onTouchStart={(e) => handleItemTouchStart(e, photo.id, false)}
                onTouchMove={handleItemTouchMove}
                onTouchEnd={handleItemTouchEnd}
                onMouseEnter={(e) => !selectedIds.has(photo.id) && (e.currentTarget.style.background = 'var(--background-secondary)')}
                onMouseLeave={(e) => !selectedIds.has(photo.id) && (e.currentTarget.style.background = 'transparent')}
              >
                {/* 체크박스 - 선택 모드일 때만 모바일에서 표시, 항상 다중선택 */}
                <div
                  className={`mr-3 sm:mr-0 ${isSelecting ? 'block' : 'hidden sm:block'}`}
                  onClick={(e) => toggleSelect(photo.id, e, index, true)}
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
                    {isMediaFile(photo.name) ? (
                      isVideoFile(photo.name) && !photo.thumbnail_url ? (
                        <LazyVideoThumbnail
                          photoId={photo.id}
                          videoUrl={photo.url}
                          onThumbnailGenerated={(url) => {
                            setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, thumbnail_url: url } : p))
                          }}
                        />
                      ) : (
                        <img src={toProxyUrl(photo.thumbnail_url || photo.url)} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                      )
                    ) : (
                      <FileThumbnail filename={photo.name} size="sm" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate text-[15px] sm:text-sm">{photo.name || photo.url.split('/').pop()}</p>
                    <p className="text-xs sm:hidden mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                      {isSearchMode && photo.folder_id !== currentFolderId ? (
                        <>📁 {getFolderPath(photo.folder_id)}</>
                      ) : (
                        <>{getFileTypeLabel(photo.name)} · {formatDate(photo.created_at)}</>
                      )}
                    </p>
                  </div>
                </div>
                {/* 데스크톱 추가 컬럼 */}
                <div className="text-sm hidden sm:block truncate" style={{ color: 'var(--foreground-muted)' }}>
                  {isSearchMode && photo.folder_id !== currentFolderId ? getFolderPath(photo.folder_id) : getFileTypeLabel(photo.name)}
                </div>
                <div className="text-sm hidden sm:block" style={{ color: 'var(--foreground-muted)' }}>{formatDate(photo.created_at)}</div>
                {/* 더보기 버튼 */}
                <div className="w-10 sm:w-8 relative ml-1 sm:ml-0 flex-shrink-0">
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
              <div className="empty-state h-[60vh] animate-fade-in">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex items-center justify-center mb-4 sm:mb-6" style={{ background: 'var(--background-secondary)' }}>
                  <svg className="empty-state-icon !w-10 !h-10 sm:!w-12 sm:!h-12 !mb-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {searchQuery ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    )}
                  </svg>
                </div>
                {searchQuery ? (
                  <>
                    <p className="empty-state-title text-base sm:text-lg">&quot;{searchQuery}&quot; 검색 결과 없음</p>
                    <p className="empty-state-description text-xs sm:text-sm">
                      다른 검색어로 시도해보세요
                    </p>
                  </>
                ) : (
                  <>
                    <p className="empty-state-title text-base sm:text-lg">아직 비어있어요</p>
                    <p className="empty-state-description text-xs sm:text-sm">
                      <span className="xl:hidden">+ 버튼을 눌러 파일을 추가하세요</span>
                      <span className="hidden xl:inline">업로드 버튼 또는 드래그앤드롭으로 추가해보세요</span>
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* 빈 상태 (그리드 뷰) */}
        {!loading && !userLoading && effectiveViewMode === 'grid' && sortedPhotos.length === 0 && sortedFolders.length === 0 && (
          <div className="empty-state h-[60vh] animate-fade-in">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex items-center justify-center mb-4 sm:mb-6" style={{ background: 'var(--background-secondary)' }}>
              <svg className="empty-state-icon !w-10 !h-10 sm:!w-12 sm:!h-12 !mb-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {searchQuery ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                )}
              </svg>
            </div>
            {searchQuery ? (
              <>
                <p className="empty-state-title text-base sm:text-lg">&quot;{searchQuery}&quot; 검색 결과 없음</p>
                <p className="empty-state-description text-xs sm:text-sm">
                  다른 검색어로 시도해보세요
                </p>
              </>
            ) : (
              <>
                <p className="empty-state-title text-base sm:text-lg">아직 비어있어요</p>
                <p className="empty-state-description text-xs sm:text-sm">
                  <span className="xl:hidden">+ 버튼을 눌러 파일을 추가하세요</span>
                  <span className="hidden xl:inline">업로드 버튼 또는 드래그앤드롭으로 추가해보세요</span>
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* 새 폴더 모달 - TDS Style (입력 모달: 상단에서 내려옴) */}
      {showNewFolderInput && (
        <div className="tds-modal-input-backdrop" onClick={() => { setShowNewFolderInput(false); setNewFolderName('') }}>
          <div className="tds-modal-input" onClick={(e) => e.stopPropagation()}>
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
                style={{ fontSize: 16 }}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && !isCreatingFolder && handleCreateFolder()}
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
                disabled={!newFolderName.trim() || isCreatingFolder}
                className="tds-btn tds-btn-primary"
              >
                {isCreatingFolder ? '만드는 중...' : '만들기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 폴더 이름 수정 모달 - TDS Style (입력 모달: 상단에서 내려옴) */}
      {editingFolder && (
        <div className="tds-modal-input-backdrop" onClick={() => { setEditingFolder(null); setEditFolderName('') }}>
          <div className="tds-modal-input" onClick={(e) => e.stopPropagation()}>
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
                style={{ fontSize: 16 }}
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

      {/* 파일 이름 변경 모달 (입력 모달: 상단에서 내려옴) */}
      {editingPhoto && (
        <div className="tds-modal-input-backdrop" onClick={() => { setEditingPhoto(null); setEditPhotoName('') }}>
          <div className="tds-modal-input" onClick={(e) => e.stopPropagation()}>
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
                style={{ fontSize: 16 }}
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

            <div className="tds-modal-body space-y-5" style={{ padding: '16px 0' }}>
              {/* 썸네일 프리뷰 */}
              <div className="w-full aspect-square max-w-[120px] mx-auto rounded-xl overflow-hidden" style={{ background: 'var(--background-tertiary)' }}>
                {isMediaFile(infoPhoto.name) ? (
                  infoPhoto.is_video ? (
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
                  )
                ) : (
                  <FileThumbnail filename={infoPhoto.name} />
                )}
              </div>

              {/* 속성 섹션 */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide mb-3 px-5" style={{ color: 'var(--foreground-muted)' }}>속성</h3>
                <div className="space-y-0">
                  <div className="flex justify-between items-center py-2.5 px-5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm shrink-0" style={{ color: 'var(--foreground-secondary)' }}>이름</span>
                    <span className="text-sm font-medium truncate ml-4" style={{ color: 'var(--foreground)' }}>
                      {infoPhoto.name || infoPhoto.url.split('/').pop()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5 px-5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm shrink-0" style={{ color: 'var(--foreground-secondary)' }}>저장 위치</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      Cloody{infoPhoto.folder_id ? ` > ${allFolders.find(f => f.id === infoPhoto.folder_id)?.name || '폴더'}` : ''}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5 px-5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm shrink-0" style={{ color: 'var(--foreground-secondary)' }}>크기</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {infoPhoto.file_size ? (
                        infoPhoto.file_size >= 1024 * 1024
                          ? `${(infoPhoto.file_size / (1024 * 1024)).toFixed(2)} MB`
                          : `${(infoPhoto.file_size / 1024).toFixed(2)} KB`
                      ) : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5 px-5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm shrink-0" style={{ color: 'var(--foreground-secondary)' }}>유형</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {getFileTypeLabel(infoPhoto.name)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5 px-5">
                    <span className="text-sm shrink-0" style={{ color: 'var(--foreground-secondary)' }}>수정 일시</span>
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

            <div className="tds-modal-body space-y-5" style={{ padding: '16px 0' }}>
              {/* 폴더 아이콘 프리뷰 */}
              <div className="w-32 h-32 mx-auto rounded-xl flex items-center justify-center" style={{ background: 'var(--background-tertiary)' }}>
                <svg className="w-16 h-16" style={{ color: 'var(--accent-primary)', opacity: 0.7 }} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                </svg>
              </div>

              {/* 속성 섹션 */}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide mb-3 px-5" style={{ color: 'var(--foreground-muted)' }}>속성</h3>
                <div className="space-y-0">
                  <div className="flex justify-between items-center py-2.5 px-5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm shrink-0" style={{ color: 'var(--foreground-secondary)' }}>이름</span>
                    <span className="text-sm font-medium truncate ml-4" style={{ color: 'var(--foreground)' }}>{infoFolder.name}</span>
                  </div>
                  <div className="flex justify-between items-center py-2.5 px-5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm shrink-0" style={{ color: 'var(--foreground-secondary)' }}>저장 위치</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {infoFolder.parent_id ? folders.find(f => f.id === infoFolder.parent_id)?.name || 'Cloody' : 'Cloody'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2.5 px-5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-sm shrink-0" style={{ color: 'var(--foreground-secondary)' }}>항목</span>
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
                  <div className="flex justify-between items-center py-2.5 px-5">
                    <span className="text-sm shrink-0" style={{ color: 'var(--foreground-secondary)' }}>수정 일시</span>
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
      {/* 카테고리 필터(사진/동영상/문서) 시 숨김 */}
      <nav className={`tds-bottom-nav xl:hidden ${currentCategory !== 'all' ? 'hidden' : ''}`} style={{ zIndex: 70 }}>
        <button
          onClick={() => {
            setShowUploadPanel(false)
            setShowMoreScreen(false)
            // 탭 전환 시 선택 해제
            setSelectedIds(new Set())
            setSelectedFolderIds(new Set())
            router.push('/drive')
          }}
          className={`tds-bottom-nav-item ${currentCategory === 'all' && !showUploadPanel && !showMoreScreen ? 'active' : ''}`}
        >
          <Home
            size={26}
            strokeWidth={currentCategory === 'all' && !showUploadPanel && !showMoreScreen ? 2 : 1.5}
          />
          <span>홈</span>
        </button>

        <button
          onClick={() => {
            setShowMoreScreen(false)
            setShowUploadPanel(true)
            // 탭 전환 시 선택 해제
            setSelectedIds(new Set())
            setSelectedFolderIds(new Set())
          }}
          className={`tds-bottom-nav-item ${showUploadPanel && !showMoreScreen ? 'active' : ''}`}
        >
          <div className="relative">
            <CloudUpload
              size={26}
              strokeWidth={showUploadPanel && !showMoreScreen ? 2 : 1.5}
            />
            {uploading && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: 'var(--accent-primary)' }} />
            )}
          </div>
          <span>업로드</span>
        </button>

        <button
          onClick={() => {
            // 더보기 탭 클릭 시 업로드 패널 숨김
            setShowUploadPanel(false)
            setShowMoreScreen(!showMoreScreen)
            // 탭 전환 시 선택 해제
            setSelectedIds(new Set())
            setSelectedFolderIds(new Set())
          }}
          className={`tds-bottom-nav-item ${showMoreScreen ? 'active' : ''}`}
        >
          <Menu size={26} strokeWidth={showMoreScreen ? 2 : 1.5} />
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
                <span className="tds-text-body" style={{ fontWeight: 500 }}>업로드</span>
                <input
                  ref={fabFileInputRef}
                  type="file"
                  multiple
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
        <div className="xl:hidden flex-1 min-h-0 pb-20 flex flex-col" style={{ background: 'var(--background)' }}>
          {/* 헤더 */}
          <div className="sticky top-0 z-10 safe-area-top" style={{ background: 'var(--background)', borderBottom: '1px solid var(--glass-border)' }}>
            <div className="flex items-center h-14 px-4">
              <h1 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>더보기</h1>
            </div>
          </div>

          {/* 내용 */}
          <div className="flex-1 min-h-0 overflow-y-auto pb-4">
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
                  <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>사용중인 용량</span>
                  <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                    {formatBytes(storageUsed)}
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
                  { id: 'documents', label: '문서', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
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
                      className="w-full flex items-center gap-4 px-4 py-4 transition-colors settings-hover-btn active:bg-black/10"
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

            {/* 관리 메뉴 */}
            <div className="px-4 mb-6">
              <p className="text-xs font-medium uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--foreground-muted)' }}>
                관리
              </p>
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <Link
                  href="/trash"
                  prefetch={true}
                  className="w-full flex items-center gap-4 px-4 py-4 transition-colors active:bg-black/5"
                  style={{ color: 'var(--foreground)' }}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--background-tertiary)' }}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </div>
                  <span className="text-[15px] font-medium">휴지통</span>
                  <svg className="w-5 h-5 ml-auto" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>

            {/* 설정 */}
            <div className="px-4 mb-6">
              <p className="text-xs font-medium uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--foreground-muted)' }}>
                설정
              </p>
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <Link
                  href="/settings"
                  prefetch={true}
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
                </Link>

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

      {/* 업로드 현황 패널 (모바일 탭) - 더보기 화면에서는 숨김 */}
      {showUploadPanel && !showMoreScreen && !isDesktopViewport && (
        <div className="xl:hidden flex-1 min-h-0 pb-20 flex flex-col" style={{ background: 'var(--background)' }}>
          {/* 헤더 */}
          <div className="sticky top-0 z-10 safe-area-top" style={{ background: 'var(--background)', borderBottom: '1px solid var(--glass-border)' }}>
            <div className="flex items-center h-14 px-4">
              <h1 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>업로드</h1>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4" style={{ background: 'var(--background)' }}>
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
                {hiddenMobileUploadCount > 0 && (
                  <div className="px-1 pb-1">
                    <p className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                      최근 {mobileUploadItems.length}개 표시 중 (전체 {uploadQueue.length}개)
                    </p>
                  </div>
                )}
                {mobileUploadItems.map((item) => (
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
