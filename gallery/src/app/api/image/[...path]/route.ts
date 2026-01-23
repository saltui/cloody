import { NextRequest, NextResponse } from 'next/server'
import { r2Client, BUCKET_NAME } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'

// 이미지 프록시 - R2에서 직접 가져와서 전달
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

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
    })

    const response = await r2Client.send(command)

    if (!response.Body) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Stream을 ArrayBuffer로 변환
    const chunks: Uint8Array[] = []
    const reader = response.Body.transformToWebStream().getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const buffer = Buffer.concat(chunks)

    // Content-Type 설정
    const contentType = response.ContentType || 'application/octet-stream'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': buffer.length.toString(),
      },
    })
  } catch (error) {
    console.error('Image proxy error:', error)
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 })
  }
}
