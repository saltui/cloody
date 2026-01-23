import { NextRequest, NextResponse } from 'next/server'
import { verifyEmailToken } from '@/lib/user-auth'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.json({ error: '유효하지 않은 링크입니다.' }, { status: 400 })
  }

  try {
    const success = await verifyEmailToken(token)

    if (!success) {
      return NextResponse.json({
        error: '만료되었거나 유효하지 않은 링크입니다.',
        expired: true,
      }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: '처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
