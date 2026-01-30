import { NextRequest, NextResponse } from 'next/server'
import { getObjectWithRange, uploadToR2 } from '@/lib/r2'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const heicConvert = require('heic-convert')

// HEIC 파일의 썸네일을 서버에서 생성
export async function POST(request: NextRequest) {
  try {
    const { fileName, thumbnailName } = await request.json()

    if (!fileName || !thumbnailName) {
      return NextResponse.json({ error: 'Missing fileName or thumbnailName' }, { status: 400 })
    }

    const response = await getObjectWithRange(fileName)

    if (!response.Body) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // HEIC를 JPEG로 변환
    const arrayBuffer = await response.Body.transformToByteArray()
    const jpegBuffer = await heicConvert({
      buffer: Buffer.from(arrayBuffer),
      format: 'JPEG',
      quality: 0.8,
    })

    // R2에 썸네일 업로드
    const thumbnailUrl = await uploadToR2(
      thumbnailName,
      Buffer.from(jpegBuffer),
      'image/jpeg'
    )

    return NextResponse.json({ thumbnailUrl })
  } catch (error) {
    console.error('HEIC thumbnail generation failed:', error)
    return NextResponse.json({ error: 'Thumbnail generation failed' }, { status: 500 })
  }
}
