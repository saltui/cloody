import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

// 트랜스코딩 작업 큐에 추가
export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return errorResponse(ErrorCode.UNAUTHORIZED)
  }

  try {
    const { photoId } = await request.json()

    if (!photoId) {
      return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
    }

    // 사진 정보 확인 (소유권 검증 포함)
    const { data: photo, error: photoError } = await supabase
      .from('photos')
      .select('*')
      .eq('id', photoId)
      .eq('user_id', userId)
      .single()

    if (photoError || !photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    // 비디오가 아니면 무시
    if (!photo.is_video) {
      return NextResponse.json({ error: 'Not a video file' }, { status: 400 })
    }

    // 이미 처리 중이거나 완료됐으면 무시
    if (photo.hls_status === 'processing' || photo.hls_status === 'ready') {
      return NextResponse.json({ message: 'Already processing or ready', status: photo.hls_status })
    }

    // transcoding_jobs 테이블에 작업 추가 (테이블이 있다면)
    try {
      const { error: jobError } = await supabase
        .from('transcoding_jobs')
        .upsert({
          photo_id: photoId,
          status: 'pending',
          attempts: 0,
          created_at: new Date().toISOString(),
        }, {
          onConflict: 'photo_id'
        })

      if (jobError) {
        console.warn('Could not create transcoding job (table may not exist):', jobError)
      }
    } catch (error) {
      console.error('[transcode] transcoding_jobs upsert failed:', error)
    }

    // 상태 업데이트
    await supabase
      .from('photos')
      .update({ hls_status: 'pending' })
      .eq('id', photoId)

    return NextResponse.json({ message: 'Transcoding job queued', photoId })
  } catch (error) {
    console.error('Transcode queue error:', error)
    return NextResponse.json({ error: 'Failed to queue transcoding job' }, { status: 500 })
  }
}

// 트랜스코딩 상태 조회
export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return errorResponse(ErrorCode.UNAUTHORIZED)
  }

  const { searchParams } = new URL(request.url)
  const photoId = searchParams.get('photoId')

  if (!photoId) {
    return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
  }

  const { data: photo, error } = await supabase
    .from('photos')
    .select('id, hls_status, hls_url')
    .eq('id', photoId)
    .eq('user_id', userId)
    .single()

  if (error || !photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
  }

  return NextResponse.json({
    photoId: photo.id,
    status: photo.hls_status,
    hlsUrl: photo.hls_url,
  })
}
