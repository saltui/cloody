import { supabaseAdmin } from '@/lib/supabase-admin'

export interface RateLimitResult {
  allowed: boolean
  remainingAttempts: number
  lockoutUntil?: number
}

export class RateLimiter {
  constructor(
    private maxAttempts: number = 5,
    private lockoutDuration: number = 15 * 60 * 1000
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    // Auto-cleanup: delete entries older than lockout duration
    await supabaseAdmin
      .from('rate_limits')
      .delete()
      .lt('first_attempt_at', new Date(Date.now() - this.lockoutDuration).toISOString())

    const { data: record } = await supabaseAdmin
      .from('rate_limits')
      .select('count, first_attempt_at')
      .eq('key', key)
      .single()

    if (!record) {
      return { allowed: true, remainingAttempts: this.maxAttempts }
    }

    const firstAttemptMs = new Date(record.first_attempt_at).getTime()
    const lockoutUntil = firstAttemptMs + this.lockoutDuration

    if (record.count >= this.maxAttempts && Date.now() < lockoutUntil) {
      return { allowed: false, remainingAttempts: 0, lockoutUntil }
    }

    if (Date.now() >= lockoutUntil) {
      await supabaseAdmin.from('rate_limits').delete().eq('key', key)
      return { allowed: true, remainingAttempts: this.maxAttempts }
    }

    return {
      allowed: true,
      remainingAttempts: this.maxAttempts - record.count,
    }
  }

  async record(key: string): Promise<void> {
    const { data: existing } = await supabaseAdmin
      .from('rate_limits')
      .select('count')
      .eq('key', key)
      .single()

    if (existing) {
      await supabaseAdmin
        .from('rate_limits')
        .update({ count: existing.count + 1, updated_at: new Date().toISOString() })
        .eq('key', key)
    } else {
      await supabaseAdmin
        .from('rate_limits')
        .insert({ key, count: 1, first_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    }
  }

  async clear(key: string): Promise<void> {
    await supabaseAdmin.from('rate_limits').delete().eq('key', key)
  }
}
