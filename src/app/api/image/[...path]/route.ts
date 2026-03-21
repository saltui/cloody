import { NextRequest, NextResponse } from 'next/server'
import { getObjectMetadata, getObjectWithRange, uploadToR2 } from '@/lib/r2'
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

    if (!fileName || fileName.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
    }

    const rangeHeader = request.headers.get('range')

    // Range 요청이 있는 경우 (동영상 스트리밍)
    if (rangeHeader) {
      const metadata = await getObjectMetadata(fileName)
      const fileSize = metadata.ContentLength || 0
      const contentType = metadata.ContentType || 'application/octet-stream'

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

      return new NextResponse(stream, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': chunkSize.toString(),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }

    // HEIC 파일인 경우 캐시 확인 후 변환
    if (isHeicFile(fileName)) {
      const cachedKey = `converted/${fileName}.jpg`

      // 캐시된 JPEG 버전 확인
      try {
        const cached = await getObjectWithRange(cachedKey)
        if (cached.Body) {
          const stream = cached.Body.transformToWebStream()
          return new NextResponse(stream, {
            headers: {
              'Content-Type': 'image/jpeg',
              'Content-Length': (cached.ContentLength || 0).toString(),
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          })
        }
      } catch {
        // 캐시 미스 — 원본 다운로드 후 변환
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
        // 변환 실패 시 원본 반환 (fall through은 불가 — Body가 이미 소비됨)
        return NextResponse.json({ error: 'HEIC conversion failed' }, { status: 500 })
      }
    }

    // Range 요청이 없는 경우 (일반 이미지/파일)
    const response = await getObjectWithRange(fileName)

    if (!response.Body) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const contentType = response.ContentType || 'application/octet-stream'
    const contentLength = response.ContentLength || 0
    const stream = response.Body.transformToWebStream()

    return new NextResponse(stream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': contentLength.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('Image proxy error:', error)
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 })
  }
}
