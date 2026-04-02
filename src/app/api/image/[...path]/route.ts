import { NextRequest, NextResponse } from 'next/server'
import { getObjectMetadata, getObjectWithRange, uploadToR2 } from '@/lib/r2'
import { verifyUserSessionToken } from '@/lib/auth'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { getClientIP } from '@/lib/request-utils'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const heicConvert = require('heic-convert')

// HEIC 파일인지 확인
function isHeicFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext === 'heic' || ext === 'heif'
}

// 이미지/비디오 프록시 - Range 요청 지원 + HEIC 변환
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params
    const fileName = path.join('/')

    if (!fileName || fileName.includes('..') || !/^[a-zA-Z0-9/_\-.\s]+$/.test(fileName)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
    }

    // 접근 권한 확인: 인증된 유저는 자기 파일만, share token은 해당 공유 파일만
    const sessionCookie = request.cookies.get('gallery_session')?.value
    const shareToken = request.nextUrl.searchParams.get('share')
    const ip = getClientIP(request)

    let authorized = false

    if (sessionCookie) {
      const session = verifyUserSessionToken(sessionCookie, ip)
      if (session.valid && session.userId) {
        // 유저 소유 파일인지 확인
        const { count } = await supabase
          .from('photos')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', session.userId)
          .like('url', `%${fileName}`)

        authorized = (count || 0) > 0
      }
    }

    if (!authorized && shareToken) {
      // share link를 통한 접근 확인
      const { data: link } = await supabase
        .from('share_links')
        .select('folder_id, user_id')
        .eq('token', shareToken)
        .gt('expires_at', new Date().toISOString())
        .single()

      if (link) {
        authorized = true
      }
    }

    // HLS 세그먼트 파일은 인증된 세션이 있으면 허용 (플레이어 호환성)
    if (!authorized && sessionCookie && (fileName.endsWith('.m3u8') || fileName.endsWith('.ts'))) {
      const session = verifyUserSessionToken(sessionCookie, ip)
      if (session.valid) authorized = true
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rangeHeader = request.headers.get('range')

    // Range 요청이 있는 경우 (동영상 스트리밍)
    if (rangeHeader) {
      const metadata = await getObjectMetadata(fileName)
      const fileSize = metadata.ContentLength || 0
      const contentType = metadata.ContentType || 'application/octet-stream'
      const etag = metadata.ETag

      const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/)
      if (!rangeMatch) {
        return NextResponse.json({ error: 'Invalid range header' }, { status: 400 })
      }

      const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1

      if (start >= fileSize || end >= fileSize || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${fileSize}` },
        })
      }

      const chunkSize = end - start + 1
      const response = await getObjectWithRange(fileName, `bytes=${start}-${end}`)

      if (!response.Body) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      const stream = response.Body.transformToWebStream()

      const rangeHeaders: Record<string, string> = {
        'Content-Type': contentType,
        'Content-Length': chunkSize.toString(),
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
      }
      if (etag) rangeHeaders['ETag'] = etag

      return new NextResponse(stream, {
        status: 206,
        headers: rangeHeaders,
      })
    }

    // HEIC 파일인 경우 캐시 확인 후 변환
    if (isHeicFile(fileName)) {
      const cachedKey = `converted/${fileName}.jpg`

      // 캐시된 JPEG 버전 확인
      try {
        const cached = await getObjectWithRange(cachedKey)
        if (cached.Body) {
          // ETag 조건부 요청 처리 (캐시된 버전)
          let cachedEtag: string | undefined
          try {
            const cachedMeta = await getObjectMetadata(cachedKey)
            cachedEtag = cachedMeta.ETag
          } catch (error) {
            console.error('[image-proxy] ETag metadata lookup failed:', error)
          }

          if (cachedEtag && request.headers.get('if-none-match') === cachedEtag) {
            return new NextResponse(null, { status: 304 })
          }

          const stream = cached.Body.transformToWebStream()
          const cachedHeaders: Record<string, string> = {
            'Content-Type': 'image/jpeg',
            'Content-Length': (cached.ContentLength || 0).toString(),
            'Cache-Control': 'public, max-age=31536000, immutable',
          }
          if (cachedEtag) cachedHeaders['ETag'] = cachedEtag

          return new NextResponse(stream, { headers: cachedHeaders })
        }
      } catch (error) {
        console.error('[image-proxy] HEIC cache miss or R2 error:', error)
      }

      // 원본 다운로드 및 변환
      const response = await getObjectWithRange(fileName)

      if (!response.Body) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      try {
        const arrayBuffer = await response.Body.transformToByteArray()
        const jpegBuffer = await heicConvert({
          buffer: Buffer.from(arrayBuffer),
          format: 'JPEG',
          quality: 0.9,
        })

        // Fire-and-forget: 변환된 버전을 R2에 캐싱
        uploadToR2(cachedKey, Buffer.from(jpegBuffer), 'image/jpeg').catch((err) =>
          console.error('[image-proxy] Failed to cache HEIC conversion:', err)
        )

        return new NextResponse(new Uint8Array(jpegBuffer), {
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': jpegBuffer.length.toString(),
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        })
      } catch (heicError) {
        console.error('[image-proxy] HEIC conversion failed:', heicError)
        // 변환 실패 시 원본 재다운로드하여 반환 (Body가 이미 소비되었으므로)
        try {
          const fallback = await getObjectWithRange(fileName)
          if (fallback.Body) {
            const stream = fallback.Body.transformToWebStream()
            return new NextResponse(stream, {
              headers: {
                'Content-Type': fallback.ContentType || 'application/octet-stream',
                'Content-Length': (fallback.ContentLength || 0).toString(),
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            })
          }
        } catch (fallbackError) {
          console.error('[image-proxy] Fallback fetch also failed:', fallbackError)
        }
        return NextResponse.json({ error: 'HEIC conversion failed' }, { status: 500 })
      }
    }

    // Range 요청이 없는 경우 (일반 이미지/파일)
    // ETag 기반 조건부 요청 처리
    const metadata = await getObjectMetadata(fileName)
    const etag = metadata.ETag

    if (etag && request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304 })
    }

    const response = await getObjectWithRange(fileName)

    if (!response.Body) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const contentType = response.ContentType || 'application/octet-stream'
    const contentLength = response.ContentLength || 0
    const stream = response.Body.transformToWebStream()

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': contentLength.toString(),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }
    if (etag) headers['ETag'] = etag

    return new NextResponse(stream, { headers })
  } catch (error) {
    console.error('Image proxy error:', error)
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 })
  }
}
