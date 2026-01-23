import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import crypto from 'crypto'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

// 공유 링크 생성
export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { photoId, expiresIn } = await request.json()

    if (!photoId) {
      return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
    }

    // 사진이 사용자의 것인지 확인
    const { data: photo, error: photoError } = await supabase
      .from('photos')
      .select('*')
      .eq('id', photoId)
      .eq('user_id', userId)
      .single()

    if (photoError || !photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    // 고유 토큰 생성
    const token = crypto.randomBytes(32).toString('hex')

    // 만료 시간 설정 (기본 7일)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + (expiresIn || 7))

    // 공유 링크 저장
    const { data: shareLink, error: insertError } = await supabase
      .from('share_links')
      .insert({
        token,
        photo_id: photoId,
        user_id: userId,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single()

    if (insertError) {
      console.error('Share link insert error:', insertError)
      return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 })
    }

    const shareUrl = `${APP_URL}/share/${token}`

    return NextResponse.json({
      shareUrl,
      token,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (error) {
    console.error('Share API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
