import { NextRequest, NextResponse } from 'next/server'
import { getPresignedUploadUrl } from '@/lib/r2'
import { findUserById } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { requireSession, SessionError } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 무제한 스토리지 사용자
const UNLIMITED_STORAGE_EMAILS = new Set([
  'jdnfree@icloud.com',
])

// 일반 사용자 스토리지 제한 (1GB)
const STORAGE_LIMIT = 1 * 1024 * 1024 * 1024

// 최대 파일 크기 (4.5GB)
// Cloudflare R2 단일 PUT 한계를 고려해 5GB보다 약간 낮게 제한
const MAX_FILE_SIZE = Math.floor(4.5 * 1024 * 1024 * 1024)

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
  'video/x-m4v',
  'video/3gpp',
  'video/3gpp2',
  'video/mp2t',
  // 문서
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/html',
  'text/css',
  'text/javascript',
  'application/json',
  'application/xml',
  'text/xml',
  'text/yaml',
  'text/x-yaml',
  'application/x-yaml',
  'application/yaml',
  'text/x-sh',
  'application/x-sh',
  'text/x-shellscript',
  'text/x-python',
  'text/x-java-source',
  'text/x-c',
  'text/x-c++',
  'text/x-go',
  'text/x-rust',
  'text/x-sql',
  'text/x-toml',
  'application/toml',
  'application/x-hwp',
  'application/haansofthwp',
  'application/vnd.hancom.hwp',
  'application/zip',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/octet-stream',
])

export async function POST(request: NextRequest) {
  try {
    const { userId } = requireSession(request)

    const user = await findUserById(userId)
    if (!user) {
      return errorResponse(ErrorCode.UNAUTHORIZED, '사용자를 찾을 수 없습니다.')
    }

    const { fileName, fileType, fileSize } = await request.json()

    if (!fileName || !fileType || !fileSize) {
      return errorResponse(ErrorCode.INVALID_INPUT, 'fileName, fileType, fileSize are required')
    }

    console.log('Presign request:', { fileName, fileType, fileSize, userEmail: user.email })

    // 파일 크기 검증
    if (fileSize > MAX_FILE_SIZE) {
      console.log('Presign rejected: file too large', { fileSize, max: MAX_FILE_SIZE })
      return errorResponse(ErrorCode.INVALID_INPUT, '파일 크기는 4.5GB를 초과할 수 없습니다.')
    }

    // MIME 타입 검증
    if (!ALLOWED_TYPES.has(fileType)) {
      console.log('Presign rejected: unsupported type', { fileType, allowedTypes: Array.from(ALLOWED_TYPES) })
      return errorResponse(ErrorCode.INVALID_INPUT, `지원하지 않는 파일 형식입니다: ${fileType}`)
    }

    // 스토리지 제한 확인 (무제한 사용자 제외)
    if (!UNLIMITED_STORAGE_EMAILS.has(user.email.toLowerCase())) {
      const { data: storageData } = await supabase
        .from('photos')
        .select('file_size')
        .eq('user_id', user.id)
        .is('deleted_at', null)

      const currentUsage = (storageData || []).reduce((sum, photo) => sum + (photo.file_size || 0), 0)
      const newUsage = currentUsage + fileSize

      if (newUsage > STORAGE_LIMIT) {
        const usedGB = (currentUsage / (1024 * 1024 * 1024)).toFixed(2)
        const limitGB = (STORAGE_LIMIT / (1024 * 1024 * 1024)).toFixed(0)
        return errorResponse(ErrorCode.STORAGE_LIMIT, `스토리지 용량이 부족합니다. (현재 ${usedGB}GB / ${limitGB}GB 제한)`, {
          storageExceeded: true,
          currentUsage,
          limit: STORAGE_LIMIT,
        })
      }
    }

    // 파일명 sanitize
    const sanitizedFileName = fileName
      .replace(/\.\./g, '')
      .replace(/[<>:"|?*]/g, '')

    // Presigned URL 생성
    const { uploadUrl, publicUrl } = await getPresignedUploadUrl(sanitizedFileName, fileType)

    // contentType도 반환하여 클라이언트가 동일한 타입으로 업로드하도록 함
    return NextResponse.json({ uploadUrl, publicUrl, fileName: sanitizedFileName, contentType: fileType })
  } catch (e) {
    if (e instanceof SessionError) return errorResponse(e.code, e.message)
    console.error('Presign error:', e)
    return errorResponse(ErrorCode.INTERNAL_ERROR, 'Presign failed')
  }
}
