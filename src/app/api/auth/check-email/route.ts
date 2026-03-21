import { NextRequest, NextResponse } from 'next/server'
import { findUserByEmail } from '@/lib/auth'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email || typeof email !== 'string') {
      return errorResponse(ErrorCode.INVALID_INPUT, '이메일을 입력해주세요.')
    }

    // 이메일 형식 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return errorResponse(ErrorCode.INVALID_INPUT, '올바른 이메일 형식이 아닙니다.')
    }

    const user = await findUserByEmail(email)

    return NextResponse.json({
      exists: !!user,
      hasPassword: user?.password_hash ? true : false,
    })
  } catch (error) {
    console.error('[auth] check-email failed:', error)
    return errorResponse(ErrorCode.INTERNAL_ERROR, '요청 처리 중 오류가 발생했습니다.')
  }
}
