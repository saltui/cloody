import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { uploadToR2 } from '@/lib/r2'
import { requireSession, SessionError } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

// 클라이언트에서 생성한 비디오 썸네일을 업로드하고 DB 업데이트
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireSession(request)

    const formData = await request.formData()
    const photoId = formData.get('photoId') as string
    const thumbnail = formData.get('thumbnail') as File

    if (!photoId || !thumbnail) {
      return errorResponse(ErrorCode.INVALID_INPUT, 'photoId and thumbnail are required')
    }

    // 파일 소유자 검증
    const { data: photo } = await supabase
      .from('photos')
      .select('id, thumbnail_url')
      .eq('id', photoId)
      .eq('user_id', userId)
      .single()

    if (!photo) {
      return errorResponse(ErrorCode.FORBIDDEN, 'Photo not found')
    }

    // 이미 썸네일이 있으면 스킵
    if (photo.thumbnail_url) {
      return NextResponse.json({ thumbnailUrl: photo.thumbnail_url, skipped: true })
    }

    // 썸네일 업로드
    const buffer = Buffer.from(await thumbnail.arrayBuffer())
    const key = `thumb_${Date.now()}_${photoId}.webp`
    const publicUrl = await uploadToR2(key, buffer, 'image/webp')

    // DB 업데이트
    await supabase
      .from('photos')
      .update({ thumbnail_url: publicUrl })
      .eq('id', photoId)

    return NextResponse.json({ thumbnailUrl: publicUrl })
  } catch (e) {
    if (e instanceof SessionError) return errorResponse(e.code, e.message)
    console.error('[thumbnail/video] error:', e)
    return errorResponse(ErrorCode.INTERNAL_ERROR, 'Thumbnail upload failed')
  }
}
