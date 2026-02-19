import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getStorageUsage } from '@/lib/r2'

// 간단한 메모리 캐시 (15초)
const cache = new Map<string, { usage: number; timestamp: number }>()
const CACHE_TTL = 15 * 1000

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1'
  const includeR2 = request.nextUrl.searchParams.get('includeR2') === '1'
  const shouldBypassCache = forceRefresh || includeR2

  if (!userId) {
    return NextResponse.json({ usage: 0 })
  }

  // 캐시 확인
  const cached = cache.get(userId)
  if (!shouldBypassCache && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(
      { usage: cached.usage },
      { headers: { 'Cache-Control': 'private, max-age=15' } }
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

    let r2Usage: number | null = null
    if (includeR2) {
      try {
        r2Usage = await getStorageUsage()
      } catch (r2Error) {
        console.error('R2 usage error:', r2Error)
      }
    }

    return NextResponse.json(
      includeR2 ? { usage: totalUsage, r2Usage } : { usage: totalUsage },
      {
        headers: {
          'Cache-Control': shouldBypassCache ? 'no-store' : 'private, max-age=15'
        }
      }
    )
  } catch (error) {
    console.error('Storage usage error:', error)
    return NextResponse.json({ error: 'Failed to get storage usage' }, { status: 500 })
  }
}
