import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  createSessionToken,
  checkGalleryRateLimit as checkRateLimit,
  recordGalleryFailedAttempt as recordFailedAttempt,
  clearGalleryAttempts as clearAttempts,
} from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { getClientIP } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)

  const userAgent = request.headers.get('user-agent') || undefined

  // Rate limit 확인
  const rateLimit = await checkRateLimit(ip)
  if (!rateLimit.allowed) {
    const retryAfter = Math.ceil(((rateLimit.lockoutUntil ?? Date.now()) - Date.now()) / 1000)
    // 감사 로그
    logAudit({ action: 'RATE_LIMITED', ip, userAgent })
    const rateLimitRes = errorResponse(ErrorCode.RATE_LIMITED, `너무 많은 시도입니다. ${Math.ceil(retryAfter / 60)}분 후에 다시 시도해주세요.`, {
      success: false,
    })
    rateLimitRes.headers.set('Retry-After', retryAfter.toString())
    return rateLimitRes
  }

  try {
    const { password } = await request.json()

    // 비밀번호 검증 (타이밍 공격 방지)
    const expected = process.env.GALLERY_PASSWORD || ''
    const isPasswordValid = password.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected))

    if (isPasswordValid) {
      await clearAttempts(ip) // 성공 시 시도 기록 초기화

      const token = createSessionToken(ip) // IP 바인딩 포함
      const cookieStore = await cookies()

      cookieStore.set('gallery_session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 7, // 7일
        path: '/',
      })

      // 감사 로그 - 로그인 성공
      logAudit({ action: 'LOGIN_SUCCESS', ip, userAgent })

      return NextResponse.json({ success: true })
    }

    // 실패 시 기록
    await recordFailedAttempt(ip)
    const remaining = rateLimit.remainingAttempts - 1

    // 감사 로그 - 로그인 실패
    logAudit({
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      details: { remainingAttempts: remaining }
    })

    return errorResponse(
      ErrorCode.UNAUTHORIZED,
      remaining > 0
        ? `비밀번호가 틀렸습니다. (${remaining}회 남음)`
        : '비밀번호가 틀렸습니다.',
      { success: false }
    )
  } catch (error) {
    console.error('[auth] login POST failed:', error)
    return errorResponse(ErrorCode.INVALID_INPUT, '잘못된 요청입니다.', { success: false })
  }
}

export async function DELETE(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  const cookieStore = await cookies()
  cookieStore.delete('gallery_session')

  // 감사 로그 - 로그아웃
  logAudit({ action: 'LOGOUT', ip, userAgent })

  return NextResponse.json({ success: true })
}
