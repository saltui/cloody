import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { copyObject, R2_PUBLIC_URL } from '@/lib/r2'
import { logAudit } from '@/lib/audit'
import { getClientIP } from '@/lib/request-utils'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

// 파일 복사
export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return errorResponse(ErrorCode.UNAUTHORIZED)
  }

  try {
    const { photoId } = await request.json()

    if (!photoId) {
      return errorResponse(ErrorCode.INVALID_INPUT, 'photoId is required')
    }

    // 사진 정보 가져오기
    const { data: photo, error: photoError } = await supabase
      .from('photos')
      .select('*')
      .eq('id', photoId)
      .eq('user_id', userId)
      .single()

    if (photoError || !photo) {
      return errorResponse(ErrorCode.NOT_FOUND, 'Photo not found')
    }

    // 원본 파일 키 추출 (R2 URL에서 파일 경로만 가져오기)
    const sourceKey = photo.url.replace(`${R2_PUBLIC_URL}/`, '')

    // 새 파일명 생성 (확장자 앞에 " - 복사본" 추가)
    const originalName = photo.name || sourceKey.split('/').pop() || 'file'
    const lastDotIndex = originalName.lastIndexOf('.')
    let newName: string
    if (lastDotIndex > 0) {
      newName = `${originalName.slice(0, lastDotIndex)} - 복사본${originalName.slice(lastDotIndex)}`
    } else {
      newName = `${originalName} - 복사본`
    }

    // 새 R2 키 생성 (타임스탬프 추가로 고유성 보장)
    const timestamp = Date.now()
    const newKey = sourceKey.replace(/([^/]+)$/, `copy_${timestamp}_$1`)

    // R2에서 파일 복사
    const newUrl = await copyObject(sourceKey, newKey)

    // 썸네일도 복사 (있는 경우)
    let newThumbnailUrl = null
    if (photo.thumbnail_url) {
      const thumbnailSourceKey = photo.thumbnail_url.replace(`${R2_PUBLIC_URL}/`, '')
      const thumbnailNewKey = thumbnailSourceKey.replace(/([^/]+)$/, `copy_${timestamp}_$1`)
      newThumbnailUrl = await copyObject(thumbnailSourceKey, thumbnailNewKey)
    }

    // 새 order 값 계산 (같은 폴더 내 최대 order + 1)
    let query = supabase.from('photos').select('order').eq('user_id', userId)
    if (photo.folder_id) {
      query = query.eq('folder_id', photo.folder_id)
    } else {
      query = query.is('folder_id', null)
    }
    const { data: maxOrderData } = await query.order('order', { ascending: false }).limit(1)
    const newOrder = (maxOrderData?.[0]?.order || 0) + 1

    // DB에 새 레코드 생성
    const { data: newPhoto, error: insertError } = await supabase
      .from('photos')
      .insert({
        url: newUrl,
        thumbnail_url: newThumbnailUrl,
        name: newName,
        order: newOrder,
        folder_id: photo.folder_id,
        user_id: userId,
        file_type: photo.file_type,
        file_size: photo.file_size,
        is_video: photo.is_video,
        hls_status: photo.is_video ? 'pending' : 'not_applicable',
      })
      .select()
      .single()

    if (insertError) {
      console.error('Photo copy insert error:', insertError)
      return errorResponse(ErrorCode.INTERNAL_ERROR, 'Failed to create photo copy')
    }

    // 감사 로그 - 파일 복사
    logAudit({
      action: 'COPY',
      ip,
      userAgent,
      details: {
        originalId: photoId,
        newId: newPhoto.id,
        fileName: newName,
      }
    })

    return NextResponse.json({ photo: newPhoto })
  } catch (error) {
    console.error('Copy API error:', error)
    return errorResponse(ErrorCode.INTERNAL_ERROR)
  }
}
