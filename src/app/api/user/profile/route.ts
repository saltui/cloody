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

    // Input validation
    if (display_name !== undefined) {
      if (typeof display_name !== 'string' || display_name.trim().length > 100) {
        return errorResponse(ErrorCode.INVALID_INPUT, '표시 이름은 100자 이내여야 합니다.')
      }
    }
    if (avatar_url !== undefined && avatar_url !== null && avatar_url !== '') {
      if (typeof avatar_url !== 'string' || avatar_url.length > 500) {
        return errorResponse(ErrorCode.INVALID_INPUT, '아바타 URL은 500자 이내여야 합니다.')
      }
      if (!avatar_url.startsWith('http://') && !avatar_url.startsWith('https://')) {
        return errorResponse(ErrorCode.INVALID_INPUT, '아바타 URL은 http:// 또는 https://로 시작해야 합니다.')
      }
    }

    const updates: { display_name?: string; avatar_url?: string } = {}
    if (display_name !== undefined) updates.display_name = display_name.trim()
    if (avatar_url !== undefined) updates.avatar_url = avatar_url

    const success = await updateUserProfile(userId, updates)

    if (!success) {
      return errorResponse(ErrorCode.INTERNAL_ERROR, '프로필 업데이트에 실패했습니다.')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[user] profile update failed:', error)
    return errorResponse(ErrorCode.INTERNAL_ERROR, '요청 처리 중 오류가 발생했습니다.')
  }
}
