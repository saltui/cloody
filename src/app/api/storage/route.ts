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
    // 실제 파일 크기 합산 (휴지통 제외)
    const { data, error } = await supabase
      .from('photos')
      .select('file_size')
      .eq('user_id', userId)
      .is('deleted_at', null)

    if (error) throw error

    const totalUsage = (data || []).reduce((sum, photo) => sum + (photo.file_size || 0), 0)

    // 캐시 저장
    cache.set(userId, { usage: totalUsage, timestamp: Date.now() })

    return NextResponse.json(
      { usage: totalUsage },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    )
  } catch (error) {
    console.error('Storage usage error:', error)
    return NextResponse.json({ error: 'Failed to get storage usage' }, { status: 500 })
  }
}
