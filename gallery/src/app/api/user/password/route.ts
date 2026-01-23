import { NextRequest, NextResponse } from 'next/server'
import { changePassword } from '@/lib/user-auth'
import { logAudit } from '@/lib/audit'

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  if (!userId) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  try {
    const { currentPassword, newPassword } = await request.json()

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: '현재 비밀번호와 새 비밀번호를 입력해주세요.' }, { status: 400 })
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: '새 비밀번호는 8자 이상이어야 합니다.' }, { status: 400 })
    }

    const result = await changePassword(userId, currentPassword, newPassword)

    if (!result.success) {
      await logAudit({
        action: 'LOGIN_FAILED',
        ip,
        userAgent,
        details: { reason: 'password_change_failed' },
      })
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    await logAudit({
      action: 'LOGIN_SUCCESS',
      ip,
      userAgent,
      details: { type: 'password_changed' },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
