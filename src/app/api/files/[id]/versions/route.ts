import { NextRequest, NextResponse } from 'next/server'
import { getVersions, createVersion } from '@/lib/versioning'
import { verifyUserSessionToken, findUserById } from '@/lib/user-auth'
import { hasPermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { uploadToR2 } from '@/lib/r2'
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

// GET: List versions for a file
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Check RBAC permission for document:read
    const canRead = await hasPermission(user.id, orgId, 'document:read')
    if (!canRead) {
      return NextResponse.json({ error: '문서 읽기 권한이 없습니다.' }, { status: 403 })
    }

    const { id } = await params
    const photoId = id
    const versions = await getVersions(photoId)

    // Log audit
    logAudit({
      action: 'VIEW',
      ip,
      userAgent,
      details: {
        photoId,
        action: 'list_versions',
        versionCount: versions.length
      }
    })

    return NextResponse.json({ versions })
  } catch (error) {
    console.error('Failed to get versions:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get versions' },
      { status: 500 }
    )
  }
}

// POST: Create new version
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Check RBAC permission for document:write
    const canWrite = await hasPermission(user.id, orgId, 'document:write')
    if (!canWrite) {
      return NextResponse.json({ error: '문서 쓰기 권한이 없습니다.' }, { status: 403 })
    }

    const { id } = await params
    const photoId = id
    const formData = await request.formData()
    const file = formData.get('file') as File
    const changeReason = formData.get('changeReason') as string | null

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    // Upload new version to R2
    const buffer = Buffer.from(await file.arrayBuffer())
    const fileName = `${photoId}-v${Date.now()}-${file.name}`
    const url = await uploadToR2(fileName, buffer, file.type)

    // Calculate file hash
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex')

    // Create version record
    const version = await createVersion(
      photoId,
      url,
      file.size,
      fileHash,
      user.id,
      changeReason || undefined
    )

    // Log audit
    logAudit({
      action: 'UPLOAD',
      ip,
      userAgent,
      details: {
        photoId,
        action: 'create_version',
        versionNumber: version.version_number,
        fileSize: file.size,
        changeReason: changeReason || undefined
      }
    })

    return NextResponse.json({ version })
  } catch (error) {
    console.error('Failed to create version:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create version' },
      { status: 500 }
    )
  }
}
