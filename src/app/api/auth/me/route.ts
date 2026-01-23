import { NextRequest, NextResponse } from 'next/server'
import { verifyUserSessionToken, findUserById } from '@/lib/user-auth'

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get('gallery_session')

  if (!sessionCookie) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  const ip = getClientIP(request)
  const validation = verifyUserSessionToken(sessionCookie.value, ip)

  if (!validation.valid || !validation.userId) {
    return NextResponse.json({
      user: null,
      reason: validation.reason,
    }, { status: 401 })
  }

  // 최신 사용자 정보 가져오기
  const user = await findUserById(validation.userId)

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  return NextResponse.json({ user })
}
