import { NextRequest, NextResponse } from 'next/server'
import { deleteFromR2 } from '@/lib/r2'
import { logAudit } from '@/lib/audit'
import { getClientIP } from '@/lib/request-utils'

export async function DELETE(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  try {
    const { fileName } = await request.json()

    if (!fileName) {
      return NextResponse.json({ error: 'fileName is required' }, { status: 400 })
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
  } catch (error) {
    console.error('Delete error:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
