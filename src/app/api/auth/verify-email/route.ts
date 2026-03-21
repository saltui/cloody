import { NextRequest, NextResponse } from 'next/server'
import { verifyEmailToken } from '@/lib/auth'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    return errorResponse(ErrorCode.INVALID_INPUT, '유효하지 않은 링크입니다.')
  }

  try {
    const success = await verifyEmailToken(token)

    if (!success) {
      return errorResponse(ErrorCode.INVALID_INPUT, '만료되었거나 유효하지 않은 링크입니다.', {
        expired: true,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[auth] verify-email GET failed:', error)
    return errorResponse(ErrorCode.INTERNAL_ERROR, '처리 중 오류가 발생했습니다.')
  }
}
