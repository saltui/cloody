import { NextRequest, NextResponse } from 'next/server'
import { createUser, createUserSessionToken, checkRateLimit, recordFailedAttempt } from '@/lib/auth'
import { sendVerificationEmail } from '@/lib/email'
import { logAudit } from '@/lib/audit'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { getClientIP } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  // Rate limiting
  const rateLimit = await checkRateLimit(ip)
  if (!rateLimit.allowed) {
    return errorResponse(ErrorCode.RATE_LIMITED, '너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요.', {
      lockoutUntil: rateLimit.lockoutUntil,
    })
  }

  try {
    const { email, password, displayName } = await request.json()

    // 유효성 검사
    if (!email || typeof email !== 'string') {
      return errorResponse(ErrorCode.INVALID_INPUT, '이메일을 입력해주세요.')
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return errorResponse(ErrorCode.INVALID_INPUT, '올바른 이메일 형식이 아닙니다.')
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return errorResponse(ErrorCode.INVALID_INPUT, '비밀번호는 8자 이상이어야 합니다.')
    }

    // 사용자 생성
    const { user, error } = await createUser(email, password, displayName)

    if (error || !user) {
      await recordFailedAttempt(ip)
      return errorResponse(ErrorCode.INVALID_INPUT, error || '계정 생성에 실패했습니다.')
    }

    // 이메일 인증 토큰 가져오기
    const { data: userData } = await supabase
      .from('users')
      .select('email_verification_token')
      .eq('id', user.id)
      .single()

    // 인증 이메일 발송
    if (userData?.email_verification_token) {
      await sendVerificationEmail(email, userData.email_verification_token, displayName)
    }

    // 세션 토큰 생성 (이메일 미인증 상태로 로그인)
    const token = createUserSessionToken(user, ip)

    // 감사 로그
    await logAudit({
      action: 'LOGIN_SUCCESS',
      ip,
      userAgent,
      details: { type: 'register', email },
    })

    const response = NextResponse.json({
      success: true,
      user,
      emailVerificationRequired: true,
    })

    response.cookies.set('gallery_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60, // 1일
      path: '/',
    })

    return response
  } catch (error) {
    console.error('[auth] register POST failed:', error)
    return errorResponse(ErrorCode.INTERNAL_ERROR, '요청 처리 중 오류가 발생했습니다.')
  }
}
