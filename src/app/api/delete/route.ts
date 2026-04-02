import { NextRequest, NextResponse } from 'next/server'
import { deleteFromR2 } from '@/lib/r2'
import { logAudit } from '@/lib/audit'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { requireSession, SessionError } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

export async function DELETE(request: NextRequest) {
  try {
    const { userId, ip, userAgent } = await requireSession(request)

    const { fileName } = await request.json()

    if (!fileName) {
      return NextResponse.json({ error: 'fileName is required' }, { status: 400 })
    }

    // 파일 소유자 검증: DB에서 해당 유저의 파일인지 확인
    const { data: photo } = await supabase
      .from('photos')
      .select('id')
      .eq('user_id', userId)
      .like('url', `%${fileName}`)
      .single()

    if (!photo) {
      return errorResponse(ErrorCode.FORBIDDEN, '파일을 찾을 수 없거나 권한이 없습니다.')
    }

    await deleteFromR2(fileName)

    // 감사 로그 - 파일 삭제
    logAudit({
      action: 'DELETE',
      ip,
      userAgent,
      details: { fileName }
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    if (e instanceof SessionError) return errorResponse(e.code, e.message)
    console.error('Delete error:', e)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
