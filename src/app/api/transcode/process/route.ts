import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getObjectWithRange, BUCKET_NAME } from '@/lib/r2'
import {
  generateMasterPlaylist,
  uploadHLSToR2,
  determineQualities,
  HLS_QUALITY_PRESETS,
  type QualityPreset
} from '@/lib/transcoding'
import { spawn } from 'child_process'
import { writeFile, mkdir, readFile, rm, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const MAX_ATTEMPTS = 3
const MAX_CONCURRENT_JOBS = 1

// R2 URL에서 파일 키 추출
function extractKeyFromUrl(url: string): string | null {
  // https://bucket.r2.dev/filename or https://account.r2.cloudflarestorage.com/bucket/filename
  try {
    if (url.includes('.r2.dev/')) {
      return url.split('.r2.dev/')[1]?.split('?')[0]
    }
    if (url.includes('.r2.cloudflarestorage.com/')) {
      const urlObj = new URL(url)
      const parts = urlObj.pathname.split('/')
      return parts.slice(2).join('/')
    }
    return null
  } catch {
    return null
  }
}

// FFmpeg 실행
async function runFFmpeg(args: string[]): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', args)
    let stderr = ''

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr.slice(-1000) })
      }
    })

    ffmpeg.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

// 단일 품질 트랜스코딩
async function transcodeQuality(
  inputPath: string,
  outputDir: string,
  quality: QualityPreset
): Promise<{ success: boolean; error?: string }> {
  const preset = HLS_QUALITY_PRESETS[quality]
  const segmentDir = join(outputDir, 'segments')
  await mkdir(segmentDir, { recursive: true })

  const args = [
    '-i', inputPath,
    '-vf', `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2`,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '22',
    '-b:v', preset.videoBitrate,
    '-maxrate', preset.videoBitrate,
    '-bufsize', `${parseInt(preset.videoBitrate) * 2}k`,
    '-c:a', 'aac',
    '-b:a', preset.audioBitrate,
    '-hls_time', '6',
    '-hls_playlist_type', 'vod',
    '-hls_segment_filename', join(segmentDir, `${quality}_%03d.ts`),
    '-y',
    join(outputDir, `${quality}.m3u8`)
  ]

  return runFFmpeg(args)
}

// 단일 작업 처리
async function processJob(photoId: string): Promise<{ success: boolean; error?: string }> {
  console.log(`Processing transcoding job for photo: ${photoId}`)

  // 사진 정보 가져오기
  const { data: photo, error: fetchError } = await supabase
    .from('photos')
    .select('*')
    .eq('id', photoId)
    .single()

  if (fetchError || !photo) {
    return { success: false, error: 'Photo not found' }
  }

  const fileKey = extractKeyFromUrl(photo.url)
  if (!fileKey) {
    return { success: false, error: 'Invalid file URL' }
  }

  // 임시 디렉토리 생성
  const workDir = join(tmpdir(), `transcode-${photoId}-${Date.now()}`)
  const inputPath = join(workDir, 'input.mp4')
  const outputDir = join(workDir, 'output')

  try {
    await mkdir(workDir, { recursive: true })
    await mkdir(outputDir, { recursive: true })

    // R2에서 원본 파일 다운로드
    console.log(`Downloading file: ${fileKey}`)
    const response = await getObjectWithRange(fileKey)
    if (!response.Body) {
      return { success: false, error: 'Could not download file from R2' }
    }

    const chunks: Uint8Array[] = []
    const reader = response.Body.transformToWebStream().getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const fileBuffer = Buffer.concat(chunks)
    await writeFile(inputPath, fileBuffer)
    console.log(`Downloaded ${fileBuffer.length} bytes`)

    // 품질 결정 (원본 해상도 기반)
    // 간단히 720p, 480p, 360p 사용
    const qualities: QualityPreset[] = ['720p', '480p', '360p']

    // 각 품질로 트랜스코딩
    for (const quality of qualities) {
      console.log(`Transcoding to ${quality}...`)
      const result = await transcodeQuality(inputPath, outputDir, quality)
      if (!result.success) {
        console.error(`Failed to transcode ${quality}:`, result.error)
        // 계속 진행 (일부 품질만 성공할 수 있음)
      }
    }

    // 생성된 파일 확인
    const outputFiles = await readdir(outputDir)
    const m3u8Files = outputFiles.filter(f => f.endsWith('.m3u8'))

    if (m3u8Files.length === 0) {
      return { success: false, error: 'No HLS files generated' }
    }

    // R2에 업로드
    console.log('Uploading HLS files to R2...')

    // 세그먼트 파일 업로드
    const segmentDir = join(outputDir, 'segments')
    try {
      const segmentFiles = await readdir(segmentDir)
      for (const segment of segmentFiles) {
        const content = await readFile(join(segmentDir, segment))
        await uploadHLSToR2(photoId, content, `segments/${segment}`, 'video/MP2T')
      }
    } catch {
      // 세그먼트 디렉토리가 없을 수 있음
    }

    // 품질별 플레이리스트 업로드
    const successQualities: QualityPreset[] = []
    for (const m3u8 of m3u8Files) {
      const content = await readFile(join(outputDir, m3u8), 'utf-8')
      await uploadHLSToR2(photoId, content, m3u8)
      const quality = m3u8.replace('.m3u8', '') as QualityPreset
      if (qualities.includes(quality)) {
        successQualities.push(quality)
      }
    }

    // 마스터 플레이리스트 생성 및 업로드
    const masterPlaylist = generateMasterPlaylist(photoId, successQualities)
    const masterUrl = await uploadHLSToR2(photoId, masterPlaylist, 'master.m3u8')

    // DB 업데이트
    await supabase
      .from('photos')
      .update({
        hls_url: masterUrl,
        hls_status: 'ready'
      })
      .eq('id', photoId)

    console.log(`Transcoding completed for photo: ${photoId}`)
    return { success: true }

  } catch (error) {
    console.error('Transcoding error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    // 임시 파일 정리
    try {
      await rm(workDir, { recursive: true, force: true })
    } catch {
      // 무시
    }
  }
}

// Cron 또는 수동으로 호출되는 작업 처리기
export async function GET(request: NextRequest) {
  // Vercel Cron 인증 (선택적)
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // 개발 환경에서는 인증 건너뛰기
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  console.log('Starting transcoding process...')

  // 대기 중인 작업 가져오기
  const { data: pendingPhotos, error } = await supabase
    .from('photos')
    .select('id')
    .eq('is_video', true)
    .eq('hls_status', 'pending')
    .limit(MAX_CONCURRENT_JOBS)

  if (error) {
    console.error('Failed to fetch pending jobs:', error)
    return NextResponse.json({ error: 'Failed to fetch pending jobs' }, { status: 500 })
  }

  if (!pendingPhotos || pendingPhotos.length === 0) {
    return NextResponse.json({ message: 'No pending jobs' })
  }

  const results: { photoId: string; success: boolean; error?: string }[] = []

  for (const photo of pendingPhotos) {
    // 처리 중 상태로 업데이트
    await supabase
      .from('photos')
      .update({ hls_status: 'processing' })
      .eq('id', photo.id)

    // transcoding_jobs 테이블 업데이트 (있다면)
    try {
      await supabase
        .from('transcoding_jobs')
        .update({ status: 'processing', attempts: supabase.rpc('increment', { x: 1 }) })
        .eq('photo_id', photo.id)
    } catch {
      // 테이블이 없을 수 있음
    }

    const result = await processJob(photo.id)
    results.push({ photoId: photo.id, ...result })

    if (!result.success) {
      // 실패 시 상태 업데이트
      await supabase
        .from('photos')
        .update({ hls_status: 'failed' })
        .eq('id', photo.id)

      try {
        await supabase
          .from('transcoding_jobs')
          .update({ status: 'failed', error_message: result.error })
          .eq('photo_id', photo.id)
      } catch {
        // 테이블이 없을 수 있음
      }
    } else {
      // 성공 시 작업 완료 처리
      try {
        await supabase
          .from('transcoding_jobs')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('photo_id', photo.id)
      } catch {
        // 테이블이 없을 수 있음
      }
    }
  }

  return NextResponse.json({
    message: 'Transcoding process completed',
    processed: results.length,
    results
  })
}

// 수동 트리거 (특정 비디오)
export async function POST(request: NextRequest) {
  try {
    const { photoId } = await request.json()

    if (!photoId) {
      return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
    }

    // 처리 중 상태로 업데이트
    await supabase
      .from('photos')
      .update({ hls_status: 'processing' })
      .eq('id', photoId)

    const result = await processJob(photoId)

    if (!result.success) {
      await supabase
        .from('photos')
        .update({ hls_status: 'failed' })
        .eq('id', photoId)
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Manual transcode error:', error)
    return NextResponse.json({ error: 'Failed to process transcoding' }, { status: 500 })
  }
}
