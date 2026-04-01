import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

// 공유 링크로 사진 정보 가져오기 (공개 - 인증 불필요)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    // 공유 링크 조회
    const { data: shareLink, error: shareLinkError } = await supabase
      .from('share_links')
      .select('*, photos(*)')
      .eq('token', token)
      .single()

    if (shareLinkError || !shareLink) {
      return NextResponse.json({ error: 'Share link not found' }, { status: 404 })
    }

    // 만료 확인
    if (new Date(shareLink.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Share link has expired' }, { status: 410 })
    }

    // 조회수 증가
    await supabase
      .from('share_links')
      .update({ view_count: (shareLink.view_count || 0) + 1 })
      .eq('id', shareLink.id)

    const photo = shareLink.photos

    return NextResponse.json({
      photo: {
        id: photo.id,
        name: photo.name,
        url: photo.url,
        thumbnail_url: photo.thumbnail_url,
        created_at: photo.created_at,
      },
      expiresAt: shareLink.expires_at,
    })
  } catch (error) {
    console.error('Share GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
