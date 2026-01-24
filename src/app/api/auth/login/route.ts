import { NextRequest, NextResponse } from 'next/server'
import {
  findUserByEmail,
  verifyPassword,
  createUserSessionToken,
  updateLastLogin,
  checkRateLimit,
  recordFailedAttempt,
  clearAttempts,
} from '@/lib/user-auth'
import { logAudit } from '@/lib/audit'
import { supabase } from '@/lib/supabase'
import { ALLOWED_EMAILS } from '@/lib/whitelist'

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  // Rate limiting
  const rateLimit = checkRateLimit(ip)
  if (!rateLimit.allowed) {
    await logAudit({
      action: 'RATE_LIMITED',
      ip,
      userAgent,
    })
    return NextResponse.json({
      error: '너무 많은 로그인 시도가 있었습니다. 잠시 후 다시 시도해주세요.',
      lockoutUntil: rateLimit.lockoutUntil,
    }, { status: 429 })
  }

  try {
    const { email, password, totpCode, rememberMe } = await request.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: '이메일을 입력해주세요.' }, { status: 400 })
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '비밀번호를 입력해주세요.' }, { status: 400 })
    }

    // 허용된 이메일인지 확인
    if (!ALLOWED_EMAILS.has(email.toLowerCase())) {
      return NextResponse.json({ error: '로그인이 허용되지 않은 이메일입니다.' }, { status: 403 })
    }

    // 사용자 조회
    const user = await findUserByEmail(email)
    if (!user || !user.password_hash) {
      recordFailedAttempt(ip)
      await logAudit({
        action: 'LOGIN_FAILED',
        ip,
        userAgent,
        details: { email, reason: 'user_not_found' },
      })
      // 타이밍 공격 방지를 위해 동일한 에러 메시지 사용
      return NextResponse.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 })
    }

    // 비밀번호 검증
    const isPasswordValid = await verifyPassword(password, user.password_hash)
    if (!isPasswordValid) {
      recordFailedAttempt(ip)
      await logAudit({
        action: 'LOGIN_FAILED',
        ip,
        userAgent,
        details: { email, reason: 'invalid_password' },
      })
      return NextResponse.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 })
    }

    // 2FA 확인
    if (user.totp_enabled && user.totp_secret) {
      if (!totpCode) {
        return NextResponse.json({ needsTwoFactor: true })
      }

      // TOTP 검증
      const { OTP } = await import('otplib')
      const otp = new OTP({ strategy: 'totp' })
      const result = otp.verifySync({
        secret: user.totp_secret,
        token: totpCode,
        epochTolerance: 1,
      })

      if (!result.valid) {
        recordFailedAttempt(ip)
        await logAudit({
          action: '2FA_FAILED',
          ip,
          userAgent,
          details: { email },
        })
        return NextResponse.json({
          error: '인증 코드가 올바르지 않습니다.',
          needsTwoFactor: true,
        }, { status: 401 })
      }

      await logAudit({
        action: '2FA_VERIFIED',
        ip,
        userAgent,
      })
    }

    // 로그인 성공
    clearAttempts(ip)

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
    return NextResponse.json({ error: '로그인 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
