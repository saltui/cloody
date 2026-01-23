'use client'

import { createContext, useContext, useCallback, ReactNode } from 'react'

interface SignedUrlContextType {
  getSignedUrl: (originalUrl: string) => Promise<string>
  getSignedUrls: (originalUrls: string[]) => Promise<Record<string, string>>
  preloadUrls: (originalUrls: string[]) => void
}

const SignedUrlContext = createContext<SignedUrlContextType | null>(null)

// R2 URL을 프록시 URL로 변환
function toProxyUrl(originalUrl: string): string {
  // R2 public URL 패턴: https://pub-xxx.r2.dev/filename
  // 또는 signed URL: https://xxx.r2.cloudflarestorage.com/bucket/filename?...

  // R2 public URL인 경우
  if (originalUrl.includes('.r2.dev/')) {
    const parts = originalUrl.split('.r2.dev/')
    if (parts.length > 1) {
      const fileName = parts[1].split('?')[0] // 쿼리 파라미터 제거
      return `/api/image/${fileName}`
    }
  }

  // R2 signed URL인 경우 (cloudflarestorage.com)
  if (originalUrl.includes('.r2.cloudflarestorage.com/')) {
    // https://xxx.r2.cloudflarestorage.com/bucket/filename?signature...
    const url = new URL(originalUrl)
    const pathParts = url.pathname.split('/')
    // 첫 번째는 빈 문자열, 두 번째는 버킷명, 나머지가 파일 경로
    if (pathParts.length > 2) {
      const fileName = pathParts.slice(2).join('/')
      return `/api/image/${fileName}`
    }
  }

  return originalUrl
}

export function SignedUrlProvider({ children }: { children: ReactNode }) {
  // 단일 URL 변환 (프록시 URL로 변환 - API 호출 없음)
  const getSignedUrl = useCallback(async (originalUrl: string): Promise<string> => {
    // R2 URL이 아니면 그대로 반환
    if (!originalUrl.includes('.r2.dev') && !originalUrl.includes('.r2.cloudflarestorage.com')) {
      return originalUrl
    }

    return toProxyUrl(originalUrl)
  }, [])

  // 여러 URL 배치 변환
  const getSignedUrls = useCallback(async (originalUrls: string[]): Promise<Record<string, string>> => {
    const result: Record<string, string> = {}

    for (const url of originalUrls) {
      result[url] = toProxyUrl(url)
    }

    return result
  }, [])

  // preload는 이제 필요 없지만 인터페이스 유지
  const preloadUrls = useCallback(() => {
    // 프록시 사용 시 preload 불필요
  }, [])

  return (
    <SignedUrlContext.Provider value={{ getSignedUrl, getSignedUrls, preloadUrls }}>
      {children}
    </SignedUrlContext.Provider>
  )
}

export function useSignedUrl() {
  const context = useContext(SignedUrlContext)
  if (!context) {
    throw new Error('useSignedUrl must be used within SignedUrlProvider')
  }
  return context
}
