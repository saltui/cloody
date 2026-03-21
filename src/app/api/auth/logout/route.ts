import { NextRequest, NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { verifyUserSessionToken } from '@/lib/user-auth'
import { getClientIP } from '@/lib/request-utils'

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  // 현재 세션에서 사용자 정보 가져오기
  const sessionCookie = request.cookies.get('gallery_session')
  if (sessionCookie) {
    const validation = verifyUserSessionToken(sessionCookie.value)
    if (validation.valid && validation.email) {
      await logAudit({
        action: 'LOGOUT',
        ip,
        userAgent,
        details: { email: validation.email },
      })
    }
  }

  const response = NextResponse.json({ success: true })

  // 세션 쿠키 삭제
  response.cookies.set('gallery_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  })

  return response
}
