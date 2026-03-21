import { randomBytes } from 'crypto'
import { RateLimiter } from '../rate-limit'
import { signGalleryToken, verifyGalleryToken } from '../token'

const TOKEN_EXPIRY = 30 * 24 * 60 * 60 * 1000 // 30일 (밀리초)
const SESSION_TIMEOUT = 7 * 24 * 60 * 60 * 1000 // 7일 비활동 시 타임아웃

// 세션 토큰 생성 (IP 바인딩 포함)
export function createSessionToken(ip: string): string {
  const sessionId = randomBytes(32).toString('base64url')
  const createdAt = Date.now()
  const expiresAt = createdAt + TOKEN_EXPIRY
  const lastActivity = createdAt

  return signGalleryToken({ sessionId, createdAt, expiresAt, ip, lastActivity })
}

// 세션 토큰 갱신 (활동 시간 업데이트)
export function refreshSessionToken(token: string, currentIp: string): string | null {
  try {
    const payload = verifyGalleryToken(token)
    if (!payload) return null

    // IP 검증
    if (payload.ip !== currentIp) return null

    // 만료 확인
    if (Date.now() > payload.expiresAt) return null

    // 새 토큰 생성 (활동 시간 갱신)
    return signGalleryToken({ ...payload, lastActivity: Date.now() })
  } catch (error) {
    console.error('[auth] refreshSessionToken failed:', error)
    return null
  }
}

// 세션 토큰 검증 (IP 바인딩 + 세션 타임아웃 포함)
export function verifySessionToken(token: string, currentIp?: string): { valid: boolean; reason?: string } {
  try {
    const payload = verifyGalleryToken(token)
    if (!payload) return { valid: false, reason: 'invalid_signature' }

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
  } catch (error) {
    console.error('[auth] verifySessionToken failed:', error)
    return { valid: false, reason: 'parse_error' }
  }
}

// 간단한 검증 (하위 호환성)
export function isSessionValid(token: string): boolean {
  return verifySessionToken(token).valid
}

// Rate limiting을 위한 메모리 저장소 (프로덕션에서는 Redis 권장)
const rateLimiter = new RateLimiter(5, 15 * 60 * 1000)

export function checkRateLimit(ip: string) { return rateLimiter.check(ip) }
export function recordFailedAttempt(ip: string) { rateLimiter.record(ip) }
export function clearAttempts(ip: string) { rateLimiter.clear(ip) }
