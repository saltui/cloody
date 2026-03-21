import { NextRequest, NextResponse } from 'next/server'
import { updateUserProfile } from '@/lib/auth'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

export async function PATCH(request: NextRequest) {
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return errorResponse(ErrorCode.UNAUTHORIZED, '인증이 필요합니다.')
  }

  try {
    const { display_name, avatar_url } = await request.json()

    const updates: { display_name?: string; avatar_url?: string } = {}
    if (display_name !== undefined) updates.display_name = display_name
    if (avatar_url !== undefined) updates.avatar_url = avatar_url

    const success = await updateUserProfile(userId, updates)

    if (!success) {
      return errorResponse(ErrorCode.INTERNAL_ERROR, '프로필 업데이트에 실패했습니다.')
    }

    return NextResponse.json({ success: true })
  } catch {
    return errorResponse(ErrorCode.INTERNAL_ERROR, '요청 처리 중 오류가 발생했습니다.')
  }
}
