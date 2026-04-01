import { NextRequest, NextResponse } from 'next/server'
import { findUserByEmail, createMagicLinkToken, createUser, checkRateLimit, recordFailedAttempt } from '@/lib/auth'
import { sendMagicLinkEmail } from '@/lib/email'
import { logAudit } from '@/lib/audit'
import { getClientIP } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  // Rate limiting
  const rateLimit = checkRateLimit(ip)
  if (!rateLimit.allowed) {
    return errorResponse(ErrorCode.RATE_LIMITED, '너무 많은 요청이 있었습니다. 잠시 후 다시 시도해주세요.', {
      lockoutUntil: rateLimit.lockoutUntil,
    })
  }

  try {
    const { email, displayName } = await request.json()

    if (!email || typeof email !== 'string') {
      return errorResponse(ErrorCode.INVALID_INPUT, '이메일을 입력해주세요.')
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return errorResponse(ErrorCode.INVALID_INPUT, '올바른 이메일 형식이 아닙니다.')
    }

    // 사용자 조회 또는 생성
    let user = await findUserByEmail(email)
    let isNewUser = false

    if (!user) {
      // 새 사용자 생성 (비밀번호 없이, displayName 포함)
      const result = await createUser(email, undefined, displayName || undefined)
      if (!result.user) {
        recordFailedAttempt(ip)
        return errorResponse(ErrorCode.INVALID_INPUT, result.error || '계정 생성에 실패했습니다.')
      }
      user = await findUserByEmail(email)
      isNewUser = true
    }

    if (!user) {
      return errorResponse(ErrorCode.INTERNAL_ERROR, '처리 중 오류가 발생했습니다.')
    }

    // Magic Link 토큰 생성
    const token = await createMagicLinkToken(email)
    if (!token) {
      return errorResponse(ErrorCode.INTERNAL_ERROR, 'Magic Link 생성에 실패했습니다.')
    }

    // 이메일 발송
    const sent = await sendMagicLinkEmail(email, token, user.display_name)

    if (!sent) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[auth] Dev magic-link token (check server logs):', token)
        return NextResponse.json({
          success: true,
          isNewUser,
          message: '이메일 설정이 되어 있지 않습니다. 서버 로그를 확인하세요.',
        })
      }
      return errorResponse(ErrorCode.INTERNAL_ERROR, '이메일 발송에 실패했습니다.')
    }

    return NextResponse.json({
      success: true,
      isNewUser,
      message: '로그인 링크가 이메일로 전송되었습니다.',
    })
  } catch (error) {
    console.error('[auth] magic-link POST failed:', error)
    return errorResponse(ErrorCode.INTERNAL_ERROR, '요청 처리 중 오류가 발생했습니다.')
  }
}
