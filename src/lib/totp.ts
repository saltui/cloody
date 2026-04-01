import { OTP, generateSecret as otpGenerateSecret, generateURI } from 'otplib'

// OTP 인스턴스 생성
const otp = new OTP({
  strategy: 'totp',
})

// 새 TOTP Secret 생성
export function generateTotpSecret(): string {
  return otpGenerateSecret()
}

// QR 코드용 OTPAuth URL 생성
export function getTotpUri(secret: string, email = 'Cloody'): string {
  return generateURI({
    strategy: 'totp',
    issuer: 'Cloody',
    label: email,
    secret,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
  })
}

// TOTP 코드 검증 (per-user secret)
export function verifyTotpCode(token: string, secret: string): boolean {
  if (!secret) return false

  try {
    // epochTolerance: 1 = 앞뒤 30초씩 허용 (동기화 오차 대비)
    const result = otp.verifySync({ secret, token, epochTolerance: 1 })
    return result.valid
  } catch (error) {
    console.error('[totp] verifyTotpCode failed:', error)
    return false
  }
}
