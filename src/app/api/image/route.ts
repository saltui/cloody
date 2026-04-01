import { NextRequest, NextResponse } from 'next/server'
import { getSignedImageUrl } from '@/lib/r2'

// 이 API는 R2 URL을 받아 Signed URL을 반환

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  const session = request.cookies.get('gallery_session')
  if (!userId && !session) {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
  }

  const url = request.nextUrl.searchParams.get('url')

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  }

  try {
    // R2 public URL에서 파일명 추출
    const r2PublicUrl = process.env.R2_PUBLIC_URL
    if (!r2PublicUrl || !url.startsWith(r2PublicUrl)) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    const fileName = url.replace(`${r2PublicUrl}/`, '')
    if (!fileName || fileName.includes('..')) {
      return NextResponse.json({ error: 'Invalid file name' }, { status: 400 })
    }

    // Signed URL 생성 (1시간 유효)
    const signedUrl = await getSignedImageUrl(fileName, 3600)

    return NextResponse.json({ signedUrl })
  } catch (error) {
    console.error('Failed to generate signed URL:', error)
    return NextResponse.json({ error: 'Failed to generate URL' }, { status: 500 })
  }
}

// 여러 URL을 한 번에 처리
export async function POST(request: NextRequest) {
  try {
    const { urls } = await request.json()

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'URLs array is required' }, { status: 400 })
    }

    if (urls.length > 100) {
      return NextResponse.json({ error: 'Too many URLs (max 100)' }, { status: 400 })
    }

    const r2PublicUrl = process.env.R2_PUBLIC_URL
    if (!r2PublicUrl) {
      return NextResponse.json({ error: 'R2 not configured' }, { status: 500 })
    }

    const signedUrls: Record<string, string> = {}

    await Promise.all(
      urls.map(async (url: string) => {
        if (!url.startsWith(r2PublicUrl)) return

        const fileName = url.replace(`${r2PublicUrl}/`, '')
        if (!fileName || fileName.includes('..')) return

        try {
          signedUrls[url] = await getSignedImageUrl(fileName, 3600)
        } catch (error) {
          console.error('[image] getSignedImageUrl failed for', fileName, error)
        }
      })
    )

    return NextResponse.json({ signedUrls })
  } catch (error) {
    console.error('[image] signed URLs POST failed:', error)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
