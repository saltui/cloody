import { NextRequest, NextResponse } from 'next/server'
import {
  findUserByEmail,
  verifyPassword,
  createUserSessionToken,
  updateLastLogin,
  checkRateLimit,
  recordFailedAttempt,
  clearAttempts,
} from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { getClientIP } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'
import { verifyTotpCode } from '@/lib/totp'

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  // Rate limiting
  const rateLimit = await checkRateLimit(ip)
  if (!rateLimit.allowed) {
    await logAudit({
      action: 'RATE_LIMITED',
      ip,
      userAgent,
    })
    return errorResponse(ErrorCode.RATE_LIMITED, '너무 많은 로그인 시도가 있었습니다. 잠시 후 다시 시도해주세요.', {
      lockoutUntil: rateLimit.lockoutUntil,
    })
  }

  try {
    const { email, password, totpCode, rememberMe } = await request.json()

    if (!email || typeof email !== 'string') {
      return errorResponse(ErrorCode.INVALID_INPUT, '이메일을 입력해주세요.')
    }

    if (!password || typeof password !== 'string') {
      return errorResponse(ErrorCode.INVALID_INPUT, '비밀번호를 입력해주세요.')
    }

    // 사용자 조회
    const user = await findUserByEmail(email)
    if (!user || !user.password_hash) {
      await recordFailedAttempt(ip)
      await logAudit({
        action: 'LOGIN_FAILED',
        ip,
        userAgent,
        details: { email, reason: 'user_not_found' },
      })
      // 타이밍 공격 방지를 위해 동일한 에러 메시지 사용
      return errorResponse(ErrorCode.UNAUTHORIZED, '이메일 또는 비밀번호가 올바르지 않습니다.')
    }

    // 비밀번호 검증
    const isPasswordValid = await verifyPassword(password, user.password_hash)
    if (!isPasswordValid) {
      await recordFailedAttempt(ip)
      await logAudit({
        action: 'LOGIN_FAILED',
        ip,
        userAgent,
        details: { email, reason: 'invalid_password' },
      })
      return errorResponse(ErrorCode.UNAUTHORIZED, '이메일 또는 비밀번호가 올바르지 않습니다.')
    }

    // 2FA 확인
    if (user.totp_enabled && user.totp_secret) {
      if (!totpCode) {
        return NextResponse.json({ needsTwoFactor: true })
      }

      // TOTP 검증
      const isValid = verifyTotpCode(totpCode, user.totp_secret)

      if (!isValid) {
        await recordFailedAttempt(ip)
        await logAudit({
          action: '2FA_FAILED',
          ip,
          userAgent,
          details: { email },
        })
        return errorResponse(ErrorCode.UNAUTHORIZED, '인증 코드가 올바르지 않습니다.', {
          needsTwoFactor: true,
        })
      }

      await logAudit({
        action: '2FA_VERIFIED',
        ip,
        userAgent,
      })
    }

    // 로그인 성공
    await clearAttempts(ip)

    // 마지막 로그인 시간 업데이트
    await updateLastLogin(user.id)

    // 감사 로그
    await logAudit({
      action: 'LOGIN_SUCCESS',
      ip,
      userAgent,
      details: { email },
    })

    // 세션 토큰 생성
    const userForToken = {
      id: user.id,
      email: user.email,
      email_verified: user.email_verified,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      wallet_address: user.wallet_address || null,
      totp_enabled: user.totp_enabled,
      is_admin: user.is_admin,
      created_at: user.created_at,
    }

    const token = createUserSessionToken(userForToken, ip, rememberMe)
    const maxAge = rememberMe ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60 // 기억하기: 30일, 기본: 7일

    const response = NextResponse.json({
      success: true,
      user: userForToken,
    })

    response.cookies.set('gallery_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge,
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    return errorResponse(ErrorCode.INTERNAL_ERROR, '로그인 처리 중 오류가 발생했습니다.')
  }
}
