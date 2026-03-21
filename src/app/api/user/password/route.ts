import { NextRequest, NextResponse } from 'next/server'
import { changePassword } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { getClientIP } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  if (!userId) {
    return errorResponse(ErrorCode.UNAUTHORIZED, '인증이 필요합니다.')
  }

  try {
    const { currentPassword, newPassword } = await request.json()

    if (!currentPassword || !newPassword) {
      return errorResponse(ErrorCode.INVALID_INPUT, '현재 비밀번호와 새 비밀번호를 입력해주세요.')
    }

    if (newPassword.length < 8) {
      return errorResponse(ErrorCode.INVALID_INPUT, '새 비밀번호는 8자 이상이어야 합니다.')
    }

    const result = await changePassword(userId, currentPassword, newPassword)

    if (!result.success) {
      await logAudit({
        action: 'LOGIN_FAILED',
        ip,
        userAgent,
        details: { reason: 'password_change_failed' },
      })
      return errorResponse(ErrorCode.INVALID_INPUT, result.error)
    }

    await logAudit({
      action: 'LOGIN_SUCCESS',
      ip,
      userAgent,
      details: { type: 'password_changed' },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[user] password change failed:', error)
    return errorResponse(ErrorCode.INTERNAL_ERROR, '요청 처리 중 오류가 발생했습니다.')
  }
}
