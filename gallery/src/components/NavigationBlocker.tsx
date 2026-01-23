'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUpload } from '@/lib/upload-context'

export default function NavigationBlocker() {
  const { uploading } = useUpload()
  const router = useRouter()

  useEffect(() => {
    if (!uploading) return

    // 브라우저 새로고침/닫기 차단
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '업로드가 진행 중입니다. 페이지를 떠나면 업로드가 중단됩니다.'
      return e.returnValue
    }

    // 링크 클릭 가로채기
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const link = target.closest('a')

      if (link && link.href && !link.href.startsWith('javascript:')) {
        const isSameOrigin = link.href.startsWith(window.location.origin)

        if (isSameOrigin) {
          const confirmed = window.confirm('업로드가 진행 중입니다. 페이지를 이동하면 업로드가 중단됩니다. 계속하시겠습니까?')
          if (!confirmed) {
            e.preventDefault()
            e.stopPropagation()
          }
        }
      }
    }

    // router.push 가로채기는 어려우므로 뒤로가기 차단
    const handlePopState = (e: PopStateEvent) => {
      if (uploading) {
        const confirmed = window.confirm('업로드가 진행 중입니다. 페이지를 이동하면 업로드가 중단됩니다. 계속하시겠습니까?')
        if (!confirmed) {
          // 뒤로가기 취소 - 현재 상태로 다시 push
          window.history.pushState(null, '', window.location.href)
        }
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleClick, true)
    window.addEventListener('popstate', handlePopState)

    // 히스토리에 상태 추가해서 뒤로가기 감지 가능하게
    window.history.pushState(null, '', window.location.href)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleClick, true)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [uploading])

  return null
}
