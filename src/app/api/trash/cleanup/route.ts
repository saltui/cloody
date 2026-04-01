import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { deleteManyFromR2, extractR2KeyFromUrl } from '@/lib/r2'

const TRASH_RETENTION_DAYS = 30

// Cron job: 30일 지난 휴지통 항목 자동 삭제
// vercel.json에 cron 설정 필요: { "path": "/api/trash/cleanup", "schedule": "0 3 * * *" }
export async function POST(request: NextRequest) {
  // Vercel Cron 인증 확인
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - TRASH_RETENTION_DAYS)
    const cutoffISO = cutoffDate.toISOString()

    console.log(`[Trash Cleanup] Deleting items older than ${cutoffISO}`)

    // 30일 지난 사진 조회
    const { data: expiredPhotos, error: photosQueryError } = await supabase
      .from('photos')
      .select('id, url, thumbnail_url, user_id')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoffISO)
      .limit(100) // 한 번에 100개씩 처리

    if (photosQueryError) throw photosQueryError

    let deletedPhotos = 0
    let deletedFolders = 0

    // R2에서 파일(원본+썸네일) 삭제 및 DB 레코드 삭제
    if (expiredPhotos && expiredPhotos.length > 0) {
      const r2Keys = new Set<string>()
      const photoIds = expiredPhotos.map((photo) => photo.id)

      for (const photo of expiredPhotos) {
        const originalKey = extractR2KeyFromUrl(photo.url)
        if (originalKey) r2Keys.add(originalKey)

        const thumbnailKey = extractR2KeyFromUrl(photo.thumbnail_url || null)
        if (thumbnailKey) r2Keys.add(thumbnailKey)
      }

      const r2DeleteResult = await deleteManyFromR2(Array.from(r2Keys))
      if (r2DeleteResult.failedCount > 0) {
        console.error('[Trash Cleanup] R2 delete partial failure:', {
          failedCount: r2DeleteResult.failedCount,
          sample: r2DeleteResult.failedKeys.slice(0, 10),
        })
      }

      const { count: deletedPhotosCount, error: deletePhotosError } = await supabase
        .from('photos')
        .delete({ count: 'exact' })
        .in('id', photoIds)

      if (deletePhotosError) {
        throw deletePhotosError
      }

      deletedPhotos += deletedPhotosCount || 0
    }

    // 30일 지난 빈 폴더 삭제 (내부 사진이 없는 폴더만)
    const { data: expiredFolders, error: foldersQueryError } = await supabase
      .from('folders')
      .select('id')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoffISO)
      .limit(100)

    if (foldersQueryError) throw foldersQueryError

    if (expiredFolders && expiredFolders.length > 0) {
      for (const folder of expiredFolders) {
        // 폴더 내 사진이 있는지 확인
        const { count } = await supabase
          .from('photos')
          .select('id', { count: 'exact', head: true })
          .eq('folder_id', folder.id)

        if (count === 0) {
          await supabase
            .from('folders')
            .delete()
            .eq('id', folder.id)

          deletedFolders++
        }
      }
    }

    console.log(`[Trash Cleanup] Completed: ${deletedPhotos} photos, ${deletedFolders} folders deleted`)

    return NextResponse.json({
      success: true,
      deletedPhotos,
      deletedFolders,
      cutoffDate: cutoffISO,
    })
  } catch (error) {
    console.error('[Trash Cleanup] Error:', error)
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
