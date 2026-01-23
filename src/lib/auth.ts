import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const SECRET_KEY = process.env.GALLERY_PASSWORD || 'fallback-secret-key'
const TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000 // 7일 (밀리초)
const SESSION_TIMEOUT = 30 * 60 * 1000 // 30분 비활동 시 타임아웃

interface SessionToken {
  sessionId: string
  createdAt: number
  expiresAt: number
  ip: string // IP 바인딩
  lastActivity: number // 마지막 활동 시간
}

// 토큰 서명 생성
function createSignature(data: string): string {
  return createHmac('sha256', SECRET_KEY)
    .update(data)
    .digest('base64url')
}

// 세션 토큰 생성 (IP 바인딩 포함)
export function createSessionToken(ip: string): string {
  const sessionId = randomBytes(32).toString('base64url')
  const createdAt = Date.now()
  const expiresAt = createdAt + TOKEN_EXPIRY
  const lastActivity = createdAt

  const payload: SessionToken = { sessionId, createdAt, expiresAt, ip, lastActivity }
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createSignature(payloadStr)

  return `${payloadStr}.${signature}`
}

// 세션 토큰 갱신 (활동 시간 업데이트)
export function refreshSessionToken(token: string, currentIp: string): string | null {
  try {
    const [payloadStr, signature] = token.split('.')
    if (!payloadStr || !signature) return null

    // 서명 검증
    const expectedSignature = createSignature(payloadStr)
    const signatureBuffer = Buffer.from(signature, 'base64url')
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url')

    if (signatureBuffer.length !== expectedBuffer.length) return null
    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null

    const payload: SessionToken = JSON.parse(
      Buffer.from(payloadStr, 'base64url').toString()
    )

    // IP 검증
    if (payload.ip !== currentIp) return null

    // 만료 확인
    if (Date.now() > payload.expiresAt) return null

    // 새 토큰 생성 (활동 시간 갱신)
    const newPayload: SessionToken = {
      ...payload,
      lastActivity: Date.now()
    }
    const newPayloadStr = Buffer.from(JSON.stringify(newPayload)).toString('base64url')
    const newSignature = createSignature(newPayloadStr)

    return `${newPayloadStr}.${newSignature}`
  } catch {
    return null
  }
}

// 세션 토큰 검증 (IP 바인딩 + 세션 타임아웃 포함)
export function verifySessionToken(token: string, currentIp?: string): { valid: boolean; reason?: string } {
  try {
    const [payloadStr, signature] = token.split('.')
    if (!payloadStr || !signature) return { valid: false, reason: 'invalid_format' }

    // 서명 검증 (타이밍 공격 방지)
    const expectedSignature = createSignature(payloadStr)
    const signatureBuffer = Buffer.from(signature, 'base64url')
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url')

    if (signatureBuffer.length !== expectedBuffer.length) return { valid: false, reason: 'invalid_signature' }
    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return { valid: false, reason: 'invalid_signature' }

    // 페이로드 파싱
    const payload: SessionToken = JSON.parse(
      Buffer.from(payloadStr, 'base64url').toString()
    )

    // 만료 시간 확인
    if (Date.now() > payload.expiresAt) return { valid: false, reason: 'expired' }

    // IP 바인딩 확인 (IP가 제공된 경우)
    if (currentIp && payload.ip && payload.ip !== currentIp) {
      return { valid: false, reason: 'ip_mismatch' }
    }

    // 세션 타임아웃 확인
    if (payload.lastActivity && Date.now() - payload.lastActivity > SESSION_TIMEOUT) {
      return { valid: false, reason: 'session_timeout' }
    }

    return { valid: true }
  } catch {
    return { valid: false, reason: 'parse_error' }
  }
}

// 간단한 검증 (하위 호환성)
export function isSessionValid(token: string): boolean {
  return verifySessionToken(token).valid
}

// Rate limiting을 위한 메모리 저장소 (프로덕션에서는 Redis 권장)
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

const MAX_ATTEMPTS = 5
const LOCKOUT_DURATION = 15 * 60 * 1000 // 15분

// 로그인 시도 확인 및 기록
export function checkRateLimit(ip: string): { allowed: boolean; remainingAttempts: number; resetAt?: number } {
  // 100회 호출마다 오래된 기록 정리 (메모리 관리)
  if (loginAttempts.size > 100) {
    cleanupOldRecords()
  }

  const now = Date.now()
  const record = loginAttempts.get(ip)

  // 기록이 없거나 리셋 시간이 지났으면 허용
  if (!record || now > record.resetAt) {
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS }
  }

  // 시도 횟수 초과
  if (record.count >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      remainingAttempts: 0,
      resetAt: record.resetAt
    }
  }

  return {
    allowed: true,
    remainingAttempts: MAX_ATTEMPTS - record.count
  }
}

// 실패한 로그인 시도 기록
export function recordFailedAttempt(ip: string): void {
  const now = Date.now()
  const record = loginAttempts.get(ip)

  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, {
      count: 1,
      resetAt: now + LOCKOUT_DURATION
    })
  } else {
    record.count++
  }
}

// 성공한 로그인 시 기록 초기화
export function clearAttempts(ip: string): void {
  loginAttempts.delete(ip)
}

// 오래된 기록 정리 (checkRateLimit 호출 시 자동 정리)
function cleanupOldRecords(): void {
  const now = Date.now()
  for (const [ip, record] of loginAttempts.entries()) {
    if (now > record.resetAt) {
      loginAttempts.delete(ip)
    }
  }
}
