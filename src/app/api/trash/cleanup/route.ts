import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { deleteFromR2 } from '@/lib/r2'

const TRASH_RETENTION_DAYS = 30

// Cron job: 30일 지난 휴지통 항목 자동 삭제
// vercel.json에 cron 설정 필요: { "path": "/api/trash/cleanup", "schedule": "0 3 * * *" }
export async function POST(request: NextRequest) {
  // Vercel Cron 인증 확인
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // 로컬 개발 환경에서는 허용
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - TRASH_RETENTION_DAYS)
    const cutoffISO = cutoffDate.toISOString()

    console.log(`[Trash Cleanup] Deleting items older than ${cutoffISO}`)

    // 30일 지난 사진 조회
    const { data: expiredPhotos, error: photosQueryError } = await supabase
      .from('photos')
      .select('id, url, user_id')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoffISO)
      .limit(100) // 한 번에 100개씩 처리

    if (photosQueryError) throw photosQueryError

    let deletedPhotos = 0
    let deletedFolders = 0

    // R2에서 파일 삭제 및 DB 레코드 삭제
    if (expiredPhotos && expiredPhotos.length > 0) {
      for (const photo of expiredPhotos) {
        try {
          // R2에서 파일 삭제
          const fileName = photo.url.split('/').pop()
          if (fileName) {
            await deleteFromR2(fileName)
          }

          // DB에서 레코드 삭제
          await supabase
            .from('photos')
            .delete()
            .eq('id', photo.id)

          deletedPhotos++
        } catch (e) {
          console.error(`[Trash Cleanup] Failed to delete photo ${photo.id}:`, e)
        }
      }
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

// GET도 허용 (수동 테스트용)
export async function GET(request: NextRequest) {
  return POST(request)
}
