import { NextRequest, NextResponse } from 'next/server'
import { findUserById } from '@/lib/auth'
import { createRegistrationOptions, verifyRegistration, getUserPasskeys } from '@/lib/passkey'
import { logAudit } from '@/lib/audit'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { requireSession, SessionError } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

// GET: 패스키 등록 옵션 생성
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireSession(request)

    const user = await findUserById(userId)
    if (!user) {
      return errorResponse(ErrorCode.UNAUTHORIZED, '사용자를 찾을 수 없습니다.')
    }

    const options = await createRegistrationOptions(
      user.id,
      user.email,
      user.display_name || undefined
    )

    return NextResponse.json(options)
  } catch (e) {
    if (e instanceof SessionError) return errorResponse(e.code, e.message)
    console.error('Passkey registration options error:', e)
    return errorResponse(ErrorCode.INTERNAL_ERROR, '패스키 등록 옵션 생성에 실패했습니다.')
  }
}

// POST: 패스키 등록 검증
export async function POST(request: NextRequest) {
  try {
    const { userId, ip, userAgent } = await requireSession(request)

    const { response, name } = await request.json()

    const verification = await verifyRegistration(userId, response, name)

    await logAudit({
      action: 'PASSKEY_REGISTERED',
      ip,
      userAgent,
      details: { userId },
    })

    return NextResponse.json({ success: true, verified: verification.verified })
  } catch (e) {
    if (e instanceof SessionError) return errorResponse(e.code, e.message)
    console.error('Passkey registration error:', e)
    return errorResponse(ErrorCode.INVALID_INPUT, e instanceof Error ? e.message : '패스키 등록에 실패했습니다.')
  }
}

// DELETE: 패스키 삭제
export async function DELETE(request: NextRequest) {
  try {
    const { userId, ip, userAgent } = await requireSession(request)

    const { passkeyId } = await request.json()

    // 삭제 전에 남은 패스키 개수 확인
    const passkeys = await getUserPasskeys(userId)
    if (passkeys.length <= 1) {
      // 비밀번호가 있는지 확인
      const { data: userWithPassword } = await supabase
        .from('users')
        .select('password_hash')
        .eq('id', userId)
        .single()

      if (!userWithPassword?.password_hash) {
        return errorResponse(ErrorCode.INVALID_INPUT, '마지막 패스키는 삭제할 수 없습니다. 비밀번호를 먼저 설정해주세요.')
      }
    }

    const { deletePasskey } = await import('@/lib/passkey')
    await deletePasskey(userId, passkeyId)

    await logAudit({
      action: 'PASSKEY_DELETED',
      ip,
      userAgent,
      details: { userId, passkeyId },
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    if (e instanceof SessionError) return errorResponse(e.code, e.message)
    console.error('Passkey deletion error:', e)
    return errorResponse(ErrorCode.INVALID_INPUT, e instanceof Error ? e.message : '패스키 삭제에 실패했습니다.')
  }
}
