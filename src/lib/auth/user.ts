import { randomBytes } from 'crypto'
import bcrypt from 'bcrypt'
import { supabaseAdmin as supabase } from '../supabase-admin'
import { RateLimiter } from '../rate-limit'
import { signUserToken, verifyUserToken } from '../token'

// 비밀번호 해싱
const SALT_ROUNDS = 12

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// 사용자 타입
export interface User {
  id: string
  email: string
  email_verified: boolean
  display_name: string | null
  avatar_url: string | null
  wallet_address: string | null
  totp_enabled: boolean
  is_admin: boolean
  created_at: string
}

export interface UserWithSecret extends User {
  password_hash: string | null
  totp_secret: string | null
  magic_link_token: string | null
  magic_link_expires_at: string | null
  email_verification_token: string | null
  email_verification_expires_at: string | null
}

// 사용자 조회
export async function findUserByEmail(email: string): Promise<UserWithSecret | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase())
    .single()

  if (error || !data) return null
  return data as UserWithSecret
}

export async function findUserById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, email_verified, display_name, avatar_url, wallet_address, totp_enabled, is_admin, created_at')
    .eq('id', id)
    .single()

  if (error || !data) return null
  return data as User
}

// 사용자 생성
export async function createUser(
  email: string,
  password?: string,
  displayName?: string
): Promise<{ user: User | null; error: string | null }> {
  const normalizedEmail = email.toLowerCase()

  // 이메일 중복 확인
  const existing = await findUserByEmail(normalizedEmail)
  if (existing) {
    return { user: null, error: '이미 사용 중인 이메일입니다.' }
  }

  // 비밀번호 해시 (있는 경우)
  const passwordHash = password ? await hashPassword(password) : null

  // 이메일 인증 토큰 생성
  const verificationToken = randomBytes(32).toString('hex')
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24시간

  const { data, error } = await supabase
    .from('users')
    .insert({
      email: normalizedEmail,
      password_hash: passwordHash,
      display_name: displayName || null,
      email_verification_token: verificationToken,
      email_verification_expires_at: verificationExpires.toISOString(),
      is_admin: false,
    })
    .select('id, email, email_verified, display_name, avatar_url, totp_enabled, is_admin, created_at')
    .single()

  if (error) {
    console.error('User creation error:', error)
    return { user: null, error: '계정 생성 중 오류가 발생했습니다.' }
  }

  return { user: data as User, error: null }
}

// Magic Link 토큰 생성
export async function createMagicLinkToken(email: string): Promise<string | null> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15분

  const { error } = await supabase
    .from('users')
    .update({
      magic_link_token: token,
      magic_link_expires_at: expiresAt.toISOString(),
    })
    .eq('email', email.toLowerCase())

  if (error) return null
  return token
}

// Magic Link 검증
export async function verifyMagicLinkToken(token: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('magic_link_token', token)
    .single()

  if (error || !data) return null

  // 만료 확인
  if (new Date(data.magic_link_expires_at) < new Date()) {
    return null
  }

  // 토큰 사용 후 무효화 & 이메일 인증 처리
  await supabase
    .from('users')
    .update({
      magic_link_token: null,
      magic_link_expires_at: null,
      email_verified: true,
    })
    .eq('id', data.id)

  return {
    id: data.id,
    email: data.email,
    email_verified: true,
    display_name: data.display_name,
    avatar_url: data.avatar_url,
    wallet_address: data.wallet_address || null,
    totp_enabled: data.totp_enabled,
    is_admin: data.is_admin,
    created_at: data.created_at,
  }
}

// 이메일 인증 토큰 검증
export async function verifyEmailToken(token: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('users')
    .select('id, email_verification_expires_at')
    .eq('email_verification_token', token)
    .single()

  if (error || !data) return false

  // 만료 확인
  if (new Date(data.email_verification_expires_at) < new Date()) {
    return false
  }

  // 이메일 인증 완료
  const { error: updateError } = await supabase
    .from('users')
    .update({
      email_verified: true,
      email_verification_token: null,
      email_verification_expires_at: null,
    })
    .eq('id', data.id)

  return !updateError
}

// 새 이메일 인증 토큰 생성
export async function createEmailVerificationToken(userId: string): Promise<string | null> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24시간

  const { error } = await supabase
    .from('users')
    .update({
      email_verification_token: token,
      email_verification_expires_at: expiresAt.toISOString(),
    })
    .eq('id', userId)

  if (error) return null
  return token
}

// 세션 토큰 (기존 auth.ts 기반 확장)
const SESSION_INACTIVITY_TIMEOUT = 7 * 24 * 60 * 60 * 1000 // 7일
const STRICT_IP_BINDING = process.env.SESSION_STRICT_IP_BINDING === '1'

export function createUserSessionToken(user: User, ip: string, rememberMe = false): string {
  const now = Date.now()
  const expiresIn = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000 // 30일 or 7일

  return signUserToken({
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    sessionId: randomBytes(16).toString('hex'),
    createdAt: now,
    expiresAt: now + expiresIn,
    ip,
    lastActivity: now,
  })
}

export interface TokenValidation {
  valid: boolean
  reason?: string
  userId?: string
  email?: string
  displayName?: string | null
  sessionId?: string
  createdAt?: number
}

export function verifyUserSessionToken(token: string, currentIp?: string): TokenValidation {
  const payload = verifyUserToken(token)

  if (!payload) {
    return { valid: false, reason: 'invalid_signature' }
  }

  const now = Date.now()

  // 만료 확인
  if (now > payload.expiresAt) {
    return { valid: false, reason: 'expired' }
  }

  // 모바일/와이파이 전환 환경에서 잦은 로그아웃 방지를 위해 기본적으로 IP 고정 비활성화
  if (STRICT_IP_BINDING && currentIp && payload.ip !== currentIp) {
    return { valid: false, reason: 'ip_mismatch' }
  }

  // 비활성 타임아웃 (middleware와 동일 기준)
  if (now - payload.lastActivity > SESSION_INACTIVITY_TIMEOUT) {
    return { valid: false, reason: 'session_timeout' }
  }

  return {
    valid: true,
    userId: payload.userId,
    email: payload.email,
    displayName: payload.displayName,
    sessionId: payload.sessionId,
    createdAt: payload.createdAt,
  }
}

export function refreshUserSessionToken(token: string, currentIp: string): string | null {
  const payload = verifyUserToken(token)

  if (!payload) return null

  const now = Date.now()

  // 만료된 토큰은 갱신 불가
  if (now > payload.expiresAt) return null

  // strict 모드에서만 IP 바인딩 확인
  if (STRICT_IP_BINDING && payload.ip !== currentIp) return null

  // lastActivity 업데이트
  return signUserToken({ ...payload, lastActivity: now })
}

// 사용자 프로필 업데이트
export async function updateUserProfile(
  userId: string,
  updates: { display_name?: string; avatar_url?: string; wallet_address?: string | null }
): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  return !error
}

// 지갑 주소 업데이트
export async function updateWalletAddress(
  userId: string,
  walletAddress: string | null
): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update({
      wallet_address: walletAddress,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  return !error
}

// 지갑 주소로 사용자 찾기
export async function findUserByWalletAddress(walletAddress: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, email_verified, display_name, avatar_url, wallet_address, totp_enabled, is_admin, created_at')
    .eq('wallet_address', walletAddress.toLowerCase())
    .single()

  if (error || !data) return null
  return data as User
}

// 비밀번호 변경
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  // 현재 비밀번호 확인
  const { data: user } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', userId)
    .single()

  if (!user?.password_hash) {
    return { success: false, error: '비밀번호가 설정되어 있지 않습니다.' }
  }

  const isValid = await verifyPassword(currentPassword, user.password_hash)
  if (!isValid) {
    return { success: false, error: '현재 비밀번호가 올바르지 않습니다.' }
  }

  // 새 비밀번호 해시
  const newHash = await hashPassword(newPassword)

  const { error } = await supabase
    .from('users')
    .update({
      password_hash: newHash,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) {
    return { success: false, error: '비밀번호 변경 중 오류가 발생했습니다.' }
  }

  return { success: true }
}

// 마지막 로그인 시간 업데이트
export async function updateLastLogin(userId: string): Promise<void> {
  await supabase
    .from('users')
    .update({
      last_login_at: new Date().toISOString(),
    })
    .eq('id', userId)
}

// 세션 철회 (Session Revocation)
export async function revokeSession(sessionId: string, userId: string, reason?: string): Promise<boolean> {
  const { error } = await supabase
    .from('session_revocations')
    .upsert({
      session_id: sessionId,
      user_id: userId,
      revoked_at: new Date().toISOString(),
      reason: reason || null,
    })

  if (error) {
    console.error('[session] revokeSession error:', error)
    return false
  }
  return true
}

export async function revokeAllUserSessions(userId: string, reason?: string): Promise<boolean> {
  const { error } = await supabase
    .from('session_revocations')
    .upsert({
      session_id: `all:${userId}`,
      user_id: userId,
      revoked_at: new Date().toISOString(),
      reason: reason || 'revoke_all',
    })

  if (error) {
    console.error('[session] revokeAllUserSessions error:', error)
    return false
  }
  return true
}

export async function checkSessionRevocation(
  sessionId: string,
  userId: string,
  tokenCreatedAt: number,
): Promise<boolean> {
  // Check exact session_id match
  const { data: exact } = await supabase
    .from('session_revocations')
    .select('session_id')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (exact) return true

  // Check user-wide revocation (revoked_at must be after the token was created)
  const tokenCreatedISO = new Date(tokenCreatedAt).toISOString()
  const { data: userWide } = await supabase
    .from('session_revocations')
    .select('session_id')
    .eq('session_id', `all:${userId}`)
    .gte('revoked_at', tokenCreatedISO)
    .maybeSingle()

  return !!userWide
}

// Rate Limiting (IP 기반, Supabase-backed)
const rateLimiter = new RateLimiter(5, 15 * 60 * 1000)

export function checkRateLimit(ip: string) { return rateLimiter.check(ip) }
export function recordFailedAttempt(ip: string) { return rateLimiter.record(ip) }
export function clearAttempts(ip: string) { return rateLimiter.clear(ip) }
