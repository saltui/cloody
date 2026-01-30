import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticationOptions, verifyAuthentication, getPasskeysByEmail } from '@/lib/passkey'
import { verifyUserSessionToken, findUserById } from '@/lib/user-auth'
import { logAudit } from '@/lib/audit'

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

// GET: Vault 접근용 패스키 인증 옵션 생성
export async function GET(request: NextRequest) {
  const ip = getClientIP(request)

  // 세션 확인
  const sessionCookie = request.cookies.get('gallery_session')
  if (!sessionCookie?.value) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const validation = verifyUserSessionToken(sessionCookie.value, ip)
  if (!validation.valid || !validation.userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  try {
    const user = await findUserById(validation.userId)
    if (!user) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 401 })
    }

    // 사용자의 패스키 확인
    const passkeys = await getPasskeysByEmail(user.email)
    if (passkeys.length === 0) {
      return NextResponse.json({ hasPasskey: false })
    }

    const options = await createAuthenticationOptions(user.email)
    return NextResponse.json({ hasPasskey: true, options })
  } catch (error) {
    console.error('Vault passkey options error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : '패스키 옵션 생성에 실패했습니다.'
    }, { status: 500 })
  }
}

// POST: Vault 접근용 패스키 인증 검증
export async function POST(request: NextRequest) {
  const ip = getClientIP(request)

  // 세션 확인
  const sessionCookie = request.cookies.get('gallery_session')
  if (!sessionCookie?.value) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const validation = verifyUserSessionToken(sessionCookie.value, ip)
  if (!validation.valid || !validation.userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  try {
    const user = await findUserById(validation.userId)
    if (!user) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 401 })
    }

    const { response } = await request.json()

    if (!response) {
      return NextResponse.json({ error: '인증 응답이 필요합니다.' }, { status: 400 })
    }

    const result = await verifyAuthentication(user.email, response)

    if (!result.verified) {
      await logAudit({
        action: 'VAULT_AUTH_FAILED',
        ip,
        userAgent: request.headers.get('user-agent') || undefined,
        details: { reason: 'passkey_verification_failed', userId: user.id },
      })
      return NextResponse.json({ error: '패스키 인증에 실패했습니다.' }, { status: 401 })
    }

    await logAudit({
      action: 'VAULT_AUTH_SUCCESS',
      ip,
      userAgent: request.headers.get('user-agent') || undefined,
      details: { userId: user.id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Vault passkey verification error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : '패스키 인증에 실패했습니다.'
    }, { status: 401 })
  }
}
