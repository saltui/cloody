import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// 간단한 메모리 캐시 (1분)
const cache = new Map<string, { usage: number; timestamp: number }>()
const CACHE_TTL = 60 * 1000

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return NextResponse.json({ usage: 0 })
  }

  // 캐시 확인
  const cached = cache.get(userId)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(
      { usage: cached.usage },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    )
  }

  try {
    // 사용자의 사진 수를 가져와서 추정치 계산
    // TODO: photos 테이블에 file_size 컬럼 추가 후 정확한 계산으로 변경
    const { count } = await supabase
      .from('photos')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)

    // 사진당 평균 2MB로 추정 (실제로는 file_size 컬럼으로 계산해야 함)
    const estimatedUsage = (count || 0) * 2 * 1024 * 1024

    // 캐시 저장
    cache.set(userId, { usage: estimatedUsage, timestamp: Date.now() })

    return NextResponse.json(
      { usage: estimatedUsage },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    )
  } catch (error) {
    console.error('Storage usage error:', error)
    return NextResponse.json({ error: 'Failed to get storage usage' }, { status: 500 })
  }
}
