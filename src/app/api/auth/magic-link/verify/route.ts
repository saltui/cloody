import { NextRequest, NextResponse } from 'next/server'
import { verifyMagicLinkToken, createUserSessionToken, updateLastLogin } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { getClientIP } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

export async function GET(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    return errorResponse(ErrorCode.INVALID_INPUT, '유효하지 않은 링크입니다.')
  }

  try {
    const user = await verifyMagicLinkToken(token)

    if (!user) {
      await logAudit({
        action: 'LOGIN_FAILED',
        ip,
        userAgent,
        details: { reason: 'invalid_magic_link' },
      })
      return errorResponse(ErrorCode.INVALID_INPUT, '만료되었거나 유효하지 않은 링크입니다.', {
        expired: true,
      })
    }

    // 마지막 로그인 시간 업데이트
    await updateLastLogin(user.id)

    // 감사 로그
    await logAudit({
      action: 'LOGIN_SUCCESS',
      ip,
      userAgent,
      details: { email: user.email, type: 'magic_link' },
    })

    // 세션 토큰 생성
    const sessionToken = createUserSessionToken(user, ip, true) // Magic Link는 30일 세션

    const response = NextResponse.json({
      success: true,
      user,
    })

    response.cookies.set('gallery_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60, // 30일
      path: '/',
    })

    return response
  } catch (error) {
    console.error('[auth] magic-link verify GET failed:', error)
    return errorResponse(ErrorCode.INTERNAL_ERROR, '처리 중 오류가 발생했습니다.')
  }
}
