import { NextRequest, NextResponse } from 'next/server'
import { findUserByEmail, createMagicLinkToken, createUser, checkRateLimit, recordFailedAttempt } from '@/lib/user-auth'
import { sendMagicLinkEmail } from '@/lib/email'
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

  // Rate limiting
  const rateLimit = checkRateLimit(ip)
  if (!rateLimit.allowed) {
    return NextResponse.json({
      error: '너무 많은 요청이 있었습니다. 잠시 후 다시 시도해주세요.',
      lockoutUntil: rateLimit.lockoutUntil,
    }, { status: 429 })
  }

  try {
    const { email, displayName } = await request.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: '이메일을 입력해주세요.' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: '올바른 이메일 형식이 아닙니다.' }, { status: 400 })
    }

    // 허용된 이메일인지 확인
    if (!ALLOWED_EMAILS.has(email.toLowerCase())) {
      return NextResponse.json({ error: '허용되지 않은 이메일입니다.' }, { status: 403 })
    }

    // 사용자 조회 또는 생성
    let user = await findUserByEmail(email)
    let isNewUser = false

    if (!user) {
      // 새 사용자 생성 (비밀번호 없이, displayName 포함)
      const result = await createUser(email, undefined, displayName || undefined)
      if (!result.user) {
        recordFailedAttempt(ip)
        return NextResponse.json({ error: result.error || '계정 생성에 실패했습니다.' }, { status: 400 })
      }
      user = await findUserByEmail(email)
      isNewUser = true
    }

    if (!user) {
      return NextResponse.json({ error: '처리 중 오류가 발생했습니다.' }, { status: 500 })
    }

    // Magic Link 토큰 생성
    const token = await createMagicLinkToken(email)
    if (!token) {
      return NextResponse.json({ error: 'Magic Link 생성에 실패했습니다.' }, { status: 500 })
    }

    // 이메일 발송
    const sent = await sendMagicLinkEmail(email, token, user.display_name)

    if (!sent) {
      // 이메일 설정이 안 되어 있으면 토큰 직접 반환 (개발용)
      if (process.env.NODE_ENV === 'development') {
        return NextResponse.json({
          success: true,
          isNewUser,
          devToken: token, // 개발 환경에서만 토큰 노출
          message: '이메일 설정이 되어 있지 않아 토큰을 직접 반환합니다.',
        })
      }
      return NextResponse.json({ error: '이메일 발송에 실패했습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      isNewUser,
      message: '로그인 링크가 이메일로 전송되었습니다.',
    })
  } catch {
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
