// R2 URL → Next.js 프록시 URL 변환 (이미지용: HEIC 변환, 캐싱)
export function toProxyUrl(url: string): string {
  if (url.includes('.r2.dev/')) {
    const parts = url.split('.r2.dev/')
    if (parts.length > 1) {
      const fileName = parts[1].split('?')[0]
      return `/api/image/${fileName}`
    }
  }
  if (url.includes('.r2.cloudflarestorage.com/')) {
    try {
      const urlObj = new URL(url)
      const pathParts = urlObj.pathname.split('/')
      if (pathParts.length > 2) {
        const fileName = pathParts.slice(2).join('/')
        return `/api/image/${fileName}`
      }
    } catch {
      // invalid URL
    }
  }
  return url
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'm4v', '3gp', '3g2'])

export function isVideoFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return VIDEO_EXTS.has(ext)
}

// 비디오 재생용: R2에서 직접 서빙 (프록시 경유 X → 속도 대폭 개선)
// UUID 기반 파일명이라 추측 불가, CSP media-src에 *.r2.dev 이미 허용
export function toDirectVideoUrl(url: string): string {
  // 이미 프록시 URL이면 원본 R2 URL을 모르므로 그대로 반환
  if (url.startsWith('/api/')) return url
  // R2 URL이면 쿼리 파라미터만 제거하고 직접 반환
  return url.split('?')[0]
}
