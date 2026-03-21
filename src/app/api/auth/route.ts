import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  createSessionToken,
  checkRateLimit,
  recordFailedAttempt,
  clearAttempts
} from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { is2FAEnabled, verifyTotpCode } from '@/lib/totp'
import { getClientIP } from '@/lib/request-utils'

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)

  const userAgent = request.headers.get('user-agent') || undefined

  // Rate limit 확인
  const rateLimit = checkRateLimit(ip)
  if (!rateLimit.allowed) {
    const retryAfter = Math.ceil(((rateLimit.lockoutUntil ?? Date.now()) - Date.now()) / 1000)
    // 감사 로그
    logAudit({ action: 'RATE_LIMITED', ip, userAgent })
    return NextResponse.json(
      {
        success: false,
        error: `너무 많은 시도입니다. ${Math.ceil(retryAfter / 60)}분 후에 다시 시도해주세요.`
      },
      {
        status: 429,
        headers: { 'Retry-After': retryAfter.toString() }
      }
    )
  }

  try {
    const { password, totpCode } = await request.json()

    // 비밀번호 검증 (타이밍 공격 방지를 위해 일정 시간 대기)
    const isPasswordValid = password === process.env.GALLERY_PASSWORD

    // 약간의 지연 추가 (타이밍 공격 방지)
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100))

    if (isPasswordValid) {
      const twoFAEnabled = is2FAEnabled()

      // 2FA가 활성화되어 있고 코드가 없으면 2FA 요청
      if (twoFAEnabled && !totpCode) {
        return NextResponse.json({
          success: false,
          needsTwoFactor: true,
          error: '2단계 인증 코드를 입력해주세요.'
        })
      }

      // 2FA가 활성화되어 있으면 코드 검증
      if (twoFAEnabled) {
        const isTotpValid = verifyTotpCode(totpCode)
        if (!isTotpValid) {
          // 2FA 실패도 시도 횟수에 포함
          recordFailedAttempt(ip)
          const remaining = rateLimit.remainingAttempts - 1

          logAudit({
            action: '2FA_FAILED',
            ip,
            userAgent
          })

          return NextResponse.json(
            {
              success: false,
              needsTwoFactor: true,
              error: remaining > 0
                ? `잘못된 인증 코드입니다. (${remaining}회 남음)`
                : '잘못된 인증 코드입니다.'
            },
            { status: 401 }
          )
        }

        logAudit({
          action: '2FA_VERIFIED',
          ip,
          userAgent
        })
      }

      clearAttempts(ip) // 성공 시 시도 기록 초기화

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
    recordFailedAttempt(ip)
    const remaining = rateLimit.remainingAttempts - 1

    // 감사 로그 - 로그인 실패
    logAudit({
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      details: { remainingAttempts: remaining }
    })

    return NextResponse.json(
      {
        success: false,
        error: remaining > 0
          ? `비밀번호가 틀렸습니다. (${remaining}회 남음)`
          : '비밀번호가 틀렸습니다.'
      },
      { status: 401 }
    )
  } catch {
    return NextResponse.json(
      { success: false, error: '잘못된 요청입니다.' },
      { status: 400 }
    )
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
