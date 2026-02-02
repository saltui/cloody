import { NextRequest, NextResponse } from 'next/server'
import { getPresignedUploadUrl } from '@/lib/r2'
import { verifyUserSessionToken, findUserById } from '@/lib/user-auth'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 무제한 스토리지 사용자
const UNLIMITED_STORAGE_EMAILS = new Set([
  'jdnfree@icloud.com',
])

// 일반 사용자 스토리지 제한 (1GB)
const STORAGE_LIMIT = 1 * 1024 * 1024 * 1024

// 최대 파일 크기 (500MB)
const MAX_FILE_SIZE = 500 * 1024 * 1024

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
  'application/x-hwp',
  'application/haansofthwp',
  'application/vnd.hancom.hwp',
  'application/zip',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/octet-stream',
])

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)

  // 사용자 인증 확인
  const sessionCookie = request.cookies.get('gallery_session')
  if (!sessionCookie) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const validation = verifyUserSessionToken(sessionCookie.value, ip)
  if (!validation.valid || !validation.userId) {
    return NextResponse.json({ error: '세션이 만료되었습니다.' }, { status: 401 })
  }

  const user = await findUserById(validation.userId)
  if (!user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 401 })
  }

  try {
    const { fileName, fileType, fileSize } = await request.json()

    if (!fileName || !fileType || !fileSize) {
      return NextResponse.json({ error: 'fileName, fileType, fileSize are required' }, { status: 400 })
    }

    console.log('Presign request:', { fileName, fileType, fileSize, userEmail: user.email })

    // 파일 크기 검증
    if (fileSize > MAX_FILE_SIZE) {
      console.log('Presign rejected: file too large', { fileSize, max: MAX_FILE_SIZE })
      return NextResponse.json({ error: '파일 크기는 500MB를 초과할 수 없습니다.' }, { status: 400 })
    }

    // MIME 타입 검증
    if (!ALLOWED_TYPES.has(fileType)) {
      console.log('Presign rejected: unsupported type', { fileType, allowedTypes: Array.from(ALLOWED_TYPES) })
      return NextResponse.json({ error: `지원하지 않는 파일 형식입니다: ${fileType}` }, { status: 400 })
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
        return NextResponse.json({
          error: `스토리지 용량이 부족합니다. (현재 ${usedGB}GB / ${limitGB}GB 제한)`,
          storageExceeded: true,
          currentUsage,
          limit: STORAGE_LIMIT,
        }, { status: 403 })
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
  } catch (error) {
    console.error('Presign error:', error)
    return NextResponse.json({ error: 'Presign failed' }, { status: 500 })
  }
}
