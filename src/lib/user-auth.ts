import { createHmac, randomBytes } from 'crypto'
import bcrypt from 'bcrypt'
import { supabase } from './supabase'

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
const SECRET_KEY = process.env.GALLERY_PASSWORD || 'default-secret-key-change-me'

interface UserSessionToken {
  userId: string
  email: string
  displayName: string | null
  sessionId: string
  createdAt: number
  expiresAt: number
  ip: string
  lastActivity: number
}

function signToken(payload: UserSessionToken): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64')
  const signature = createHmac('sha256', SECRET_KEY).update(data).digest('hex')
  return `${data}.${signature}`
}

function verifySignature(token: string): UserSessionToken | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [data, signature] = parts
  const expectedSignature = createHmac('sha256', SECRET_KEY).update(data).digest('hex')

  if (signature !== expectedSignature) return null

  try {
    return JSON.parse(Buffer.from(data, 'base64').toString())
  } catch {
    return null
  }
}

export function createUserSessionToken(user: User, ip: string, rememberMe = false): string {
  const now = Date.now()
  const expiresIn = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000 // 30일 or 7일

  const payload: UserSessionToken = {
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    sessionId: randomBytes(16).toString('hex'),
    createdAt: now,
    expiresAt: now + expiresIn,
    ip,
    lastActivity: now,
  }

  return signToken(payload)
}

export interface TokenValidation {
  valid: boolean
  reason?: string
  userId?: string
  email?: string
  displayName?: string | null
}

export function verifyUserSessionToken(token: string, currentIp?: string): TokenValidation {
  const payload = verifySignature(token)

  if (!payload) {
    return { valid: false, reason: 'invalid_signature' }
  }

  const now = Date.now()

  // 만료 확인
  if (now > payload.expiresAt) {
    return { valid: false, reason: 'expired' }
  }

  // IP 바인딩 확인
  if (currentIp && payload.ip !== currentIp) {
    return { valid: false, reason: 'ip_mismatch' }
  }

  // 30분 비활성 타임아웃
  const inactivityTimeout = 30 * 60 * 1000
  if (now - payload.lastActivity > inactivityTimeout) {
    return { valid: false, reason: 'session_timeout' }
  }

  return {
    valid: true,
    userId: payload.userId,
    email: payload.email,
    displayName: payload.displayName,
  }
}

export function refreshUserSessionToken(token: string, currentIp: string): string | null {
  const payload = verifySignature(token)

  if (!payload) return null

  const now = Date.now()

  // 만료된 토큰은 갱신 불가
  if (now > payload.expiresAt) return null

  // IP 바인딩 확인
  if (payload.ip !== currentIp) return null

  // lastActivity 업데이트
  payload.lastActivity = now

  return signToken(payload)
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

// Rate Limiting (IP 기반)
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>()
const MAX_ATTEMPTS = 5
const LOCKOUT_DURATION = 15 * 60 * 1000 // 15분

export function checkRateLimit(ip: string): { allowed: boolean; remainingAttempts: number; lockoutUntil?: number } {
  const now = Date.now()
  const record = loginAttempts.get(ip)

  if (!record) {
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS }
  }

  // 잠금 해제 확인
  if (now - record.firstAttempt > LOCKOUT_DURATION) {
    loginAttempts.delete(ip)
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS }
  }

  if (record.count >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      remainingAttempts: 0,
      lockoutUntil: record.firstAttempt + LOCKOUT_DURATION,
    }
  }

  return { allowed: true, remainingAttempts: MAX_ATTEMPTS - record.count }
}

export function recordFailedAttempt(ip: string): void {
  const now = Date.now()
  const record = loginAttempts.get(ip)

  if (!record || now - record.firstAttempt > LOCKOUT_DURATION) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now })
  } else {
    record.count++
  }
}

export function clearAttempts(ip: string): void {
  loginAttempts.delete(ip)
}
