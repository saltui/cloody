import { NextRequest, NextResponse } from 'next/server'
import { refreshUserSessionToken, verifyUserSessionToken, checkSessionRevocation } from '@/lib/auth'
import { getClientIP } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

export async function POST(request: NextRequest) {
  const currentToken = request.cookies.get('gallery_session')?.value

  if (!currentToken) {
    return errorResponse(ErrorCode.UNAUTHORIZED, 'No session')
  }

  const ip = getClientIP(request)

  // Revocation 체크: 취소된 세션은 갱신 불가
  const validation = verifyUserSessionToken(currentToken, ip)
  if (validation.valid && validation.sessionId && validation.userId && validation.createdAt) {
    const isRevoked = await checkSessionRevocation(validation.sessionId, validation.userId, validation.createdAt)
    if (isRevoked) {
      const response = errorResponse(ErrorCode.SESSION_EXPIRED, 'Session revoked')
      response.cookies.delete('gallery_session')
      return response
    }
  }

  const newToken = refreshUserSessionToken(currentToken, ip)

  if (!newToken) {
    const response = errorResponse(ErrorCode.SESSION_EXPIRED, 'Session invalid')
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
