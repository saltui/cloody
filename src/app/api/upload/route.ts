import { NextRequest, NextResponse } from 'next/server'
import { uploadToR2 } from '@/lib/r2'
import { logAudit } from '@/lib/audit'

// 클라이언트 IP 가져오기
function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

// Magic bytes로 파일 타입 검증
const FILE_SIGNATURES: Record<string, { bytes: number[]; offset?: number }[]> = {
  // 이미지
  'image/jpeg': [{ bytes: [0xFF, 0xD8, 0xFF] }],
  'image/png': [{ bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }],
  'image/gif': [{ bytes: [0x47, 0x49, 0x46, 0x38] }], // GIF87a, GIF89a
  'image/webp': [{ bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }],
  'image/bmp': [{ bytes: [0x42, 0x4D] }],
  'image/heic': [{ bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }], // ftyp
  'image/heif': [{ bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }],

  // 비디오
  'video/mp4': [{ bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }], // ftyp
  'video/quicktime': [{ bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }],
  'video/webm': [{ bytes: [0x1A, 0x45, 0xDF, 0xA3] }],
  'video/x-msvideo': [{ bytes: [0x52, 0x49, 0x46, 0x46] }], // AVI
  'video/x-matroska': [{ bytes: [0x1A, 0x45, 0xDF, 0xA3] }], // MKV
}

// 허용된 MIME 타입
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/x-matroska',
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

// 최대 파일 크기 (100MB)
const MAX_FILE_SIZE = 100 * 1024 * 1024

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const fileName = formData.get('fileName') as string

    if (!file || !fileName) {
      return NextResponse.json({ error: 'File and fileName are required' }, { status: 400 })
    }

    // 파일 크기 검증
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: '파일 크기는 100MB를 초과할 수 없습니다.' }, { status: 400 })
    }

    // MIME 타입 검증
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: '허용되지 않는 파일 형식입니다.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // Magic bytes로 실제 파일 타입 검증
    const detectedType = detectFileType(buffer)
    if (!detectedType) {
      return NextResponse.json({ error: '파일 형식을 확인할 수 없습니다.' }, { status: 400 })
    }

    // 선언된 타입과 실제 타입이 다르면 거부
    // (이미지/비디오 카테고리는 맞아야 함)
    const declaredCategory = file.type.split('/')[0]
    const detectedCategory = detectedType.split('/')[0]
    if (declaredCategory !== detectedCategory) {
      return NextResponse.json({
        error: '파일 형식이 일치하지 않습니다. 위조된 파일일 수 있습니다.'
      }, { status: 400 })
    }

    // 파일명에서 위험한 문자 제거
    const sanitizedFileName = fileName
      .replace(/\.\./g, '') // path traversal 방지
      .replace(/[<>:"|?*]/g, '') // 특수문자 제거

    const url = await uploadToR2(sanitizedFileName, buffer, detectedType)

    // 감사 로그 - 파일 업로드
    logAudit({
      action: 'UPLOAD',
      ip,
      userAgent,
      details: {
        fileName: sanitizedFileName,
        fileType: detectedType,
        fileSize: file.size
      }
    })

    return NextResponse.json({ url })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
