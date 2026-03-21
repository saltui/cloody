import { NextRequest, NextResponse } from 'next/server'
import { verifyUserSessionToken } from '@/lib/user-auth'
import { getUserPasskeys, renamePasskey } from '@/lib/passkey'
import { getClientIP } from '@/lib/request-utils'

// GET: 사용자의 패스키 목록 조회
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

  try {
    const passkeys = await getUserPasskeys(validation.userId)
    // 민감한 정보 제외하고 반환
    const safePasskeys = passkeys.map(p => ({
      id: p.id,
      name: p.name,
      device_type: p.device_type,
      backed_up: p.backed_up,
      created_at: p.created_at,
      last_used_at: p.last_used_at,
    }))
    return NextResponse.json({ passkeys: safePasskeys })
  } catch (error) {
    console.error('Get passkeys error:', error)
    return NextResponse.json({ error: '패스키 목록을 가져오는데 실패했습니다.' }, { status: 500 })
  }
}

// PATCH: 패스키 이름 변경
export async function PATCH(request: NextRequest) {
  const sessionCookie = request.cookies.get('gallery_session')
  if (!sessionCookie) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const ip = getClientIP(request)
  const validation = verifyUserSessionToken(sessionCookie.value, ip)
  if (!validation.valid || !validation.userId) {
    return NextResponse.json({ error: '세션이 만료되었습니다.' }, { status: 401 })
  }

  try {
    const { passkeyId, name } = await request.json()

    if (!passkeyId || !name) {
      return NextResponse.json({ error: '패스키 ID와 이름이 필요합니다.' }, { status: 400 })
    }

    await renamePasskey(validation.userId, passkeyId, name)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Rename passkey error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : '패스키 이름 변경에 실패했습니다.'
    }, { status: 400 })
  }
}
