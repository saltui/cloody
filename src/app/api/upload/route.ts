import { NextRequest, NextResponse } from 'next/server'
import { uploadToR2 } from '@/lib/r2'
import { logAudit } from '@/lib/audit'
import { verifyUserSessionToken, findUserById } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { getClientIP } from '@/lib/request-utils'

// 대용량 파일 업로드를 위한 설정
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 무제한 스토리지 사용자
const UNLIMITED_STORAGE_EMAILS = new Set([
  'jdnfree@icloud.com',
])

// 일반 사용자 스토리지 제한 (1GB)
const STORAGE_LIMIT = 1 * 1024 * 1024 * 1024 // 1GB

// Magic bytes로 파일 타입 검증
const FILE_SIGNATURES: Record<string, { bytes: number[]; offset?: number }[]> = {
  // 이미지 (ftyp 제외)
  'image/jpeg': [{ bytes: [0xFF, 0xD8, 0xFF] }],
  'image/png': [{ bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }],
  'image/gif': [{ bytes: [0x47, 0x49, 0x46, 0x38] }], // GIF87a, GIF89a
  'image/webp': [{ bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }],
  'image/bmp': [{ bytes: [0x42, 0x4D] }],

  // 비디오 (ftyp 제외)
  'video/webm': [{ bytes: [0x1A, 0x45, 0xDF, 0xA3] }],
  'video/x-msvideo': [{ bytes: [0x52, 0x49, 0x46, 0x46] }], // AVI
  'video/x-matroska': [{ bytes: [0x1A, 0x45, 0xDF, 0xA3] }], // MKV

  // 문서
  'application/pdf': [{ bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  'application/zip': [{ bytes: [0x50, 0x4B, 0x03, 0x04] }], // PK (ZIP, DOCX, XLSX, PPTX 등)
}

// ftyp 기반 파일 타입 감지 (HEIC vs MP4/MOV 구분)
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis']
const VIDEO_BRANDS = ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp71', 'M4V', 'M4A', 'f4v', 'qt', 'avc1', 'MSNV', 'NDAS', 'NDSC', 'NDSH', 'NDSM', 'NDSP', 'NDSS', 'NDXC', 'NDXH', 'NDXM', 'NDXP', 'NDXS']

function detectFtypType(buffer: Buffer): string | null {
  // ftyp at offset 4
  if (buffer.length < 12) return null
  const ftyp = buffer.slice(4, 8).toString('ascii')
  if (ftyp !== 'ftyp') return null

  // brand at offset 8 (4 bytes) - trim spaces for comparison
  const brand = buffer.slice(8, 12).toString('ascii').trim()
  console.log('ftyp brand detected:', brand, '(raw:', buffer.slice(8, 12).toString('hex'), ')')

  // HEIC 체크 (trim된 브랜드로 비교)
  if (HEIC_BRANDS.some(b => brand.startsWith(b) || b.startsWith(brand))) return 'image/heic'

  // VIDEO 체크 (trim된 브랜드로 비교)
  if (VIDEO_BRANDS.some(b => brand.startsWith(b) || b.startsWith(brand))) return 'video/mp4'

  // 알 수 없는 ftyp 브랜드는 video로 간주 (대부분 MP4 변형)
  console.log('Unknown ftyp brand, defaulting to video/mp4:', brand)
  return 'video/mp4'
}

// 허용된 MIME 타입
const ALLOWED_TYPES = new Set([
  // 이미지
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/heic',
  'image/heif',
  // 비디오
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/x-matroska',
  // 문서
  'application/pdf',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'text/plain', // .txt
  'text/csv', // .csv
  'application/x-hwp', // .hwp
  'application/haansofthwp', // .hwp (alternative)
  'application/vnd.hancom.hwp', // .hwp (another alternative)
  'application/zip', // .zip
  'application/x-rar-compressed', // .rar
  'application/vnd.rar', // .rar (alternative)
  'application/octet-stream', // 일부 브라우저에서 문서 파일을 이 타입으로 보냄
])

// Magic bytes 검증
function validateFileSignature(buffer: Buffer, declaredType: string): boolean {
  const signatures = FILE_SIGNATURES[declaredType]
  if (!signatures) {
    // 알려진 타입이 아니면 확장자 기반으로만 검증
    return ALLOWED_TYPES.has(declaredType)
  }

  // 각 시그니처 체크
  for (const sig of signatures) {
    const offset = sig.offset || 0
    if (buffer.length < offset + sig.bytes.length) continue

    let matches = true
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[offset + i] !== sig.bytes[i]) {
        matches = false
        break
      }
    }

    if (matches) return true
  }

  return false
}

// 실제 파일 타입 감지
function detectFileType(buffer: Buffer): string | null {
  // 먼저 ftyp 기반 파일 체크 (HEIC, MP4, MOV 등)
  const ftypType = detectFtypType(buffer)
  if (ftypType) return ftypType

  // 그 외 시그니처 기반 체크
  for (const [mimeType, signatures] of Object.entries(FILE_SIGNATURES)) {
    for (const sig of signatures) {
      const offset = sig.offset || 0
      if (buffer.length < offset + sig.bytes.length) continue

      let matches = true
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buffer[offset + i] !== sig.bytes[i]) {
          matches = false
          break
        }
      }

      if (matches) return mimeType
    }
  }
  return null
}

// 최대 파일 크기 (500MB)
const MAX_FILE_SIZE = 500 * 1024 * 1024

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  // 사용자 인증 확인
  const sessionCookie = request.cookies.get('gallery_session')
  if (!sessionCookie) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const validation = verifyUserSessionToken(sessionCookie.value, ip)
  if (!validation.valid || !validation.userId) {
    return NextResponse.json({ error: '세션이 만료되었습니다.' }, { status: 401 })
  }

  // 사용자 정보 가져오기
  const user = await findUserById(validation.userId)
  if (!user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const fileName = formData.get('fileName') as string

    if (!file || !fileName) {
      console.log('Upload validation failed: missing file or fileName', { file: !!file, fileName: !!fileName })
      return NextResponse.json({ error: 'File and fileName are required' }, { status: 400 })
    }

    console.log('Upload attempt:', { fileName, fileType: file.type, fileSize: file.size, userEmail: user.email })

    // 파일 크기 검증
    if (file.size > MAX_FILE_SIZE) {
      console.log('Upload validation failed: file too large', { size: file.size, max: MAX_FILE_SIZE })
      return NextResponse.json({ error: '파일 크기는 500MB를 초과할 수 없습니다.' }, { status: 400 })
    }

    // 스토리지 제한 확인 (무제한 사용자 제외)
    if (!UNLIMITED_STORAGE_EMAILS.has(user.email.toLowerCase())) {
      // 현재 사용량 조회
      const { data: storageData } = await supabase
        .from('photos')
        .select('file_size')
        .eq('user_id', user.id)
        .is('deleted_at', null)

      const currentUsage = (storageData || []).reduce((sum, photo) => sum + (photo.file_size || 0), 0)
      const newUsage = currentUsage + file.size

      if (newUsage > STORAGE_LIMIT) {
        const usedGB = (currentUsage / (1024 * 1024 * 1024)).toFixed(2)
        const limitGB = (STORAGE_LIMIT / (1024 * 1024 * 1024)).toFixed(0)
        console.log('Upload rejected: storage limit exceeded', { currentUsage, fileSize: file.size, limit: STORAGE_LIMIT })
        return NextResponse.json({
          error: `스토리지 용량이 부족합니다. (현재 ${usedGB}GB / ${limitGB}GB 제한)`,
          storageExceeded: true,
          currentUsage,
          limit: STORAGE_LIMIT,
        }, { status: 403 })
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // 이미지/비디오 파일만 magic bytes 검증 (보안 목적)
    const declaredCategory = file.type.split('/')[0]
    let finalType = file.type || 'application/octet-stream'

    if (declaredCategory === 'image' || declaredCategory === 'video') {
      // Magic bytes로 실제 파일 타입 검증
      const detectedType = detectFileType(buffer)
      if (!detectedType) {
        console.log('Upload validation failed: could not detect file type', { declaredType: file.type, firstBytes: buffer.slice(0, 16).toString('hex') })
        return NextResponse.json({ error: '파일 형식을 확인할 수 없습니다.' }, { status: 400 })
      }

      // 선언된 타입과 실제 타입이 다르면 거부
      const detectedCategory = detectedType.split('/')[0]
      console.log('Type check:', { declaredType: file.type, detectedType, declaredCategory, detectedCategory })
      if (declaredCategory !== detectedCategory) {
        console.log('Upload validation failed: type mismatch', { declaredCategory, detectedCategory })
        return NextResponse.json({
          error: `파일 형식이 일치하지 않습니다: ${file.type} vs ${detectedType}`
        }, { status: 400 })
      }
      finalType = detectedType
    }

    // 파일명에서 위험한 문자 제거
    const sanitizedFileName = fileName
      .replace(/\.\./g, '') // path traversal 방지
      .replace(/[<>:"|?*]/g, '') // 특수문자 제거

    const url = await uploadToR2(sanitizedFileName, buffer, finalType)

    // 감사 로그 - 파일 업로드
    logAudit({
      action: 'UPLOAD',
      ip,
      userAgent,
      details: {
        fileName: sanitizedFileName,
        fileType: finalType,
        fileSize: file.size
      }
    })

    return NextResponse.json({ url })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
