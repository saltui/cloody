import { NextRequest, NextResponse } from 'next/server'
import { verifyUserSessionToken, findUserById } from '@/lib/user-auth'
import { hasPermission } from '@/lib/rbac'
import { supabase } from '@/lib/supabase'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

// Verify audit log chain integrity
async function verifyAuditChain(): Promise<{ valid: boolean; errors: string[] }> {
  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select('id, action, ip, user_agent, details, created_at, prev_hash, hash')
    .order('created_at', { ascending: true })

  if (error) {
    return { valid: false, errors: ['Failed to fetch audit logs'] }
  }

  const errors: string[] = []
  let prevHash = ''

  for (const log of logs || []) {
    // Calculate expected hash
    const content = JSON.stringify({
      id: log.id,
      action: log.action,
      ip: log.ip,
      user_agent: log.user_agent,
      details: log.details,
      created_at: log.created_at,
      prev_hash: prevHash
    })
    const expectedHash = crypto.createHash('sha256').update(content).digest('hex')

    // Verify hash matches
    if (log.hash && log.hash !== expectedHash) {
      errors.push(`Hash mismatch at log ${log.id} (${log.created_at})`)
    }

    // Verify previous hash matches
    if (log.prev_hash !== prevHash) {
      errors.push(`Previous hash mismatch at log ${log.id} (${log.created_at})`)
    }

    prevHash = log.hash || expectedHash
  }

  return { valid: errors.length === 0, errors }
}

// GET: Query audit logs with filters
export async function GET(request: NextRequest) {
  const ip = getClientIP(request)

  // User authentication
  const sessionCookie = request.cookies.get('gallery_session')
  if (!sessionCookie) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const validation = verifyUserSessionToken(sessionCookie.value, ip)
  if (!validation.valid || !validation.userId) {
    return NextResponse.json({ error: '세션이 만료되었습니다.' }, { status: 401 })
  }

  const user = await findUserById(validation.userId)
  if (!user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 401 })
  }

  try {
    // Get org_id from headers (set by middleware)
    const orgId = request.headers.get('x-org-id')
    if (!orgId) {
      return NextResponse.json({ error: '조직 정보를 찾을 수 없습니다.' }, { status: 403 })
    }

    // Check RBAC permission for audit:view
    const canView = await hasPermission(user.id, orgId, 'audit:view')
    if (!canView) {
      return NextResponse.json({ error: '감사 로그 조회 권한이 없습니다.' }, { status: 403 })
    }

    // Check if verification is requested
    const { searchParams } = new URL(request.url)
    const shouldVerify = searchParams.get('verify') === 'true'

    if (shouldVerify) {
      const verification = await verifyAuditChain()
      return NextResponse.json({ verification })
    }

    // Parse query parameters for filtering
    const userId = searchParams.get('userId')
    const resourceType = searchParams.get('resourceType')
    const action = searchParams.get('action')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const limit = parseInt(searchParams.get('limit') || '100', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // Build query
    let query = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })

    // Apply filters
    if (userId) {
      query = query.eq('user_id', userId)
    }
    if (resourceType) {
      query = query.eq('details->resource_type', resourceType)
    }
    if (action) {
      query = query.eq('action', action)
    }
    if (startDate) {
      query = query.gte('created_at', startDate)
    }
    if (endDate) {
      query = query.lte('created_at', endDate)
    }

    // Apply pagination
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      throw error
    }

    return NextResponse.json({
      logs: data || [],
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit
      }
    })
  } catch (error) {
    console.error('Failed to query audit logs:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to query audit logs' },
      { status: 500 }
    )
  }
}
