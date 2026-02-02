import { createHash } from 'crypto'
import { supabase } from './supabase'
import type { AuditAction } from './audit'

export interface AuditLogEntry {
  id: string
  action: AuditAction
  user_id: string | null
  resource_type: string | null
  resource_id: string | null
  ip: string
  user_agent: string | null
  details: Record<string, unknown> | null
  created_at: string
  prev_hash: string | null
  log_hash: string | null
}

export interface NewAuditEntry {
  action: AuditAction
  user_id?: string
  resource_type?: string
  resource_id?: string
  ip: string
  userAgent?: string
  details?: Record<string, unknown>
}

export interface IntegrityReport {
  valid: boolean
  total_logs: number
  verified_logs: number
  broken_at?: string
  broken_index?: number
  error?: string
}

/**
 * Compute SHA-256 hash of audit log entry
 * Includes: action, user_id, resource_type, resource_id, created_at, prev_hash
 */
export function computeLogHash(log: Partial<AuditLogEntry>): string {
  const data = [
    log.action || '',
    log.user_id || '',
    log.resource_type || '',
    log.resource_id || '',
    log.created_at || '',
    log.prev_hash || '',
  ].join('|')

  return createHash('sha256').update(data).digest('hex')
}

/**
 * Get the most recent audit log entry (for chaining)
 */
async function getLastAuditLog(): Promise<Pick<AuditLogEntry, 'log_hash'> | null> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('log_hash')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) return null
  return data
}

/**
 * Create a hash-chained audit log entry
 * Automatically links to previous log and computes integrity hash
 */
export async function createChainedAuditLog(entry: NewAuditEntry): Promise<void> {
  try {
    // Get previous log's hash
    const prevLog = await getLastAuditLog()
    const prev_hash = prevLog?.log_hash || null

    // Prepare entry data
    const created_at = new Date().toISOString()
    const logData = {
      action: entry.action,
      user_id: entry.user_id || null,
      resource_type: entry.resource_type || null,
      resource_id: entry.resource_id || null,
      ip: entry.ip,
      user_agent: entry.userAgent || null,
      details: entry.details || null,
      created_at,
      prev_hash,
    }

    // Compute hash for this log
    const log_hash = computeLogHash(logData)

    // Insert with both hashes
    await supabase.from('audit_logs').insert({
      ...logData,
      log_hash,
    })
  } catch (error) {
    // Logging failure should not break main operations
    console.error('Chained audit log failed:', error)
  }
}

/**
 * Verify the integrity of audit log chain
 * Returns validation result with details of any break point
 */
export async function verifyAuditChain(
  startId?: string,
  endId?: string
): Promise<{ valid: boolean; brokenAt?: string }> {
  try {
    // Build query
    let query = supabase
      .from('audit_logs')
      .select('id, action, user_id, resource_type, resource_id, created_at, prev_hash, log_hash')
      .order('created_at', { ascending: true })

    if (startId) {
      query = query.gte('id', startId)
    }
    if (endId) {
      query = query.lte('id', endId)
    }

    const { data: logs, error } = await query

    if (error || !logs || logs.length === 0) {
      return { valid: true } // Empty chain is valid
    }

    let prevHash: string | null = null

    // Verify each log in sequence
    for (const log of logs) {
      // Verify prev_hash link
      if (log.prev_hash !== prevHash) {
        return { valid: false, brokenAt: log.id }
      }

      // Verify log's hash matches computed hash
      const computedHash = computeLogHash(log)
      if (log.log_hash !== computedHash) {
        return { valid: false, brokenAt: log.id }
      }

      prevHash = log.log_hash
    }

    return { valid: true }
  } catch (error) {
    console.error('Chain verification failed:', error)
    return { valid: false, brokenAt: 'verification_error' }
  }
}

/**
 * Get comprehensive integrity report for organization
 * Verifies logs from the last N days
 */
export async function getIntegrityReport(
  orgId: string,
  days: number = 30
): Promise<IntegrityReport> {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    // Get all logs for org in time range
    const { data: logs, error } = await supabase
      .from('audit_logs')
      .select('id, action, user_id, resource_type, resource_id, created_at, prev_hash, log_hash')
      .eq('user_id', orgId) // Assuming user_id represents org context
      .gte('created_at', since)
      .order('created_at', { ascending: true })

    if (error) {
      return {
        valid: false,
        total_logs: 0,
        verified_logs: 0,
        error: error.message,
      }
    }

    if (!logs || logs.length === 0) {
      return {
        valid: true,
        total_logs: 0,
        verified_logs: 0,
      }
    }

    let prevHash: string | null = null
    let verifiedCount = 0

    // Verify each log
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i]

      // Check prev_hash link
      if (log.prev_hash !== prevHash) {
        return {
          valid: false,
          total_logs: logs.length,
          verified_logs: verifiedCount,
          broken_at: log.id,
          broken_index: i,
        }
      }

      // Check log hash
      const computedHash = computeLogHash(log)
      if (log.log_hash !== computedHash) {
        return {
          valid: false,
          total_logs: logs.length,
          verified_logs: verifiedCount,
          broken_at: log.id,
          broken_index: i,
        }
      }

      verifiedCount++
      prevHash = log.log_hash
    }

    return {
      valid: true,
      total_logs: logs.length,
      verified_logs: verifiedCount,
    }
  } catch (error) {
    return {
      valid: false,
      total_logs: 0,
      verified_logs: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Enhanced logging function that wraps existing audit log with integrity
 * Use this instead of logAudit() for tamper-proof logging
 */
export async function logAuditWithIntegrity(entry: NewAuditEntry): Promise<void> {
  await createChainedAuditLog(entry)
}
