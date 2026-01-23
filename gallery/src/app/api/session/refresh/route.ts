import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { refreshSessionToken } from '@/lib/auth'

// 클라이언트 IP 가져오기
function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const currentToken = cookieStore.get('gallery_session')?.value

  if (!currentToken) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }

  const ip = getClientIP(request)
  const newToken = refreshSessionToken(currentToken, ip)

  if (!newToken) {
    cookieStore.delete('gallery_session')
    return NextResponse.json({ error: 'Session invalid' }, { status: 401 })
  }

  cookieStore.set('gallery_session', newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  return NextResponse.json({ success: true })
}
