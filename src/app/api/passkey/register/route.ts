import { NextRequest, NextResponse } from 'next/server'
import { verifyUserSessionToken, findUserById } from '@/lib/user-auth'
import { createRegistrationOptions, verifyRegistration, getUserPasskeys } from '@/lib/passkey'
import { logAudit } from '@/lib/audit'
import { supabase } from '@/lib/supabase'

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

// GET: 패스키 등록 옵션 생성
export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get('gallery_session')
  if (!sessionCookie) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const ip = getClientIP(request)
  const validation = verifyUserSessionToken(sessionCookie.value, ip)
  if (!validation.valid || !validation.userId) {
    return NextResponse.json({ error: '세션이 만료되었습니다.' }, { status: 401 })
  }

  const user = await findUserById(validation.userId)
  if (!user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 401 })
  }

  try {
    const options = await createRegistrationOptions(
      user.id,
      user.email,
      user.display_name || undefined
    )

    return NextResponse.json(options)
  } catch (error) {
    console.error('Passkey registration options error:', error)
    return NextResponse.json({ error: '패스키 등록 옵션 생성에 실패했습니다.' }, { status: 500 })
  }
}

// POST: 패스키 등록 검증
export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get('gallery_session')
  if (!sessionCookie) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined
  const validation = verifyUserSessionToken(sessionCookie.value, ip)
  if (!validation.valid || !validation.userId) {
    return NextResponse.json({ error: '세션이 만료되었습니다.' }, { status: 401 })
  }

  try {
    const { response, name } = await request.json()

    const verification = await verifyRegistration(validation.userId, response, name)

    await logAudit({
      action: 'PASSKEY_REGISTERED',
      ip,
      userAgent,
      details: { userId: validation.userId },
    })

    return NextResponse.json({ success: true, verified: verification.verified })
  } catch (error) {
    console.error('Passkey registration error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : '패스키 등록에 실패했습니다.'
    }, { status: 400 })
  }
}

// DELETE: 패스키 삭제
export async function DELETE(request: NextRequest) {
  const sessionCookie = request.cookies.get('gallery_session')
  if (!sessionCookie) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined
  const validation = verifyUserSessionToken(sessionCookie.value, ip)
  if (!validation.valid || !validation.userId) {
    return NextResponse.json({ error: '세션이 만료되었습니다.' }, { status: 401 })
  }

  try {
    const { passkeyId } = await request.json()

    // 삭제 전에 남은 패스키 개수 확인
    const passkeys = await getUserPasskeys(validation.userId)
    if (passkeys.length <= 1) {
      // 비밀번호가 있는지 확인
      const { data: userWithPassword } = await supabase
        .from('users')
        .select('password_hash')
        .eq('id', validation.userId)
        .single()

      if (!userWithPassword?.password_hash) {
        return NextResponse.json({
          error: '마지막 패스키는 삭제할 수 없습니다. 비밀번호를 먼저 설정해주세요.'
        }, { status: 400 })
      }
    }

    const { deletePasskey } = await import('@/lib/passkey')
    await deletePasskey(validation.userId, passkeyId)

    await logAudit({
      action: 'PASSKEY_DELETED',
      ip,
      userAgent,
      details: { userId: validation.userId, passkeyId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Passkey deletion error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : '패스키 삭제에 실패했습니다.'
    }, { status: 400 })
  }
}
