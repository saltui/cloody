import { NextRequest, NextResponse } from 'next/server'
import { verifyUserSessionToken, findUserById } from '@/lib/user-auth'
import { hasPermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { getPolicies, createPolicy } from '@/lib/retention'
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

// GET: List retention policies for org
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

    const policies = await getPolicies(orgId)

    return NextResponse.json({ policies })
  } catch (error) {
    console.error('Failed to get retention policies:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get retention policies' },
      { status: 500 }
    )
  }
}

// POST: Create new policy
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
    const { name, retentionDays, action, requiresApproval } = body

    // Validate input
    if (!name || typeof retentionDays !== 'number' || !action) {
      return NextResponse.json(
        { error: 'name, retentionDays, and action are required' },
        { status: 400 }
      )
    }

    if (!['archive', 'delete', 'review'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be archive, delete, or review' },
        { status: 400 }
      )
    }

    const policy = await createPolicy(
      orgId,
      name,
      retentionDays,
      action,
      requiresApproval || false
    )

    // Log audit
    logAudit({
      action: 'UPLOAD',
      ip,
      userAgent,
      details: {
        action: 'create_retention_policy',
        policyId: policy.id,
        policyName: name,
        retentionDays,
        policyAction: action
      }
    })

    return NextResponse.json({ policy })
  } catch (error) {
    console.error('Failed to create retention policy:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create retention policy' },
      { status: 500 }
    )
  }
}

// PUT: Update policy
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

    // Check RBAC permission for retention:manage
    const canManage = await hasPermission(user.id, orgId, 'retention:manage')
    if (!canManage) {
      return NextResponse.json({ error: '보존 정책 관리 권한이 없습니다.' }, { status: 403 })
    }

    const body = await request.json()
    const { id, name, retentionDays, action, requiresApproval } = body

    if (!id) {
      return NextResponse.json({ error: 'Policy ID is required' }, { status: 400 })
    }

    // Build update object
    const updates: any = { updated_at: new Date().toISOString() }
    if (name !== undefined) updates.name = name
    if (retentionDays !== undefined) updates.retention_days = retentionDays
    if (action !== undefined) {
      if (!['archive', 'delete', 'review'].includes(action)) {
        return NextResponse.json(
          { error: 'action must be archive, delete, or review' },
          { status: 400 }
        )
      }
      updates.action = action
    }
    if (requiresApproval !== undefined) updates.requires_approval = requiresApproval

    const { data, error } = await supabase
      .from('retention_policies')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) {
      throw error
    }

    // Log audit
    logAudit({
      action: 'UPLOAD',
      ip,
      userAgent,
      details: {
        action: 'update_retention_policy',
        policyId: id,
        updates
      }
    })

    return NextResponse.json({ policy: data })
  } catch (error) {
    console.error('Failed to update retention policy:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update retention policy' },
      { status: 500 }
    )
  }
}

// DELETE: Delete policy
export async function DELETE(request: NextRequest) {
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

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Policy ID is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('retention_policies')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)

    if (error) {
      throw error
    }

    // Log audit
    logAudit({
      action: 'DELETE',
      ip,
      userAgent,
      details: {
        action: 'delete_retention_policy',
        policyId: id
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete retention policy:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete retention policy' },
      { status: 500 }
    )
  }
}
