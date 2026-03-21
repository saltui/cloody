import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// 트랜스코딩 작업 큐에 추가
export async function POST(request: NextRequest) {
  try {
    const { photoId } = await request.json()

    if (!photoId) {
      return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
    }

    // 사진 정보 확인
    const { data: photo, error: photoError } = await supabase
      .from('photos')
      .select('*')
      .eq('id', photoId)
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
  const { searchParams } = new URL(request.url)
  const photoId = searchParams.get('photoId')

  if (!photoId) {
    return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
  }

  const { data: photo, error } = await supabase
    .from('photos')
    .select('id, hls_status, hls_url')
    .eq('id', photoId)
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
