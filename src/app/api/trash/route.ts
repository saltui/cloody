import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { deleteFromR2 } from '@/lib/r2'
import { logAudit } from '@/lib/audit'

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

// GET: 휴지통 목록 조회
export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 휴지통 사진 조회
    const { data: photos, error: photosError } = await supabase
      .from('photos')
      .select('*')
      .eq('user_id', userId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })

    if (photosError) throw photosError

    // 휴지통 폴더 조회
    const { data: folders, error: foldersError } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', userId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })

    if (foldersError) throw foldersError

    return NextResponse.json({
      photos: photos || [],
      folders: folders || [],
    })
  } catch (error) {
    console.error('Trash list error:', error)
    return NextResponse.json({ error: 'Failed to get trash' }, { status: 500 })
  }
}

// POST: 휴지통으로 이동 (soft delete)
export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { photoIds, folderIds } = await request.json()
    const now = new Date().toISOString()

    // 사진 휴지통으로 이동
    if (photoIds && photoIds.length > 0) {
      const { error } = await supabase
        .from('photos')
        .update({ deleted_at: now })
        .in('id', photoIds)
        .eq('user_id', userId)

      if (error) throw error

      logAudit({
        action: 'TRASH_MOVE',
        ip,
        userAgent,
        details: { photoIds, type: 'photos' }
      })
    }

    // 폴더 휴지통으로 이동 (폴더 내 모든 사진도 함께)
    if (folderIds && folderIds.length > 0) {
      // 폴더 휴지통으로 이동
      const { error: folderError } = await supabase
        .from('folders')
        .update({ deleted_at: now })
        .in('id', folderIds)
        .eq('user_id', userId)

      if (folderError) throw folderError

      // 폴더 내 사진도 휴지통으로 이동
      const { error: photosError } = await supabase
        .from('photos')
        .update({ deleted_at: now })
        .in('folder_id', folderIds)
        .eq('user_id', userId)

      if (photosError) throw photosError

      logAudit({
        action: 'TRASH_MOVE',
        ip,
        userAgent,
        details: { folderIds, type: 'folders' }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Trash move error:', error)
    return NextResponse.json({ error: 'Failed to move to trash' }, { status: 500 })
  }
}

// DELETE: 영구 삭제
export async function DELETE(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { photoIds, folderIds, emptyAll } = await request.json()

    // 휴지통 비우기
    if (emptyAll) {
      // 모든 휴지통 사진 가져오기
      const { data: trashPhotos } = await supabase
        .from('photos')
        .select('id, url')
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)

      // R2에서 파일 삭제
      if (trashPhotos) {
        for (const photo of trashPhotos) {
          try {
            const fileName = photo.url.split('/').pop()
            if (fileName) {
              await deleteFromR2(fileName)
            }
          } catch (e) {
            console.error('R2 delete error:', e)
          }
        }
      }

      // DB에서 삭제
      await supabase
        .from('photos')
        .delete()
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)

      await supabase
        .from('folders')
        .delete()
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)

      logAudit({
        action: 'TRASH_EMPTY',
        ip,
        userAgent,
        details: { count: trashPhotos?.length || 0 }
      })

      return NextResponse.json({ success: true })
    }

    // 특정 사진 영구 삭제
    if (photoIds && photoIds.length > 0) {
      // 사진 URL 가져오기
      const { data: photos } = await supabase
        .from('photos')
        .select('id, url')
        .in('id', photoIds)
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)

      // R2에서 파일 삭제
      if (photos) {
        for (const photo of photos) {
          try {
            const fileName = photo.url.split('/').pop()
            if (fileName) {
              await deleteFromR2(fileName)
            }
          } catch (e) {
            console.error('R2 delete error:', e)
          }
        }
      }

      // DB에서 삭제
      await supabase
        .from('photos')
        .delete()
        .in('id', photoIds)
        .eq('user_id', userId)

      logAudit({
        action: 'TRASH_PERMANENT_DELETE',
        ip,
        userAgent,
        details: { photoIds }
      })
    }

    // 특정 폴더 영구 삭제
    if (folderIds && folderIds.length > 0) {
      // 폴더 내 사진 URL 가져오기
      const { data: photos } = await supabase
        .from('photos')
        .select('id, url')
        .in('folder_id', folderIds)
        .eq('user_id', userId)

      // R2에서 파일 삭제
      if (photos) {
        for (const photo of photos) {
          try {
            const fileName = photo.url.split('/').pop()
            if (fileName) {
              await deleteFromR2(fileName)
            }
          } catch (e) {
            console.error('R2 delete error:', e)
          }
        }
      }

      // DB에서 삭제 (사진 먼저)
      await supabase
        .from('photos')
        .delete()
        .in('folder_id', folderIds)
        .eq('user_id', userId)

      await supabase
        .from('folders')
        .delete()
        .in('id', folderIds)
        .eq('user_id', userId)

      logAudit({
        action: 'TRASH_PERMANENT_DELETE',
        ip,
        userAgent,
        details: { folderIds }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Permanent delete error:', error)
    return NextResponse.json({ error: 'Failed to delete permanently' }, { status: 500 })
  }
}
