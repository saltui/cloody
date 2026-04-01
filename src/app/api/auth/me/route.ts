import { NextRequest, NextResponse } from 'next/server'
import { refreshUserSessionToken, findUserById } from '@/lib/auth'
import { requireSession, SessionError, getClientIP } from '@/lib/request-utils'

export async function GET(request: NextRequest) {
  const ip = getClientIP(request)

  let userId: string
  try {
    const session = await requireSession(request)
    userId = session.userId
  } catch (e) {
    if (e instanceof SessionError) {
      return NextResponse.json({ user: null, reason: e.message }, { status: 401 })
    }
    return NextResponse.json({ user: null }, { status: 401 })
  }

  // 최신 사용자 정보 가져오기
  const user = await findUserById(userId)

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  const response = NextResponse.json({ user })
  const sessionCookie = request.cookies.get('gallery_session')
  if (sessionCookie) {
    const refreshedToken = refreshUserSessionToken(sessionCookie.value, ip)
    if (refreshedToken) {
      response.cookies.set('gallery_session', refreshedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60,
        path: '/',
      })
    }
  }

  return response
}
