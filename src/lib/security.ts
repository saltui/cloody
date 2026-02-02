import { createHash, createHmac } from 'crypto'
import { supabase } from './supabase'

// ===========================
// 1. Device Fingerprinting
// ===========================

export function generateDeviceFingerprint(
  userAgent: string,
  ip: string,
  acceptLanguage?: string
): string {
  const components = [
    userAgent,
    ip,
    acceptLanguage || '',
  ].join('|')

  return createHash('sha256').update(components).digest('hex')
}

// ===========================
// 2. Session Management
// ===========================

interface ActiveSession {
  session_id: string
  user_id: string
  device_fingerprint: string
  ip: string
  user_agent: string
  created_at: string
  last_activity: string
  expires_at: string
}

export async function checkConcurrentSessions(
  userId: string,
  maxSessions: number
): Promise<{ allowed: boolean; activeSessions: number }> {
  const now = new Date().toISOString()

  // 만료되지 않은 세션 조회
  const { data, error } = await supabase
    .from('active_sessions')
    .select('session_id')
    .eq('user_id', userId)
    .gt('expires_at', now)

  if (error) {
    console.error('Session check error:', error)
    return { allowed: true, activeSessions: 0 }
  }

  const activeSessions = data?.length || 0

  return {
    allowed: activeSessions < maxSessions,
    activeSessions,
  }
}

export async function terminateOtherSessions(
  userId: string,
  currentSessionId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('active_sessions')
    .delete()
    .eq('user_id', userId)
    .neq('session_id', currentSessionId)
    .select('session_id')

  if (error) {
    console.error('Session termination error:', error)
    return 0
  }

  return data?.length || 0
}

export async function createActiveSession(
  userId: string,
  sessionId: string,
  deviceFingerprint: string,
  ip: string,
  userAgent: string,
  expiresInMs: number
): Promise<boolean> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + expiresInMs)

  const { error } = await supabase
    .from('active_sessions')
    .insert({
      session_id: sessionId,
      user_id: userId,
      device_fingerprint: deviceFingerprint,
      ip,
      user_agent: userAgent,
      created_at: now.toISOString(),
      last_activity: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })

  return !error
}

export async function updateSessionActivity(sessionId: string): Promise<boolean> {
  const { error } = await supabase
    .from('active_sessions')
    .update({ last_activity: new Date().toISOString() })
    .eq('session_id', sessionId)

  return !error
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const { error } = await supabase
    .from('active_sessions')
    .delete()
    .eq('session_id', sessionId)

  return !error
}

// ===========================
// 3. Password Policy
// ===========================

interface PasswordValidation {
  valid: boolean
  errors: string[]
}

export function validatePasswordStrength(password: string): PasswordValidation {
  const errors: string[] = []

  // 최소 길이 12자
  if (password.length < 12) {
    errors.push('비밀번호는 최소 12자 이상이어야 합니다.')
  }

  // 대문자 포함
  if (!/[A-Z]/.test(password)) {
    errors.push('비밀번호는 대문자를 포함해야 합니다.')
  }

  // 소문자 포함
  if (!/[a-z]/.test(password)) {
    errors.push('비밀번호는 소문자를 포함해야 합니다.')
  }

  // 숫자 포함
  if (!/[0-9]/.test(password)) {
    errors.push('비밀번호는 숫자를 포함해야 합니다.')
  }

  // 특수문자 포함
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('비밀번호는 특수문자를 포함해야 합니다.')
  }

  // 일반적인 패턴 체크
  const commonPatterns = [
    /^(.)\1+$/, // 모두 같은 문자
    /^12345/, // 연속된 숫자
    /password/i, // "password" 포함
    /qwerty/i, // "qwerty" 포함
  ]

  for (const pattern of commonPatterns) {
    if (pattern.test(password)) {
      errors.push('너무 단순하거나 일반적인 비밀번호입니다.')
      break
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// ===========================
// 4. Sensitive Action Re-auth
// ===========================

const SENSITIVE_ACTIONS = [
  'change_role',
  'bulk_delete',
  'export_data',
  'security_settings',
  'delete_account',
  'add_admin',
  'remove_admin',
] as const

type SensitiveAction = typeof SENSITIVE_ACTIONS[number]

const REAUTH_VALIDITY = 5 * 60 * 1000 // 5분

interface ReauthRecord {
  user_id: string
  action: string
  verified_at: string
  expires_at: string
}

export async function requireReauth(
  userId: string,
  action: string
): Promise<{ required: boolean; reason: string }> {
  // 민감한 작업인지 확인
  if (!SENSITIVE_ACTIONS.includes(action as SensitiveAction)) {
    return { required: false, reason: 'not_sensitive' }
  }

  const now = new Date()

  // 최근 재인증 기록 확인
  const { data, error } = await supabase
    .from('reauth_records')
    .select('verified_at, expires_at')
    .eq('user_id', userId)
    .eq('action', action)
    .gt('expires_at', now.toISOString())
    .order('verified_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    return { required: true, reason: 'no_recent_verification' }
  }

  // 유효한 재인증이 있음
  return { required: false, reason: 'recently_verified' }
}

export async function markActionVerified(userId: string, action: string): Promise<void> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + REAUTH_VALIDITY)

  await supabase
    .from('reauth_records')
    .insert({
      user_id: userId,
      action,
      verified_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
}

export async function clearReauthRecords(userId: string, action?: string): Promise<void> {
  let query = supabase
    .from('reauth_records')
    .delete()
    .eq('user_id', userId)

  if (action) {
    query = query.eq('action', action)
  }

  await query
}

// ===========================
// 5. Rate Limiting Helpers
// ===========================

interface RateLimitRecord {
  key: string
  attempts: number
  window_start: string
  window_end: string
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
}

export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = new Date()
  const windowMs = windowSeconds * 1000

  // 현재 윈도우에 해당하는 기록 조회
  const { data, error } = await supabase
    .from('rate_limits')
    .select('attempts, window_start, window_end')
    .eq('key', key)
    .gt('window_end', now.toISOString())
    .single()

  // 기록이 없거나 윈도우가 만료됨
  if (error || !data) {
    const windowStart = now
    const windowEnd = new Date(now.getTime() + windowMs)

    // 새 윈도우 생성
    await supabase
      .from('rate_limits')
      .upsert({
        key,
        attempts: 1,
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
      })

    return {
      allowed: true,
      remaining: maxAttempts - 1,
      resetAt: windowEnd,
    }
  }

  // 시도 횟수 초과
  if (data.attempts >= maxAttempts) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(data.window_end),
    }
  }

  // 시도 횟수 증가
  await supabase
    .from('rate_limits')
    .update({ attempts: data.attempts + 1 })
    .eq('key', key)
    .eq('window_start', data.window_start)

  return {
    allowed: true,
    remaining: maxAttempts - data.attempts - 1,
    resetAt: new Date(data.window_end),
  }
}

export async function resetRateLimit(key: string): Promise<void> {
  await supabase
    .from('rate_limits')
    .delete()
    .eq('key', key)
}

// ===========================
// 6. Security Utilities
// ===========================

export function hashSensitiveData(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function createSecureToken(length: number = 32): string {
  const crypto = require('crypto')
  return crypto.randomBytes(length).toString('hex')
}

// IP 기반 위치 추정 (간단한 버전, 실제로는 GeoIP 서비스 사용 권장)
export function isIpSuspicious(ip: string, lastKnownIp: string): boolean {
  // 같은 IP면 안전
  if (ip === lastKnownIp) return false

  // 로컬 IP는 의심스럽지 않음
  if (ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return false
  }

  // IP가 완전히 다르면 의심스러움 (실제로는 GeoIP로 지역 비교)
  const ipParts = ip.split('.')
  const lastParts = lastKnownIp.split('.')

  // 첫 두 옥텟이 다르면 의심스러움
  return ipParts[0] !== lastParts[0] || ipParts[1] !== lastParts[1]
}

// 세션 만료 시간 계산 (활동 기반)
export function calculateSessionExpiry(
  lastActivity: Date,
  maxInactivityMs: number
): Date {
  return new Date(lastActivity.getTime() + maxInactivityMs)
}

// 보안 이벤트 로깅
export async function logSecurityEvent(
  userId: string,
  eventType: string,
  details: Record<string, any>,
  severity: 'low' | 'medium' | 'high' | 'critical'
): Promise<void> {
  await supabase
    .from('security_events')
    .insert({
      user_id: userId,
      event_type: eventType,
      details,
      severity,
      created_at: new Date().toISOString(),
    })
}
