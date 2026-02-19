import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticationOptions, verifyAuthentication, getPasskeysByEmail, createDiscoverableAuthenticationOptions, verifyDiscoverableAuthentication } from '@/lib/passkey'
import { findUserById, createUserSessionToken, updateLastLogin, checkRateLimit, recordFailedAttempt, clearAttempts } from '@/lib/user-auth'
import { logAudit } from '@/lib/audit'

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

// GET: 패스키 인증 옵션 생성
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')

  try {
    // 이메일 없으면 discoverable 옵션 반환 (이메일 없이 로그인)
    if (!email) {
      const options = await createDiscoverableAuthenticationOptions()
      return NextResponse.json({ options })
    }

    // 먼저 패스키가 있는지 확인
    const passkeys = await getPasskeysByEmail(email)
    if (passkeys.length === 0) {
      return NextResponse.json({ hasPasskey: false })
    }

    const options = await createAuthenticationOptions(email)
    return NextResponse.json({ hasPasskey: true, options })
  } catch (error) {
    console.error('Passkey authentication options error:', error)
    // discoverable 요청 시 에러면 에러 반환
    if (!email) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : '패스키 옵션 생성에 실패했습니다.'
      }, { status: 500 })
    }
    return NextResponse.json({ hasPasskey: false })
  }
}

// POST: 패스키 인증 검증
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
    const { email, response, rememberMe } = await request.json()

    if (!response) {
      return NextResponse.json({ error: '인증 응답이 필요합니다.' }, { status: 400 })
    }

    let result

    // 이메일이 있으면 이메일 기반 인증, 없으면 discoverable 인증
    if (email) {
      result = await verifyAuthentication(email, response)
    } else {
      // Discoverable 인증 (이메일 없이)
      result = await verifyDiscoverableAuthentication(response)
    }

    if (!result.verified) {
      recordFailedAttempt(ip)
      await logAudit({
        action: 'LOGIN_FAILED',
        ip,
        userAgent,
        details: { email, reason: 'passkey_verification_failed' },
      })
      return NextResponse.json({ error: '패스키 인증에 실패했습니다.' }, { status: 401 })
    }

    // 로그인 성공
    clearAttempts(ip)

    const user = await findUserById(result.userId)
    if (!user) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 401 })
    }

    // 마지막 로그인 시간 업데이트
    await updateLastLogin(user.id)

    // 감사 로그
    await logAudit({
      action: 'LOGIN_SUCCESS',
      ip,
      userAgent,
      details: { email, type: 'passkey' },
    })

    // 세션 토큰 생성
    const userForToken = {
      id: user.id,
      email: user.email,
      email_verified: user.email_verified,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      wallet_address: user.wallet_address,
      totp_enabled: user.totp_enabled,
      is_admin: user.is_admin,
      created_at: user.created_at,
    }

    const token = createUserSessionToken(userForToken, ip, rememberMe)
    const maxAge = rememberMe ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60

    const res = NextResponse.json({
      success: true,
      user: userForToken,
    })

    res.cookies.set('gallery_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge,
      path: '/',
    })

    return res
  } catch (error) {
    console.error('Passkey authentication error:', error)
    recordFailedAttempt(ip)
    await logAudit({
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      details: { reason: 'passkey_error', error: String(error) },
    })
    return NextResponse.json({
      error: error instanceof Error ? error.message : '패스키 인증에 실패했습니다.'
    }, { status: 401 })
  }
}
