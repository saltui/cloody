import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2Client, BUCKET_NAME, R2_PUBLIC_URL } from './r2'

// HLS 품질 프리셋
export const HLS_QUALITY_PRESETS = {
  '1080p': { width: 1920, height: 1080, videoBitrate: '5000k', audioBitrate: '192k' },
  '720p': { width: 1280, height: 720, videoBitrate: '2500k', audioBitrate: '128k' },
  '480p': { width: 854, height: 480, videoBitrate: '1000k', audioBitrate: '96k' },
  '360p': { width: 640, height: 360, videoBitrate: '500k', audioBitrate: '64k' },
} as const

export type QualityPreset = keyof typeof HLS_QUALITY_PRESETS

// 비디오 메타데이터
export interface VideoMetadata {
  duration: number // seconds
  width: number
  height: number
  codec: string
  bitrate: number
}

// FFmpeg 명령 생성 (로컬 서버용)
export function generateFFmpegCommand(
  inputPath: string,
  outputDir: string,
  qualities: QualityPreset[] = ['720p', '480p', '360p']
): string {
  const commands: string[] = []

  for (const quality of qualities) {
    const preset = HLS_QUALITY_PRESETS[quality]
    const outputPath = `${outputDir}/${quality}.m3u8`

    commands.push(`
      ffmpeg -i "${inputPath}" \\
        -vf "scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2" \\
        -c:v libx264 -preset fast -crf 22 \\
        -b:v ${preset.videoBitrate} -maxrate ${preset.videoBitrate} -bufsize ${parseInt(preset.videoBitrate) * 2}k \\
        -c:a aac -b:a ${preset.audioBitrate} \\
        -hls_time 6 -hls_playlist_type vod \\
        -hls_segment_filename "${outputDir}/segments/${quality}_%03d.ts" \\
        "${outputPath}"
    `.trim())
  }

  return commands.join('\n\n')
}

// 마스터 플레이리스트 생성
export function generateMasterPlaylist(
  videoId: string,
  qualities: QualityPreset[]
): string {
  let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n\n'

  for (const quality of qualities) {
    const preset = HLS_QUALITY_PRESETS[quality]
    const bandwidth = parseInt(preset.videoBitrate) * 1000
    playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${preset.width}x${preset.height}\n`
    playlist += `${quality}.m3u8\n`
  }

  return playlist
}

// R2에 HLS 파일 업로드
export async function uploadHLSToR2(
  videoId: string,
  content: Buffer | string,
  fileName: string,
  contentType: string = 'application/vnd.apple.mpegurl'
): Promise<string> {
  const key = `hls/${videoId}/${fileName}`

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: typeof content === 'string' ? Buffer.from(content) : content,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000',
  })

  await r2Client.send(command)
  return `${R2_PUBLIC_URL}/${key}`
}

// 트랜스코딩 작업 상태
export type TranscodingStatus = 'pending' | 'processing' | 'ready' | 'failed'

// 비디오 정보에서 적절한 품질 목록 결정
export function determineQualities(width: number, height: number): QualityPreset[] {
  const qualities: QualityPreset[] = []
  const maxDimension = Math.max(width, height)

  if (maxDimension >= 1920) {
    qualities.push('1080p')
  }
  if (maxDimension >= 1280) {
    qualities.push('720p')
  }
  if (maxDimension >= 854) {
    qualities.push('480p')
  }
  qualities.push('360p') // 항상 포함

  return qualities
}

// HLS URL 생성
export function getHLSMasterUrl(videoId: string): string {
  return `/api/image/hls/${videoId}/master.m3u8`
}
