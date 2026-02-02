'use client'

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { FileText, Download, Loader2 } from 'lucide-react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// PDF.js worker 설정 (로컬 파일 사용)
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

// 파일 타입 감지
export function getFileCategory(filename: string): 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'code' | 'office' | 'unknown' {
  const ext = filename.split('.').pop()?.toLowerCase() || ''

  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tiff', 'ico']
  const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v', '3gp']
  const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'aiff']
  const textExts = ['txt', 'md', 'markdown', 'log', 'csv', 'json', 'xml', 'yaml', 'yml', 'ini', 'conf', 'cfg', 'env', 'gitignore', 'editorconfig']
  const codeExts = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala', 'html', 'css', 'scss', 'less', 'sass', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'vue', 'svelte']
  const officeExts = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'hwp']

  if (imageExts.includes(ext)) return 'image'
  if (videoExts.includes(ext)) return 'video'
  if (audioExts.includes(ext)) return 'audio'
  if (ext === 'pdf') return 'pdf'
  if (textExts.includes(ext)) return 'text'
  if (codeExts.includes(ext)) return 'code'
  if (officeExts.includes(ext)) return 'office'

  return 'unknown'
}

// 코드 언어 감지
function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const langMap: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', java: 'java', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php',
    swift: 'swift', kt: 'kotlin', scala: 'scala',
    html: 'html', css: 'css', scss: 'scss', less: 'less',
    sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
    json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', markdown: 'markdown',
    vue: 'vue', svelte: 'svelte',
  }
  return langMap[ext] || 'plaintext'
}

interface TextPreviewProps {
  url: string
  filename: string
  onDownload?: () => void
}

export function TextPreview({ url, filename, onDownload }: TextPreviewProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const category = getFileCategory(filename)
  const isCode = category === 'code'
  const language = getLanguage(filename)

  useEffect(() => {
    const fetchContent = async () => {
      try {
        setLoading(true)
        setError(null)

        const res = await fetch(url)
        if (!res.ok) throw new Error('Failed to fetch file')

        const text = await res.text()

        // 파일 크기 제한 (1MB)
        if (text.length > 1024 * 1024) {
          setContent(text.slice(0, 1024 * 1024) + '\n\n... (파일이 너무 커서 일부만 표시됩니다)')
        } else {
          setContent(text)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '파일을 불러올 수 없습니다')
      } finally {
        setLoading(false)
      }
    }

    fetchContent()
  }, [url])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--foreground-muted)' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <FileText className="w-16 h-16" style={{ color: 'var(--foreground-muted)' }} />
        <p style={{ color: 'var(--foreground-secondary)' }}>{error}</p>
        {onDownload && (
          <button
            onClick={onDownload}
            className="flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{ background: 'var(--accent-primary)', color: 'white' }}
          >
            <Download className="w-4 h-4" />
            다운로드
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto" style={{ background: isCode ? '#1e1e1e' : 'var(--background)' }}>
      <pre
        className="p-4 text-sm leading-relaxed whitespace-pre-wrap break-words font-mono"
        style={{
          color: isCode ? '#d4d4d4' : 'var(--foreground)',
          minHeight: '100%',
        }}
      >
        <code className={`language-${language}`}>{content}</code>
      </pre>
    </div>
  )
}

interface PDFPreviewProps {
  url: string
  filename: string
  onDownload?: () => void
}

export function PDFPreview({ url, filename, onDownload }: PDFPreviewProps) {
  const [numPages, setNumPages] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [containerWidth, setContainerWidth] = useState<number>(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) return

    const updateWidth = () => {
      setContainerWidth(node.clientWidth)
    }
    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    setLoading(false)
  }, [])

  const onDocumentLoadError = useCallback(() => {
    setError(true)
    setLoading(false)
  }, [])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <FileText className="w-16 h-16" style={{ color: 'var(--foreground-muted)' }} />
        <p style={{ color: 'var(--foreground-secondary)' }}>PDF를 미리볼 수 없습니다</p>
        {onDownload && (
          <button
            onClick={onDownload}
            className="flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{ background: 'var(--accent-primary)', color: 'white' }}
          >
            <Download className="w-4 h-4" />
            다운로드
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col" style={{ background: 'var(--background-tertiary)' }}>
      {/* 컨트롤 바 */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ background: 'var(--background-secondary)', borderColor: 'var(--border-primary)' }}
      >
        <span className="text-sm" style={{ color: 'var(--foreground-primary)' }}>
          {numPages ? `${numPages}페이지` : '로딩중...'}
        </span>
        <div className="flex items-center gap-2">
          {onDownload && (
            <button
              onClick={onDownload}
              className="p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10"
              title="다운로드"
            >
              <Download className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* PDF 뷰어 - 스크롤 방식 */}
      <div ref={containerRef} className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--accent-primary)' }} />
          </div>
        )}
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading=""
          className="w-full"
        >
          {Array.from(new Array(numPages), (_, index) => (
            <Page
              key={`page_${index + 1}`}
              pageNumber={index + 1}
              width={containerWidth > 0 ? containerWidth : undefined}
              renderTextLayer={true}
              renderAnnotationLayer={true}
            />
          ))}
        </Document>
      </div>
    </div>
  )
}

interface OfficePreviewProps {
  url: string
  filename: string
  onDownload?: () => void
}

export function OfficePreview({ url, filename, onDownload }: OfficePreviewProps) {
  // Microsoft Office Online Viewer 또는 Google Docs Viewer 사용
  const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`

  return (
    <div className="h-full w-full flex flex-col">
      <iframe
        src={viewerUrl}
        className="w-full flex-1 border-0"
        title={filename}
      />
      <div className="p-3 flex justify-center" style={{ background: 'var(--background-secondary)' }}>
        <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
          Office 문서는 Microsoft 뷰어로 표시됩니다. 로드되지 않으면 다운로드하세요.
        </p>
      </div>
    </div>
  )
}

interface AudioPreviewProps {
  url: string
  filename: string
}

export function AudioPreview({ url, filename }: AudioPreviewProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      <div
        className="w-32 h-32 rounded-2xl flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%)' }}
      >
        <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
      </div>
      <p className="text-lg font-medium" style={{ color: 'var(--foreground)' }}>{filename}</p>
      <audio
        controls
        className="w-full max-w-md"
        style={{ filter: 'invert(var(--audio-invert, 0))' }}
      >
        <source src={url} />
        오디오를 재생할 수 없습니다.
      </audio>
    </div>
  )
}

interface UnknownFilePreviewProps {
  filename: string
  fileSize?: number
  onDownload?: () => void
}

export function UnknownFilePreview({ filename, fileSize, onDownload }: UnknownFilePreviewProps) {
  const ext = filename.split('.').pop()?.toUpperCase() || 'FILE'

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div
        className="w-24 h-24 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--background-tertiary)' }}
      >
        <FileText className="w-12 h-12" style={{ color: 'var(--foreground-muted)' }} />
      </div>
      <div className="text-center">
        <p className="text-lg font-medium" style={{ color: 'var(--foreground)' }}>{filename}</p>
        {fileSize && (
          <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>{formatFileSize(fileSize)}</p>
        )}
        <p className="text-sm mt-2" style={{ color: 'var(--foreground-secondary)' }}>
          이 파일 형식은 미리보기를 지원하지 않습니다
        </p>
      </div>
      {onDownload && (
        <button
          onClick={onDownload}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium"
          style={{ background: 'var(--accent-primary)', color: 'white' }}
        >
          <Download className="w-5 h-5" />
          다운로드
        </button>
      )}
    </div>
  )
}
