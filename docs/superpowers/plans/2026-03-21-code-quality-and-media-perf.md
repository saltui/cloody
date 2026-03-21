# Code Quality Refactoring + Media Loading Performance Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate code duplication, standardize error handling across ~35 API routes, and dramatically improve media loading speed for all file types (especially HEIC, MOV).

**Architecture:** Phase 1 extracts shared utilities and restructures auth modules without changing behavior. Phase 2 adds HEIC conversion caching and optimizes the image proxy to serve cached conversions directly.

**Tech Stack:** Next.js 16, TypeScript, Supabase, Cloudflare R2, heic-convert, sharp

**Spec:** `docs/superpowers/specs/2026-03-20-code-quality-refactoring-design.md`

---

## Phase 1: Code Quality Refactoring

### Task 1: Create utility files (not wired yet)

**Files:**
- Create: `src/lib/errors.ts`
- Create: `src/lib/request-utils.ts`
- Create: `src/lib/response-utils.ts`
- Create: `src/lib/rate-limit.ts`
- Create: `src/lib/token.ts`

- [ ] **Step 1: Create `src/lib/errors.ts`**

```typescript
export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  INVALID_INPUT = 'INVALID_INPUT',
  NOT_FOUND = 'NOT_FOUND',
  FORBIDDEN = 'FORBIDDEN',
  STORAGE_LIMIT = 'STORAGE_LIMIT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export const ERROR_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.SESSION_EXPIRED]: 401,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INVALID_INPUT]: 400,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.STORAGE_LIMIT]: 403,
  [ErrorCode.INTERNAL_ERROR]: 500,
}

export const ERROR_MESSAGE: Record<ErrorCode, string> = {
  [ErrorCode.UNAUTHORIZED]: '인증이 필요합니다',
  [ErrorCode.SESSION_EXPIRED]: '세션이 만료되었습니다',
  [ErrorCode.RATE_LIMITED]: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요',
  [ErrorCode.INVALID_INPUT]: '잘못된 입력입니다',
  [ErrorCode.NOT_FOUND]: '찾을 수 없습니다',
  [ErrorCode.FORBIDDEN]: '권한이 없습니다',
  [ErrorCode.STORAGE_LIMIT]: '저장 공간이 부족합니다',
  [ErrorCode.INTERNAL_ERROR]: '서버 오류가 발생했습니다',
}
```

- [ ] **Step 2: Create `src/lib/response-utils.ts`**

```typescript
import { NextResponse } from 'next/server'
import { ErrorCode, ERROR_STATUS, ERROR_MESSAGE } from './errors'

export function errorResponse(
  code: ErrorCode,
  message?: string,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    { error: message || ERROR_MESSAGE[code], ...extra },
    { status: ERROR_STATUS[code] }
  )
}

export function successResponse(data?: Record<string, unknown>): NextResponse {
  return NextResponse.json(data ?? { success: true })
}
```

- [ ] **Step 3: Create `src/lib/request-utils.ts`**

Extract `getClientIP` from existing code. Also create `requireSession` that wraps the cookie-based session validation pattern (Pattern A only).

Reference: Current `getClientIP` implementation in `src/app/api/auth/route.ts`
Reference: Current session validation in `src/app/api/upload/route.ts`

```typescript
import { NextRequest } from 'next/server'
import { verifyUserSessionToken } from './user-auth'
import { ErrorCode } from './errors'
import { errorResponse } from './response-utils'

export function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

export class SessionError extends Error {
  constructor(public code: ErrorCode, message?: string) {
    super(message)
  }
}

export function requireSession(request: NextRequest): {
  userId: string
  ip: string
  userAgent: string
} {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || ''
  const sessionCookie = request.cookies.get('gallery_session')

  if (!sessionCookie) {
    throw new SessionError(ErrorCode.UNAUTHORIZED)
  }

  const validation = verifyUserSessionToken(sessionCookie.value, ip)
  if (!validation.valid || !validation.userId) {
    throw new SessionError(ErrorCode.SESSION_EXPIRED, validation.reason)
  }

  return { userId: validation.userId, ip, userAgent }
}
```

Note: Import path for `verifyUserSessionToken` will change in Task 5 when auth is restructured. Use current import for now.

- [ ] **Step 4: Create `src/lib/rate-limit.ts`**

Unify the two rate limiting implementations. Use `lockoutUntil` as the canonical return field.

Reference: `src/lib/auth.ts` rate limiting (Map-based, resetAt)
Reference: `src/lib/user-auth.ts` rate limiting (Map-based, firstAttempt)

```typescript
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
```

- [ ] **Step 5: Create `src/lib/token.ts`**

Extract token sign/verify logic. Preserve both encoding formats to avoid session invalidation.

Reference: `src/lib/auth.ts` token functions (base64url + base64url HMAC)
Reference: `src/lib/user-auth.ts` token functions (base64 + hex HMAC)

```typescript
import { createHmac, timingSafeEqual } from 'crypto'

type TokenEncoding = 'base64url' | 'base64-hex'

const SECRET = process.env.SESSION_SECRET || process.env.GALLERY_PASSWORD || 'default-secret'

export interface TokenResult {
  valid: boolean
  payload?: Record<string, unknown>
  reason?: string
}

export function signToken(payload: Record<string, unknown>, encoding: TokenEncoding = 'base64-hex'): string {
  if (encoding === 'base64url') {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = createHmac('sha256', SECRET).update(data).digest('base64url')
    return `${data}.${signature}`
  }

  // base64-hex (user-auth style)
  const data = Buffer.from(JSON.stringify(payload)).toString('base64')
  const signature = createHmac('sha256', SECRET).update(data).digest('hex')
  return `${data}.${signature}`
}

export function verifyToken(token: string, encoding: TokenEncoding = 'base64-hex'): TokenResult {
  try {
    const parts = token.split('.')
    if (parts.length !== 2) return { valid: false, reason: 'invalid_format' }
    const [data, signature] = parts

    if (encoding === 'base64url') {
      const expected = createHmac('sha256', SECRET).update(data).digest('base64url')
      const sigBuf = Buffer.from(signature, 'base64url')
      const expBuf = Buffer.from(expected, 'base64url')
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return { valid: false, reason: 'invalid_signature' }
      }
      const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
      return { valid: true, payload }
    }

    // base64-hex
    const expected = createHmac('sha256', SECRET).update(data).digest('hex')
    const sigBuf = Buffer.from(signature, 'hex')
    const expBuf = Buffer.from(expected, 'hex')
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, reason: 'invalid_signature' }
    }
    const payload = JSON.parse(Buffer.from(data, 'base64').toString())
    return { valid: true, payload }
  } catch {
    return { valid: false, reason: 'parse_error' }
  }
}
```

- [ ] **Step 6: Run lint**

Run: `cd /Users/jaden/cloody && npm run lint`
Expected: No errors in new files

- [ ] **Step 7: Commit**

```bash
git add src/lib/errors.ts src/lib/response-utils.ts src/lib/request-utils.ts src/lib/rate-limit.ts src/lib/token.ts
git commit -m "refactor: add shared utility modules (errors, request, response, rate-limit, token)"
```

---

### Task 2: Migrate getClientIP across all routes

**Files:**
- Modify: All ~21 API route files that define local `getClientIP`

- [ ] **Step 1: Find all files with local getClientIP**

Run: `grep -rn "function getClientIP" src/`

- [ ] **Step 2: Replace local definitions with import**

For each file found:
- Remove the local `function getClientIP(request: ...)` definition
- Add `import { getClientIP } from '@/lib/request-utils'` at top

- [ ] **Step 3: Run lint**

Run: `cd /Users/jaden/cloody && npm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: extract getClientIP to shared request-utils"
```

---

### Task 3: Wire rate-limit.ts into auth modules

**Files:**
- Modify: `src/lib/auth.ts` — replace inline rate limiting with RateLimiter import
- Modify: `src/lib/user-auth.ts` — replace inline rate limiting with RateLimiter import

- [ ] **Step 1: Update auth.ts to use RateLimiter**

Replace the inline `Map`, `checkRateLimit`, `recordFailedAttempt`, `clearAttempts` with:
```typescript
import { RateLimiter } from './rate-limit'
const rateLimiter = new RateLimiter(5, 15 * 60 * 1000)

export function checkRateLimit(ip: string) { return rateLimiter.check(ip) }
export function recordFailedAttempt(ip: string) { rateLimiter.record(ip) }
export function clearAttempts(ip: string) { rateLimiter.clear(ip) }
```

Keep the same export names so callers don't need changes yet.

- [ ] **Step 2: Update user-auth.ts to use RateLimiter**

Same pattern. Replace inline Map + functions with RateLimiter instance.

Adjust return shape: existing code returns `{ allowed, remainingAttempts, lockoutUntil }` — RateLimiter already matches this.

- [ ] **Step 3: Update /api/auth/route.ts if it uses `resetAt`**

If the gallery auth route uses `resetAt` from rate limit result, map it:
```typescript
const result = checkRateLimit(ip)
// If response previously used resetAt, map: resetAt = lockoutUntil
```

- [ ] **Step 4: Run lint**

Run: `cd /Users/jaden/cloody && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/user-auth.ts src/app/api/auth/route.ts
git commit -m "refactor: unify rate limiting into shared RateLimiter class"
```

---

### Task 4: Wire token.ts into auth modules

**Files:**
- Modify: `src/lib/auth.ts` — use token.ts for sign/verify (base64url encoding)
- Modify: `src/lib/user-auth.ts` — use token.ts for sign/verify (base64-hex encoding)

- [ ] **Step 1: Update auth.ts token functions**

Replace inline HMAC logic with `signToken(payload, 'base64url')` and `verifyToken(token, 'base64url')`.
Keep the same export function signatures (`createSessionToken`, `verifySessionToken`, etc.).

- [ ] **Step 2: Update user-auth.ts token functions**

Replace inline HMAC logic with `signToken(payload, 'base64-hex')` and `verifyToken(token, 'base64-hex')`.
Keep export signatures unchanged (`createUserSessionToken`, `verifyUserSessionToken`, etc.).

- [ ] **Step 3: Verify timingSafeEqual is now used everywhere**

The token.ts module uses `timingSafeEqual`. Confirm that user-auth.ts no longer has plain `===` for signature comparison.

- [ ] **Step 4: Run lint**

Run: `cd /Users/jaden/cloody && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/user-auth.ts src/lib/token.ts
git commit -m "refactor: unify token signing/verification with timingSafeEqual"
```

---

### Task 5: Restructure auth directory

**Files:**
- Create: `src/lib/auth/gallery.ts` (move from `src/lib/auth.ts`)
- Create: `src/lib/auth/user.ts` (move from `src/lib/user-auth.ts`)
- Create: `src/lib/auth/index.ts` (re-exports)
- Delete: `src/lib/auth.ts`
- Delete: `src/lib/user-auth.ts`
- Modify: All files importing from `@/lib/auth` or `@/lib/user-auth`
- Modify: `src/lib/request-utils.ts` (update import path)

- [ ] **Step 1: Create auth directory and move files**

```bash
mkdir -p src/lib/auth
mv src/lib/auth.ts src/lib/auth/gallery.ts
mv src/lib/user-auth.ts src/lib/auth/user.ts
```

- [ ] **Step 2: Create `src/lib/auth/index.ts`**

Re-export everything from both modules:
```typescript
export * from './gallery'
export * from './user'
```

Handle any name conflicts (e.g., both export `checkRateLimit`) by using named re-exports or renaming.

- [ ] **Step 3: Update all import paths**

Find all files importing from `@/lib/user-auth` and change to `@/lib/auth`.
Files importing from `@/lib/auth` should continue to work (index.ts handles it).

Run: `grep -rn "from.*user-auth" src/` to find all.

- [ ] **Step 4: Update request-utils.ts import**

Change `import { verifyUserSessionToken } from './user-auth'` to `import { verifyUserSessionToken } from './auth'`

- [ ] **Step 5: Run lint**

Run: `cd /Users/jaden/cloody && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: restructure auth into auth/gallery.ts + auth/user.ts"
```

---

### Task 6: Clean up API routes (Pattern A — requireSession)

**Files:**
- Modify: Pattern A routes (~8): upload, auth/me, passkey/*, etc.

- [ ] **Step 1: Identify Pattern A routes**

These are routes that directly read `cookies.get('gallery_session')` and call `verifyUserSessionToken`.

Run: `grep -rn "gallery_session" src/app/api/` to find them.

- [ ] **Step 2: Replace boilerplate with requireSession**

For each Pattern A route:
```typescript
// Before (5-8 lines):
const ip = getClientIP(request)
const sessionCookie = request.cookies.get('gallery_session')
if (!sessionCookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
const validation = verifyUserSessionToken(sessionCookie.value, ip)
if (!validation.valid || !validation.userId) return NextResponse.json(...)

// After (4 lines):
try {
  const { userId, ip, userAgent } = requireSession(request)
  // ... rest of handler
} catch (e) {
  if (e instanceof SessionError) return errorResponse(e.code, e.message)
  return errorResponse(ErrorCode.INTERNAL_ERROR)
}
```

- [ ] **Step 3: Apply errorResponse where appropriate**

Replace `NextResponse.json({ error: '...' }, { status: N })` with `errorResponse(ErrorCode.X, '...')`.
Preserve any extra fields using the `extra` parameter.

- [ ] **Step 4: Run lint**

Run: `cd /Users/jaden/cloody && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: apply requireSession and errorResponse to Pattern A routes"
```

---

### Task 7: Clean up API routes (Pattern B + C)

**Files:**
- Modify: Pattern B routes (~8): trash, share, copy, move, etc.
- Modify: Pattern C routes (~6): login, register, passkey/authenticate, etc.

- [ ] **Step 1: Pattern B — apply errorResponse only**

For routes using `x-user-id` header:
- Keep session validation via header (middleware handles it)
- Replace `NextResponse.json({ error: ... }, { status: N })` with `errorResponse()`
- Replace success responses with `successResponse()` where shape matches

- [ ] **Step 2: Pattern C — apply errorResponse only**

For auth creation routes:
- Keep existing auth logic (these create sessions, not validate)
- Replace error responses with `errorResponse()`

- [ ] **Step 3: Run lint**

Run: `cd /Users/jaden/cloody && npm run lint`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: apply errorResponse to Pattern B and C routes"
```

---

### Task 8: Remove bare catch blocks

**Files:**
- Modify: All files with empty or logging-less catch blocks

- [ ] **Step 1: Find bare catches**

Run: `grep -rn "catch\s*{" src/` and `grep -rn "catch\s*(.*)\s*{" src/` to find catch blocks.
Check each for missing `console.error`.

- [ ] **Step 2: Add console.error to each**

For each bare catch:
```typescript
// Before:
catch {}
// or:
catch (e) {}

// After:
catch (error) {
  console.error('[module-name] operation failed:', error)
  // keep existing behavior (return same response or swallow as before)
}
```

- [ ] **Step 3: Run lint**

Run: `cd /Users/jaden/cloody && npm run lint`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: add error logging to all bare catch blocks"
```

---

## Phase 2: Media Loading Performance

### Task 9: HEIC conversion caching

**Files:**
- Modify: `src/app/api/image/[...path]/route.ts`
- Modify: `src/lib/r2.ts` (add headObject utility if needed)

Currently: Every HEIC request → download from R2 → convert with heic-convert → serve JPEG.
After: First request converts and stores JPEG back to R2. Subsequent requests serve the cached JPEG directly.

- [ ] **Step 1: Add cached HEIC check in image API**

In `src/app/api/image/[...path]/route.ts`, before converting HEIC:

```typescript
// Check if converted version exists
const cachedKey = `converted/${originalKey}.jpg`
try {
  const cached = await r2Client.send(new HeadObjectCommand({
    Bucket: BUCKET_NAME,
    Key: cachedKey,
  }))
  if (cached) {
    // Serve the cached JPEG directly
    const cachedObj = await r2Client.send(new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: cachedKey,
    }))
    return new Response(cachedObj.Body?.transformToWebStream(), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  }
} catch {
  // Cache miss — proceed with conversion
}
```

- [ ] **Step 2: Store converted JPEG after conversion**

After converting HEIC to JPEG, upload the result back to R2:

```typescript
const jpegBuffer = await convert({ buffer, format: 'JPEG', quality: 0.9 })
// Upload cached version (fire-and-forget, don't block response)
uploadToR2(cachedKey, Buffer.from(jpegBuffer), 'image/jpeg').catch(err =>
  console.error('[heic-cache] Failed to cache conversion:', err)
)
// Serve the converted JPEG
return new Response(jpegBuffer, {
  headers: {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'public, max-age=31536000, immutable',
  },
})
```

- [ ] **Step 3: Run lint**

Run: `cd /Users/jaden/cloody && npm run lint`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/image/[...path]/route.ts
git commit -m "perf: cache HEIC-to-JPEG conversions in R2"
```

---

### Task 10: Thumbnail generation on upload

**Files:**
- Modify: `src/app/api/upload/route.ts`
- Modify: `src/app/api/upload/presign/route.ts` (if thumbnail generation needed post-upload)

Currently: Thumbnails are generated on-demand or not at all for many file types.
After: Generate thumbnails immediately on upload for images (including HEIC), store in R2.

- [ ] **Step 1: Add thumbnail generation after upload**

In `src/app/api/upload/route.ts`, after successful R2 upload:

```typescript
// For image files, generate thumbnail
if (isImageFile(contentType, fileName)) {
  try {
    let imageBuffer = buffer
    // If HEIC, convert first
    if (isHeicFile(fileName, contentType)) {
      const converted = await convert({ buffer, format: 'JPEG', quality: 0.8 })
      imageBuffer = Buffer.from(converted)
    }
    // Generate thumbnail with sharp
    const thumbnail = await sharp(imageBuffer)
      .resize(400, 400, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer()

    const thumbKey = `thumbnails/${userId}/${Date.now()}_thumb.jpg`
    await uploadToR2(thumbKey, thumbnail, 'image/jpeg')
    thumbnailUrl = `${R2_PUBLIC_URL}/${thumbKey}`
  } catch (err) {
    console.error('[upload] Thumbnail generation failed:', err)
    // Non-blocking: upload succeeds even if thumbnail fails
  }
}
```

- [ ] **Step 2: Store thumbnail URL in database record**

Ensure the `thumbnail_url` field is populated in the DB insert:
```typescript
const { data, error } = await supabase.from('photos').insert({
  ...photoData,
  thumbnail_url: thumbnailUrl || null,
})
```

- [ ] **Step 3: Run lint**

Run: `cd /Users/jaden/cloody && npm run lint`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/upload/route.ts
git commit -m "perf: generate thumbnails on upload for all image types including HEIC"
```

---

### Task 11: Optimize image proxy response headers

**Files:**
- Modify: `src/app/api/image/[...path]/route.ts`

- [ ] **Step 1: Add ETag support**

Use the R2 object's ETag for conditional requests:

```typescript
const etag = r2Object.ETag
if (request.headers.get('if-none-match') === etag) {
  return new Response(null, { status: 304 })
}

// Include ETag in response
headers.set('ETag', etag)
```

- [ ] **Step 2: Ensure consistent Cache-Control headers**

All image responses (including non-HEIC) should have long-lived cache headers since URLs are content-addressed:

```typescript
headers.set('Cache-Control', 'public, max-age=31536000, immutable')
```

- [ ] **Step 3: Run lint**

Run: `cd /Users/jaden/cloody && npm run lint`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/image/[...path]/route.ts
git commit -m "perf: add ETag support and consistent cache headers to image proxy"
```

---

### Task 12: Final verification

- [ ] **Step 1: Full lint check**

Run: `cd /Users/jaden/cloody && npm run lint`
Expected: PASS with no errors

- [ ] **Step 2: Verify no response shape changes**

Spot-check key API routes to confirm JSON output structure is unchanged:
- `/api/auth/login` — still returns `{ success, user }` or `{ error, needsTwoFactor }`
- `/api/upload` — still returns `{ url }` or `{ error }`
- `/api/trash` — still returns `{ photos, folders }` or `{ error }`

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final cleanup and verification"
```
