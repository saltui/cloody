import { OTP, generateSecret as otpGenerateSecret, generateURI } from 'otplib'

// OTP 인스턴스 생성
const otp = new OTP({
  strategy: 'totp',
})

// TOTP Secret은 환경변수에 저장 (최초 설정 시 생성)
export function getTotpSecret(): string | null {
  return process.env.TOTP_SECRET || null
}

// 새 TOTP Secret 생성
export function generateTotpSecret(): string {
  return otpGenerateSecret()
}

// TOTP 코드 검증
export function verifyTotpCode(token: string): boolean {
  const secret = getTotpSecret()
  if (!secret) return false

  try {
    // epochTolerance: 1 = 앞뒤 30초씩 허용 (동기화 오차 대비)
    const result = otp.verifySync({ secret, token, epochTolerance: 1 })
    return result.valid
  } catch {
    return false
  }
}

// QR 코드용 OTPAuth URL 생성
export function getTotpUri(secret: string, accountName = 'Cloody'): string {
  return generateURI({
    strategy: 'totp',
    issuer: 'Cloody',
    label: accountName,
    secret,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
  })
}

// 2FA 활성화 여부 확인
export function is2FAEnabled(): boolean {
  return !!getTotpSecret()
}

// 현재 TOTP 코드 생성 (테스트용)
export function generateCurrentCode(): string | null {
  const secret = getTotpSecret()
  if (!secret) return null
  return otp.generateSync({ secret })
}
