import { NextRequest, NextResponse } from 'next/server'
import { getObjectWithRange } from '@/lib/r2'
import { uploadToR2 } from '@/lib/r2'
import sharp from 'sharp'

// HEIC 파일의 썸네일을 서버에서 생성 (sharp 사용 - 빠름)
export async function POST(request: NextRequest) {
  try {
    const { fileName, thumbnailName } = await request.json()

    if (!fileName || !thumbnailName) {
      return NextResponse.json({ error: 'Missing fileName or thumbnailName' }, { status: 400 })
    }

    // R2에서 원본 HEIC 파일 가져오기
    const response = await getObjectWithRange(fileName)

    if (!response.Body) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // HEIC를 JPEG로 변환 + 썸네일 리사이즈 (sharp 사용)
    const arrayBuffer = await response.Body.transformToByteArray()
    const jpegBuffer = await sharp(Buffer.from(arrayBuffer))
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()

    // R2에 썸네일 업로드
    const thumbnailUrl = await uploadToR2(
      thumbnailName,
      jpegBuffer,
      'image/jpeg'
    )

    return NextResponse.json({ thumbnailUrl })
  } catch (error) {
    console.error('HEIC thumbnail generation failed:', error)
    return NextResponse.json({ error: 'Thumbnail generation failed' }, { status: 500 })
  }
}
