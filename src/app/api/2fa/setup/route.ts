import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { generateTotpSecret, getTotpUri, verifyTotpCode } from '@/lib/totp'
import { logAudit } from '@/lib/audit'
import { getClientIP } from '@/lib/request-utils'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET: 2FA 설정 상태 확인
export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // DB에서 유저의 totp 정보 조회
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('totp_enabled, totp_secret, email')
    .eq('id', userId)
    .single()

  if (error || !user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // 이미 활성화됨 (DB에 totp_secret 있음)
  if (user.totp_enabled && user.totp_secret) {
    const uri = getTotpUri(user.totp_secret, user.email)
    const qrCode = await QRCode.toDataURL(uri)

    return NextResponse.json({
      enabled: true,
      qrCode,
      message: '2FA가 활성화되어 있습니다.'
    })
  }

  // 새 Secret 생성 (아직 DB에 저장하지 않음 — POST에서 검증 후 저장)
  const secret = generateTotpSecret()
  const uri = getTotpUri(secret, user.email)
  const qrCode = await QRCode.toDataURL(uri)

  return NextResponse.json({
    enabled: false,
    qrCode,
    secret, // 클라이언트가 POST 시 다시 보내야 함
  })
}

// POST: 2FA 코드 검증 후 활성화
export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  try {
    const { code, secret } = await request.json()

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    if (!secret || typeof secret !== 'string') {
      return NextResponse.json({ error: 'Secret is required' }, { status: 400 })
    }

    const isValid = verifyTotpCode(code, secret)

    if (isValid) {
      // DB에 totp_secret 저장 및 totp_enabled 활성화
      const { error } = await supabaseAdmin
        .from('users')
        .update({ totp_secret: secret, totp_enabled: true })
        .eq('id', userId)

      if (error) {
        console.error('[2fa] Failed to save totp_secret:', error)
        return NextResponse.json({ error: 'Failed to enable 2FA' }, { status: 500 })
      }

      logAudit({
        action: '2FA_ENABLED',
        ip,
        userAgent,
      })
      return NextResponse.json({ success: true, message: '2FA가 활성화되었습니다.' })
    }

    logAudit({
      action: '2FA_FAILED',
      ip,
      userAgent,
    })

    return NextResponse.json({ success: false, error: '잘못된 2FA 코드입니다.' }, { status: 401 })
  } catch (error) {
    console.error('[2fa] setup POST failed:', error)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}

// DELETE: 2FA 비활성화
export async function DELETE(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  const { error } = await supabaseAdmin
    .from('users')
    .update({ totp_enabled: false, totp_secret: null })
    .eq('id', userId)

  if (error) {
    console.error('[2fa] Failed to disable 2FA:', error)
    return NextResponse.json({ error: 'Failed to disable 2FA' }, { status: 500 })
  }

  logAudit({
    action: '2FA_DISABLED',
    ip,
    userAgent,
  })

  return NextResponse.json({ success: true, message: '2FA가 비활성화되었습니다.' })
}
