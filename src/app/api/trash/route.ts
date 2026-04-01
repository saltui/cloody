import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { deleteManyFromR2, extractR2KeyFromUrl, getStorageUsage } from '@/lib/r2'
import { logAudit } from '@/lib/audit'
import { getClientIP } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

interface PhotoForR2Delete {
  id: string
  url: string
  thumbnail_url?: string | null
}

function collectR2Keys(photos: PhotoForR2Delete[] | null | undefined): string[] {
  if (!photos || photos.length === 0) return []

  const keys = new Set<string>()
  for (const photo of photos) {
    const originalKey = extractR2KeyFromUrl(photo.url)
    if (originalKey) keys.add(originalKey)

    const thumbnailKey = extractR2KeyFromUrl(photo.thumbnail_url || null)
    if (thumbnailKey) keys.add(thumbnailKey)
  }

  return Array.from(keys)
}

// GET: 휴지통 목록 조회
export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return errorResponse(ErrorCode.UNAUTHORIZED)
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
    return errorResponse(ErrorCode.INTERNAL_ERROR, 'Failed to get trash')
  }
}

// POST: 휴지통으로 이동 (soft delete)
export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return errorResponse(ErrorCode.UNAUTHORIZED)
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
    return errorResponse(ErrorCode.INTERNAL_ERROR, 'Failed to move to trash')
  }
}

// DELETE: 영구 삭제
export async function DELETE(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return errorResponse(ErrorCode.UNAUTHORIZED)
  }

  try {
    const { photoIds, folderIds, emptyAll } = await request.json()

    let totalRequestedR2Delete = 0
    let totalDeletedR2Objects = 0
    const failedR2Keys = new Set<string>()
    let deletedPhotoRows = 0
    let deletedFolderRows = 0

    // 휴지통 비우기
    if (emptyAll) {
      const { data: trashPhotos, error: trashPhotosError } = await supabase
        .from('photos')
        .select('id, url, thumbnail_url')
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)

      if (trashPhotosError) throw trashPhotosError

      // R2에서 원본 + 썸네일 삭제
      const r2Keys = collectR2Keys(trashPhotos)
      const r2DeleteResult = await deleteManyFromR2(r2Keys)
      totalRequestedR2Delete += r2DeleteResult.requestedCount
      totalDeletedR2Objects += r2DeleteResult.deletedCount
      r2DeleteResult.failedKeys.forEach((key) => failedR2Keys.add(key))

      const { count: deletedPhotosCount, error: deletePhotosError } = await supabase
        .from('photos')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)

      if (deletePhotosError) throw deletePhotosError
      deletedPhotoRows += deletedPhotosCount || 0

      const { count: deletedFoldersCount, error: deleteFoldersError } = await supabase
        .from('folders')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)

      if (deleteFoldersError) throw deleteFoldersError
      deletedFolderRows += deletedFoldersCount || 0

      let r2UsageBytes: number | null = null
      try {
        r2UsageBytes = await getStorageUsage()
      } catch (usageError) {
        console.error('R2 usage check error:', usageError)
      }

      logAudit({
        action: 'TRASH_EMPTY',
        ip,
        userAgent,
        details: {
          photos: deletedPhotoRows,
          folders: deletedFolderRows,
          r2DeleteRequestedCount: totalRequestedR2Delete,
          r2DeletedCount: totalDeletedR2Objects,
          r2FailedCount: failedR2Keys.size,
        }
      })

      return NextResponse.json({
        success: true,
        deletedPhotoRows,
        deletedFolderRows,
        r2DeleteRequestedCount: totalRequestedR2Delete,
        r2DeletedCount: totalDeletedR2Objects,
        r2FailedCount: failedR2Keys.size,
        failedR2Keys: Array.from(failedR2Keys).slice(0, 20),
        r2UsageBytes,
      })
    }

    // 특정 사진 영구 삭제
    if (photoIds && photoIds.length > 0) {
      const { data: photos, error: photosQueryError } = await supabase
        .from('photos')
        .select('id, url, thumbnail_url')
        .in('id', photoIds)
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)

      if (photosQueryError) throw photosQueryError

      const r2Keys = collectR2Keys(photos)
      const r2DeleteResult = await deleteManyFromR2(r2Keys)
      totalRequestedR2Delete += r2DeleteResult.requestedCount
      totalDeletedR2Objects += r2DeleteResult.deletedCount
      r2DeleteResult.failedKeys.forEach((key) => failedR2Keys.add(key))

      const { count: deletedCount, error: deleteError } = await supabase
        .from('photos')
        .delete({ count: 'exact' })
        .in('id', photoIds)
        .eq('user_id', userId)

      if (deleteError) throw deleteError
      deletedPhotoRows += deletedCount || 0

      logAudit({
        action: 'TRASH_PERMANENT_DELETE',
        ip,
        userAgent,
        details: {
          photoIds,
          deletedPhotoRows: deletedCount || 0,
          r2DeleteRequestedCount: r2DeleteResult.requestedCount,
          r2DeletedCount: r2DeleteResult.deletedCount,
          r2FailedCount: r2DeleteResult.failedCount,
        }
      })
    }

    // 특정 폴더 영구 삭제
    if (folderIds && folderIds.length > 0) {
      const { data: photos, error: folderPhotosError } = await supabase
        .from('photos')
        .select('id, url, thumbnail_url')
        .in('folder_id', folderIds)
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)

      if (folderPhotosError) throw folderPhotosError

      const r2Keys = collectR2Keys(photos)
      const r2DeleteResult = await deleteManyFromR2(r2Keys)
      totalRequestedR2Delete += r2DeleteResult.requestedCount
      totalDeletedR2Objects += r2DeleteResult.deletedCount
      r2DeleteResult.failedKeys.forEach((key) => failedR2Keys.add(key))

      const { count: deletedFolderPhotoCount, error: deletePhotosError } = await supabase
        .from('photos')
        .delete({ count: 'exact' })
        .in('folder_id', folderIds)
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)

      if (deletePhotosError) throw deletePhotosError
      deletedPhotoRows += deletedFolderPhotoCount || 0

      const { count: deletedFoldersCount, error: deleteFoldersError } = await supabase
        .from('folders')
        .delete({ count: 'exact' })
        .in('id', folderIds)
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)

      if (deleteFoldersError) throw deleteFoldersError
      deletedFolderRows += deletedFoldersCount || 0

      logAudit({
        action: 'TRASH_PERMANENT_DELETE',
        ip,
        userAgent,
        details: {
          folderIds,
          deletedFolderRows: deletedFoldersCount || 0,
          deletedPhotoRows: deletedFolderPhotoCount || 0,
          r2DeleteRequestedCount: r2DeleteResult.requestedCount,
          r2DeletedCount: r2DeleteResult.deletedCount,
          r2FailedCount: r2DeleteResult.failedCount,
        }
      })
    }

    return NextResponse.json({
      success: true,
      deletedPhotoRows,
      deletedFolderRows,
      r2DeleteRequestedCount: totalRequestedR2Delete,
      r2DeletedCount: totalDeletedR2Objects,
      r2FailedCount: failedR2Keys.size,
      failedR2Keys: Array.from(failedR2Keys).slice(0, 20),
    })
  } catch (error) {
    console.error('Permanent delete error:', error)
    return errorResponse(ErrorCode.INTERNAL_ERROR, 'Failed to delete permanently')
  }
}
