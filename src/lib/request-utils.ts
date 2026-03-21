import { NextRequest } from 'next/server'
import { verifyUserSessionToken } from './user-auth'
import { ErrorCode } from './errors'

export function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

export class SessionError extends Error {
  constructor(public code: ErrorCode, message?: string) {
    super(message)
  }
}

export function requireSession(request: NextRequest): {
  userId: string
  ip: string
  userAgent: string
} {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || ''
  const sessionCookie = request.cookies.get('gallery_session')

  if (!sessionCookie) {
    throw new SessionError(ErrorCode.UNAUTHORIZED)
  }

  const validation = verifyUserSessionToken(sessionCookie.value, ip)
  if (!validation.valid || !validation.userId) {
    throw new SessionError(ErrorCode.SESSION_EXPIRED, validation.reason)
  }

  return { userId: validation.userId, ip, userAgent }
}
