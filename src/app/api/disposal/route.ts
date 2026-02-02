import { NextRequest, NextResponse } from 'next/server'
import { verifyUserSessionToken, findUserById } from '@/lib/user-auth'
import { hasPermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { requestDisposal, approveDisposal, rejectDisposal } from '@/lib/retention'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

// GET: List disposal requests
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

    // Check RBAC permission for retention:manage
    const canManage = await hasPermission(user.id, orgId, 'retention:manage')
    if (!canManage) {
      return NextResponse.json({ error: '보존 정책 관리 권한이 없습니다.' }, { status: 403 })
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') // pending, approved, rejected, completed

    // Build query
    let query = supabase
      .from('disposal_requests')
      .select(`
        *,
        photos (
          id,
          filename,
          org_id
        ),
        retention_policies (
          id,
          name,
          action
        )
      `)
      .order('requested_at', { ascending: false })

    // Filter by status if provided
    if (status && ['pending', 'approved', 'rejected', 'completed'].includes(status)) {
      query = query.eq('status', status)
    }

    const { data, error } = await query

    if (error) {
      throw error
    }

    return NextResponse.json({ requests: data || [] })
  } catch (error) {
    console.error('Failed to get disposal requests:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get disposal requests' },
      { status: 500 }
    )
  }
}

// POST: Create disposal request
export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

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

    // Check RBAC permission for retention:manage
    const canManage = await hasPermission(user.id, orgId, 'retention:manage')
    if (!canManage) {
      return NextResponse.json({ error: '보존 정책 관리 권한이 없습니다.' }, { status: 403 })
    }

    const body = await request.json()
    const { photoId, reason } = body

    if (!photoId || !reason) {
      return NextResponse.json(
        { error: 'photoId and reason are required' },
        { status: 400 }
      )
    }

    const disposalRequest = await requestDisposal(photoId, user.id, reason)

    // Log audit
    logAudit({
      action: 'UPLOAD',
      ip,
      userAgent,
      details: {
        action: 'create_disposal_request',
        requestId: disposalRequest.id,
        photoId,
        reason
      }
    })

    return NextResponse.json({ request: disposalRequest })
  } catch (error) {
    console.error('Failed to create disposal request:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create disposal request' },
      { status: 500 }
    )
  }
}

// PUT: Approve or reject disposal request
export async function PUT(request: NextRequest) {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

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

    // Check RBAC permission for retention:manage (needed for approval)
    const canManage = await hasPermission(user.id, orgId, 'retention:manage')
    if (!canManage) {
      return NextResponse.json({ error: '보존 정책 관리 권한이 없습니다.' }, { status: 403 })
    }

    const body = await request.json()
    const { requestId, action } = body

    if (!requestId || !action) {
      return NextResponse.json(
        { error: 'requestId and action are required' },
        { status: 400 }
      )
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be approve or reject' },
        { status: 400 }
      )
    }

    if (action === 'approve') {
      await approveDisposal(requestId, user.id)

      // Log audit
      logAudit({
        action: 'UPLOAD',
        ip,
        userAgent,
        details: {
          action: 'approve_disposal_request',
          requestId
        }
      })

      return NextResponse.json({ success: true, action: 'approved' })
    } else {
      await rejectDisposal(requestId, user.id)

      // Log audit
      logAudit({
        action: 'UPLOAD',
        ip,
        userAgent,
        details: {
          action: 'reject_disposal_request',
          requestId
        }
      })

      return NextResponse.json({ success: true, action: 'rejected' })
    }
  } catch (error) {
    console.error('Failed to process disposal request:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process disposal request' },
      { status: 500 }
    )
  }
}
