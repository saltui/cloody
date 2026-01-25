'use client'

import { useState, useCallback } from 'react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'

interface DownloadItem {
  id: string
  name: string
  url: string
  type: 'photo' | 'folder'
  folderId?: string | null
}

interface FolderInfo {
  id: string
  name: string
  parentId: string | null
}

interface DownloadProgress {
  phase: 'preparing' | 'downloading' | 'zipping' | 'done' | 'error'
  current: number
  total: number
  currentFile?: string
  error?: string
}

const MAX_SIZE_WARNING = 500 * 1024 * 1024 // 500MB

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

export function useZipDownload() {
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  const downloadAsZip = useCallback(async (
    items: DownloadItem[],
    allFolders: FolderInfo[],
    fetchFolderContents: (folderId: string) => Promise<DownloadItem[]>
  ) => {
    if (items.length === 0) return

    setIsDownloading(true)
    setProgress({ phase: 'preparing', current: 0, total: 0 })

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
        setProgress({ phase: 'error', current: 0, total: 0, error: '다운로드할 파일이 없습니다' })
        return
      }

      // 파일 다운로드 및 ZIP 생성
      setProgress({ phase: 'downloading', current: 0, total: filesToDownload.length })
      const zip = new JSZip()
      let downloadedCount = 0
      let totalSize = 0

      for (const file of filesToDownload) {
        try {
          setProgress({
            phase: 'downloading',
            current: downloadedCount,
            total: filesToDownload.length,
            currentFile: file.name,
          })

          const proxyUrl = toProxyUrl(file.url)
          const response = await fetch(proxyUrl)

          if (!response.ok) {
            console.warn(`Failed to fetch ${file.name}: ${response.status}`)
            continue
          }

          const blob = await response.blob()
          totalSize += blob.size

          // 500MB 초과 시 경고
          if (totalSize > MAX_SIZE_WARNING && downloadedCount === 0) {
            const proceed = confirm('다운로드 크기가 500MB를 초과할 수 있습니다. 계속하시겠습니까?')
            if (!proceed) {
              setProgress(null)
              setIsDownloading(false)
              return
            }
          }

          // ZIP에 파일 추가 (폴더 구조 유지)
          const filePath = file.path ? `${file.path}/${file.name}` : file.name
          zip.file(filePath, blob)

          downloadedCount++
        } catch (error) {
          console.warn(`Error downloading ${file.name}:`, error)
        }
      }

      if (downloadedCount === 0) {
        setProgress({ phase: 'error', current: 0, total: 0, error: '파일을 다운로드하지 못했습니다' })
        return
      }

      // ZIP 생성
      setProgress({ phase: 'zipping', current: downloadedCount, total: filesToDownload.length })

      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        (metadata) => {
          setProgress({
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
      setProgress({ phase: 'done', current: downloadedCount, total: filesToDownload.length })

      // 완료 후 잠시 뒤 상태 초기화
      setTimeout(() => {
        setProgress(null)
        setIsDownloading(false)
      }, 2000)

    } catch (error) {
      console.error('Download error:', error)
      setProgress({
        phase: 'error',
        current: 0,
        total: 0,
        error: error instanceof Error ? error.message : '다운로드 중 오류가 발생했습니다',
      })
      setIsDownloading(false)
    }
  }, [])

  const cancelDownload = useCallback(() => {
    setProgress(null)
    setIsDownloading(false)
  }, [])

  return {
    downloadAsZip,
    cancelDownload,
    progress,
    isDownloading,
  }
}
