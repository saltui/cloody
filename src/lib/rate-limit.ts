export interface RateLimitResult {
  allowed: boolean
  remainingAttempts: number
  lockoutUntil?: number
}

export class RateLimiter {
  private attempts = new Map<string, { count: number; firstAttempt: number }>()

  constructor(
    private maxAttempts: number = 5,
    private lockoutDuration: number = 15 * 60 * 1000,
    private cleanupThreshold: number = 100
  ) {}

  check(ip: string): RateLimitResult {
    this.cleanupIfNeeded()
    const record = this.attempts.get(ip)

    if (!record) {
      return { allowed: true, remainingAttempts: this.maxAttempts }
    }

    const lockoutUntil = record.firstAttempt + this.lockoutDuration
    if (record.count >= this.maxAttempts && Date.now() < lockoutUntil) {
      return { allowed: false, remainingAttempts: 0, lockoutUntil }
    }

    if (Date.now() >= lockoutUntil) {
      this.attempts.delete(ip)
      return { allowed: true, remainingAttempts: this.maxAttempts }
    }

    return {
      allowed: true,
      remainingAttempts: this.maxAttempts - record.count,
    }
  }

  record(ip: string): void {
    const existing = this.attempts.get(ip)
    if (existing) {
      existing.count++
    } else {
      this.attempts.set(ip, { count: 1, firstAttempt: Date.now() })
    }
  }

  clear(ip: string): void {
    this.attempts.delete(ip)
  }

  private cleanupIfNeeded(): void {
    if (this.attempts.size <= this.cleanupThreshold) return
    const now = Date.now()
    for (const [ip, record] of this.attempts) {
      if (now >= record.firstAttempt + this.lockoutDuration) {
        this.attempts.delete(ip)
      }
    }
  }
}
