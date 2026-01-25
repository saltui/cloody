'use client'

import { useState, useEffect, ImgHTMLAttributes, memo } from 'react'
import { useSignedUrl } from '@/lib/signed-url-context'

interface SecureImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string
  fallbackSrc?: string
}

export default memo(function SecureImage({ src, fallbackSrc, alt = '', ...props }: SecureImageProps) {
  const { getSignedUrl } = useSignedUrl()
  const [signedSrc, setSignedSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    // R2 URL이 아니면 바로 사용
    if (!src.includes('.r2.dev')) {
      setSignedSrc(src)
      return
    }

    getSignedUrl(src).then(url => {
      if (!cancelled) {
        setSignedSrc(url)
      }
    })

    return () => {
      cancelled = true
    }
  }, [src, getSignedUrl])

  if (!signedSrc) {
    // 로딩 중 - 빈 placeholder 또는 스켈레톤
    return (
      <div
        className={props.className}
        style={{ backgroundColor: '#1f1f1f', ...props.style }}
      />
    )
  }

  if (error && fallbackSrc) {
    return <img src={fallbackSrc} alt={alt} loading="lazy" decoding="async" {...props} />
  }

  return (
    <img
      src={signedSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setError(true)}
      {...props}
    />
  )
})
