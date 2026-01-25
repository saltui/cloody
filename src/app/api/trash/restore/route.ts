import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

// POST: 휴지통에서 복원
export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { photoIds, folderIds } = await request.json()

    // 사진 복원
    if (photoIds && photoIds.length > 0) {
      const { error } = await supabase
        .from('photos')
        .update({ deleted_at: null })
        .in('id', photoIds)
        .eq('user_id', userId)

      if (error) throw error

      logAudit({
        action: 'TRASH_RESTORE',
        ip,
        userAgent,
        details: { photoIds, type: 'photos' }
      })
    }

    // 폴더 복원 (폴더 내 사진도 함께)
    if (folderIds && folderIds.length > 0) {
      // 폴더 복원
      const { error: folderError } = await supabase
        .from('folders')
        .update({ deleted_at: null })
        .in('id', folderIds)
        .eq('user_id', userId)

      if (folderError) throw folderError

      // 폴더 내 사진도 복원 (같은 시점에 삭제된 것들만)
      const { error: photosError } = await supabase
        .from('photos')
        .update({ deleted_at: null })
        .in('folder_id', folderIds)
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)

      if (photosError) throw photosError

      logAudit({
        action: 'TRASH_RESTORE',
        ip,
        userAgent,
        details: { folderIds, type: 'folders' }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Restore error:', error)
    return NextResponse.json({ error: 'Failed to restore' }, { status: 500 })
  }
}
