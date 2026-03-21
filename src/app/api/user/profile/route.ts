import { NextRequest, NextResponse } from 'next/server'
import { updateUserProfile } from '@/lib/auth'

export async function PATCH(request: NextRequest) {
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  try {
    const { display_name, avatar_url } = await request.json()

    const updates: { display_name?: string; avatar_url?: string } = {}
    if (display_name !== undefined) updates.display_name = display_name
    if (avatar_url !== undefined) updates.avatar_url = avatar_url

    const success = await updateUserProfile(userId, updates)

    if (!success) {
      return NextResponse.json({ error: '프로필 업데이트에 실패했습니다.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
