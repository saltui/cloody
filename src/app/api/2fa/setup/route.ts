import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { generateTotpSecret, getTotpUri, getTotpSecret, is2FAEnabled, verifyTotpCode } from '@/lib/totp'
import { logAudit } from '@/lib/audit'
import { getClientIP } from '@/lib/request-utils'

// GET: 2FA 설정 상태 확인
export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const enabled = is2FAEnabled()
  const existingSecret = getTotpSecret()

  // 이미 활성화됨 (환경변수에 TOTP_SECRET 있음)
  if (enabled && existingSecret) {
    const uri = getTotpUri(existingSecret)
    const qrCode = await QRCode.toDataURL(uri)

    return NextResponse.json({
      enabled: true,
      qrCode,
      message: '2FA가 활성화되어 있습니다.'
    })
  }

  // 새 Secret 생성 (환경변수에 설정 필요)
  const secret = generateTotpSecret()
  const uri = getTotpUri(secret)
  const qrCode = await QRCode.toDataURL(uri)

  return NextResponse.json({
    enabled: false,
    qrCode,
  })
}

// POST: 2FA 코드 확인 (테스트용)
export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  try {
    const { code } = await request.json()

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    const isValid = verifyTotpCode(code)

    if (isValid) {
      logAudit({
        action: '2FA_VERIFIED',
        ip,
        userAgent
      })
      return NextResponse.json({ success: true, message: '2FA 코드가 확인되었습니다.' })
    }

    logAudit({
      action: '2FA_FAILED',
      ip,
      userAgent
    })

    return NextResponse.json({ success: false, error: '잘못된 2FA 코드입니다.' }, { status: 401 })
  } catch (error) {
    console.error('[2fa] setup POST failed:', error)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
