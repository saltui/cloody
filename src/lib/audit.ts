import { supabase } from './supabase'

export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'UPLOAD'
  | 'DELETE'
  | 'COPY'
  | 'VIEW'
  | 'SESSION_TIMEOUT'
  | 'IP_MISMATCH'
  | 'RATE_LIMITED'
  | '2FA_ENABLED'
  | '2FA_VERIFIED'
  | '2FA_FAILED'

interface AuditLogEntry {
  action: AuditAction
  ip: string
  userAgent?: string
  details?: Record<string, unknown>
}

// 감사 로그 기록 (비동기, 실패해도 메인 작업에 영향 없음)
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      action: entry.action,
      ip: entry.ip,
      user_agent: entry.userAgent || null,
      details: entry.details || null,
      created_at: new Date().toISOString(),
    })
  } catch (error) {
    // 로깅 실패는 무시 (메인 작업 방해 X)
    console.error('Audit log failed:', error)
  }
}

// 최근 로그인 시도 조회 (관리용)
export async function getRecentLoginAttempts(limit = 50): Promise<unknown[]> {
  const { data } = await supabase
    .from('audit_logs')
    .select('*')
    .in('action', ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'RATE_LIMITED'])
    .order('created_at', { ascending: false })
    .limit(limit)

  return data || []
}

// 특정 IP의 활동 조회
export async function getActivityByIP(ip: string, limit = 100): Promise<unknown[]> {
  const { data } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('ip', ip)
    .order('created_at', { ascending: false })
    .limit(limit)

  return data || []
}

// 의심스러운 활동 감지 (짧은 시간 내 여러 실패)
export async function detectSuspiciousActivity(ip: string, minutes = 30): Promise<boolean> {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString()

  const { count } = await supabase
    .from('audit_logs')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .in('action', ['LOGIN_FAILED', 'RATE_LIMITED', 'IP_MISMATCH'])
    .gte('created_at', since)

  // 30분 내 5회 이상 실패면 의심스러운 활동
  return (count || 0) >= 5
}
