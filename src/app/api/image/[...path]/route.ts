import { NextRequest, NextResponse } from 'next/server'
import { getObjectMetadata, getObjectWithRange } from '@/lib/r2'
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
      // 먼저 파일 메타데이터 가져오기
      const metadata = await getObjectMetadata(fileName)
      const fileSize = metadata.ContentLength || 0
      const contentType = metadata.ContentType || 'application/octet-stream'

      // Range 헤더 파싱 (예: "bytes=0-1023")
      const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/)
      if (!rangeMatch) {
        return NextResponse.json({ error: 'Invalid range header' }, { status: 400 })
      }

      const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1

      // 유효한 범위인지 확인
      if (start >= fileSize || end >= fileSize || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            'Content-Range': `bytes */${fileSize}`,
          },
        })
      }

      const chunkSize = end - start + 1

      // Range 요청으로 파일 가져오기
      const response = await getObjectWithRange(fileName, `bytes=${start}-${end}`)

      if (!response.Body) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      // 스트림으로 직접 반환 (메모리 효율적)
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

    // Range 요청이 없는 경우 (일반 이미지)
    const response = await getObjectWithRange(fileName)

    if (!response.Body) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // HEIC 파일인 경우 JPEG로 변환
    if (isHeicFile(fileName)) {
      try {
        const arrayBuffer = await response.Body.transformToByteArray()
        const jpegBuffer = await heicConvert({
          buffer: Buffer.from(arrayBuffer),
          format: 'JPEG',
          quality: 0.9,
        })

        return new NextResponse(jpegBuffer, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': jpegBuffer.length.toString(),
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        })
      } catch (heicError) {
        console.error('HEIC conversion failed:', heicError)
        // 변환 실패시 원본 반환 시도
      }
    }

    const contentType = response.ContentType || 'application/octet-stream'
    const contentLength = response.ContentLength || 0

    // 스트림으로 직접 반환
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
