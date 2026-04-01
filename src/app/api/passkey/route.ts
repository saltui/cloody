import { NextRequest, NextResponse } from 'next/server'
import { getUserPasskeys, renamePasskey } from '@/lib/passkey'
import { requireSession, SessionError } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

// GET: 사용자의 패스키 목록 조회
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireSession(request)

    const passkeys = await getUserPasskeys(userId)
    // 민감한 정보 제외하고 반환
    const safePasskeys = passkeys.map(p => ({
      id: p.id,
      name: p.name,
      device_type: p.device_type,
      backed_up: p.backed_up,
      created_at: p.created_at,
      last_used_at: p.last_used_at,
    }))
    return NextResponse.json({ passkeys: safePasskeys })
  } catch (e) {
    if (e instanceof SessionError) return errorResponse(e.code, e.message)
    console.error('Get passkeys error:', e)
    return errorResponse(ErrorCode.INTERNAL_ERROR, '패스키 목록을 가져오는데 실패했습니다.')
  }
}

// PATCH: 패스키 이름 변경
export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await requireSession(request)

    const { passkeyId, name } = await request.json()

    if (!passkeyId || !name) {
      return errorResponse(ErrorCode.INVALID_INPUT, '패스키 ID와 이름이 필요합니다.')
    }

    await renamePasskey(userId, passkeyId, name)
    return NextResponse.json({ success: true })
  } catch (e) {
    if (e instanceof SessionError) return errorResponse(e.code, e.message)
    console.error('Rename passkey error:', e)
    return errorResponse(ErrorCode.INVALID_INPUT, e instanceof Error ? e.message : '패스키 이름 변경에 실패했습니다.')
  }
}
