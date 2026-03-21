import { NextRequest, NextResponse } from 'next/server'
import { refreshUserSessionToken } from '@/lib/auth'
import { getClientIP } from '@/lib/request-utils'

export async function POST(request: NextRequest) {
  const currentToken = request.cookies.get('gallery_session')?.value

  if (!currentToken) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }

  const ip = getClientIP(request)
  const newToken = refreshUserSessionToken(currentToken, ip)

  if (!newToken) {
    const response = NextResponse.json({ error: 'Session invalid' }, { status: 401 })
    response.cookies.delete('gallery_session')
    return response
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set('gallery_session', newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  return response
}
