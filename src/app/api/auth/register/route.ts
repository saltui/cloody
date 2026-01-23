import { NextRequest, NextResponse } from 'next/server'
import { createUser, createUserSessionToken, checkRateLimit, recordFailedAttempt } from '@/lib/user-auth'
import { sendVerificationEmail } from '@/lib/email'
import { logAudit } from '@/lib/audit'
import { supabase } from '@/lib/supabase'

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
    return NextResponse.json({
      error: '너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요.',
      lockoutUntil: rateLimit.lockoutUntil,
    }, { status: 429 })
  }

  try {
    const { email, password, displayName } = await request.json()

    // 유효성 검사
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: '이메일을 입력해주세요.' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: '올바른 이메일 형식이 아닙니다.' }, { status: 400 })
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 })
    }

    // 사용자 생성
    const { user, error } = await createUser(email, password, displayName)

    if (error || !user) {
      recordFailedAttempt(ip)
      return NextResponse.json({ error: error || '계정 생성에 실패했습니다.' }, { status: 400 })
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
  } catch {
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
