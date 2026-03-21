import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getStorageUsage } from '@/lib/r2'
import { verifyUserSessionToken } from '@/lib/auth'
import { getClientIP } from '@/lib/request-utils'

// 간단한 메모리 캐시 (15초)
const cache = new Map<string, { usage: number; timestamp: number }>()
const CACHE_TTL = 15 * 1000
const R2_CACHE_TTL = 20 * 1000
let r2Cache: { usage: number; timestamp: number } | null = null

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string }
  const message = `${candidate.message || ''} ${candidate.details || ''} ${candidate.hint || ''}`.toLowerCase()
  return candidate.code === '42703'
    || candidate.code === 'PGRST204'
    || (message.includes('column') && message.includes(columnName.toLowerCase()))
}

export async function GET(request: NextRequest) {
  const ip = getClientIP(request)
  const sessionCookie = request.cookies.get('gallery_session')?.value
  const sessionValidation = sessionCookie
    ? verifyUserSessionToken(sessionCookie, ip)
    : { valid: false, userId: undefined as string | undefined }

  const userId = sessionValidation.valid && sessionValidation.userId
    ? sessionValidation.userId
    : request.headers.get('x-user-id')
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1'
  const includeR2 = request.nextUrl.searchParams.get('includeR2') === '1'
  const shouldBypassCache = forceRefresh

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    const baseQuery = supabase
      .from('photos')
      .select('file_size')
      .eq('user_id', userId)
    let { data, error } = await baseQuery.is('deleted_at', null)

    // 구버전 스키마 호환: deleted_at 컬럼이 없으면 필터 없이 합산
    if (error && isMissingColumnError(error, 'deleted_at')) {
      const fallback = await baseQuery
      data = fallback.data
      error = fallback.error
    }
    if (error) throw error

    const totalUsage = (data || []).reduce((sum, photo) => {
      const fileSize = Number((photo as { file_size?: number | string | null }).file_size ?? 0)
      return sum + (Number.isFinite(fileSize) ? fileSize : 0)
    }, 0)

    // 캐시 저장
    cache.set(userId, { usage: totalUsage, timestamp: Date.now() })

    let r2Usage: number | null = null
    if (includeR2) {
      const isR2CacheValid = !shouldBypassCache && r2Cache && Date.now() - r2Cache.timestamp < R2_CACHE_TTL
      if (isR2CacheValid && r2Cache) {
        r2Usage = r2Cache.usage
      } else {
        try {
          r2Usage = await getStorageUsage()
          r2Cache = { usage: r2Usage, timestamp: Date.now() }
        } catch (r2Error) {
          console.error('R2 usage error:', r2Error)
        }
      }
    }

    const effectiveUsage = includeR2 && r2Usage !== null
      ? Math.max(totalUsage, r2Usage)
      : totalUsage

    return NextResponse.json(
      includeR2
        ? {
            usage: effectiveUsage,
            logicalUsage: totalUsage,
            bucketUsage: r2Usage,
            maxUsage: effectiveUsage,
          }
        : { usage: totalUsage },
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
