'use client'

import React from 'react'

// 파일 타입 분류
export type FileTypeCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'archive'
  | 'code'
  | 'text'
  | 'figma'
  | 'sketch'
  | 'photoshop'
  | 'illustrator'
  | 'font'
  | 'unknown'

// 확장자별 파일 타입 매핑
const extensionMap: Record<string, FileTypeCategory> = {
  // 이미지
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  svg: 'image', bmp: 'image', ico: 'image', tiff: 'image', heic: 'image', heif: 'image',

  // 동영상
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video',
  wmv: 'video', flv: 'video', m4v: 'video', '3gp': 'video',

  // 오디오
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio',
  wma: 'audio', m4a: 'audio', aiff: 'audio',

  // PDF
  pdf: 'pdf',

  // Word
  doc: 'word', docx: 'word', rtf: 'word', odt: 'word',

  // Excel
  xls: 'excel', xlsx: 'excel', csv: 'excel', ods: 'excel',

  // PowerPoint
  ppt: 'powerpoint', pptx: 'powerpoint', odp: 'powerpoint', key: 'powerpoint',

  // 압축파일
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',

  // 코드
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code', html: 'code', css: 'code',
  json: 'code', py: 'code', java: 'code', cpp: 'code', c: 'code', go: 'code',
  rs: 'code', swift: 'code', kt: 'code', rb: 'code', php: 'code', sql: 'code',

  // 텍스트
  txt: 'text', md: 'text', log: 'text',

  // 디자인 파일
  fig: 'figma',
  sketch: 'sketch',
  psd: 'photoshop',
  ai: 'illustrator',

  // 폰트
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font', eot: 'font',
}

// 파일명에서 확장자 추출
export function getFileExtension(filename: string): string {
  const parts = filename.split('.')
  if (parts.length < 2) return ''
  return parts[parts.length - 1].toLowerCase()
}

// 파일명에서 타입 분류 가져오기
export function getFileTypeCategory(filename: string): FileTypeCategory {
  const ext = getFileExtension(filename)
  return extensionMap[ext] || 'unknown'
}

// 파일 타입이 미디어(이미지/동영상)인지 확인
export function isMediaFile(filename: string): boolean {
  const category = getFileTypeCategory(filename)
  return category === 'image' || category === 'video'
}

// 파일 타입별 색상
const typeColors: Record<FileTypeCategory, string> = {
  image: '#10B981',
  video: '#8B5CF6',
  audio: '#EC4899',
  pdf: '#EF4444',
  word: '#3B82F6',
  excel: '#22C55E',
  powerpoint: '#F97316',
  archive: '#EAB308',
  code: '#6366F1',
  text: '#6B7280',
  figma: '#A855F7',
  sketch: '#FBBF24',
  photoshop: '#0EA5E9',
  illustrator: '#F97316',
  font: '#8B5CF6',
  unknown: '#9CA3AF',
}

// 파일 타입별 레이블 (아이콘에 표시)
const typeLabels: Record<FileTypeCategory, string | null> = {
  image: null,
  video: null,
  audio: null,
  pdf: 'PDF',
  word: 'DOC',
  excel: 'XLS',
  powerpoint: 'PPT',
  archive: 'ZIP',
  code: '</>',
  text: 'TXT',
  figma: 'FIG',
  sketch: null,
  photoshop: 'PSD',
  illustrator: 'AI',
  font: null,
  unknown: null,
}

export function getFileTypeColor(filename: string): string {
  const category = getFileTypeCategory(filename)
  return typeColors[category]
}

// 파일 타입별 아이콘 컴포넌트
interface FileIconProps {
  filename: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export function FileIcon({ filename, size = 'md', className = '' }: FileIconProps) {
  const category = getFileTypeCategory(filename)
  const color = typeColors[category]
  const label = typeLabels[category]

  const sizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-10 h-10',
  }

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 18,
    xl: 24,
  }

  const labelSizes = {
    sm: 5,
    md: 6,
    lg: 7,
    xl: 8,
  }

  return (
    <div className={`${sizeClasses[size]} flex items-center justify-center relative ${className}`}>
      <DocumentFilledIcon size={iconSizes[size]} color={color} opacity={0.6} />
      {label && (
        <span
          className="absolute font-bold text-white"
          style={{
            fontSize: labelSizes[size],
            bottom: size === 'sm' ? 1 : size === 'md' ? 2 : size === 'lg' ? 3 : 4,
          }}
        >
          {label}
        </span>
      )}
    </div>
  )
}

// 파일 타입별 썸네일 (그리드에서 사용)
interface FileThumbnailProps {
  filename: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export function FileThumbnail({ filename, className = '', size = 'md' }: FileThumbnailProps) {
  const category = getFileTypeCategory(filename)
  const color = typeColors[category]
  const label = typeLabels[category]

  const iconSizes = { sm: 28, md: 40, lg: 56 }
  const labelSizes = { sm: 7, md: 9, lg: 12 }
  const labelOffset = { sm: 6, md: 10, lg: 14 }

  return (
    <div
      className={`w-full h-full flex items-center justify-center relative ${className}`}
      style={{ background: 'var(--background-tertiary)' }}
    >
      <DocumentFilledIcon size={iconSizes[size]} color={color} opacity={0.7} />
      {label && (
        <span
          className="absolute font-bold text-white"
          style={{ fontSize: labelSizes[size], bottom: '50%', transform: `translateY(${labelOffset[size]}px)` }}
        >
          {label}
        </span>
      )}
    </div>
  )
}

// 문서 아이콘 (폴더와 동일한 스타일)
function DocumentFilledIcon({ size, color, opacity = 1 }: { size: number; color: string; opacity?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ opacity }}>
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z"/>
    </svg>
  )
}

// 파일 타입 한글 레이블
export function getFileTypeLabel(filename: string): string {
  const category = getFileTypeCategory(filename)
  const labels: Record<FileTypeCategory, string> = {
    image: '이미지',
    video: '동영상',
    audio: '오디오',
    pdf: 'PDF 문서',
    word: 'Word 문서',
    excel: 'Excel 스프레드시트',
    powerpoint: 'PowerPoint 프레젠테이션',
    archive: '압축 파일',
    code: '코드 파일',
    text: '텍스트 파일',
    figma: 'Figma 파일',
    sketch: 'Sketch 파일',
    photoshop: 'Photoshop 파일',
    illustrator: 'Illustrator 파일',
    font: '폰트 파일',
    unknown: '파일',
  }
  return labels[category]
}

// 레거시 호환용
export function getFileTypeColors(filename: string) {
  const color = getFileTypeColor(filename)
  return {
    bg: `bg-[${color}]/10`,
    fg: `text-[${color}]`,
    border: `border-[${color}]/20`,
  }
}
