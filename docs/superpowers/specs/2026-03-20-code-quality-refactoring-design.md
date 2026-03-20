# Cloody 코드 품질 리팩토링 설계

## 목표

기능 변경 없이 코드 품질을 개선한다. 중복 코드 제거, 에러 핸들링 체계화, 모듈 책임 분리.

## 제약 조건

- API 엔드포인트 경로 변경 없음
- 요청/응답 데이터 구조 변경 없음 (기존 JSON shape 그대로 유지)
- 비즈니스 로직 변경 없음
- 클라이언트 호환성 100% 유지
- 기존 세션 토큰 무효화 없음 (로그인된 유저 강제 로그아웃 방지)

---

## 섹션 1: 공통 유틸리티 추출

### 1-1. `src/lib/request-utils.ts`

**`getClientIP(request: NextRequest): string`**
- 현재 21개 파일에 복붙된 IP 추출 로직을 단일 함수로 추출
- cf-connecting-ip → x-real-ip → x-forwarded-for → 127.0.0.1 순서 유지

**`requireSession(request: NextRequest): { userId: string; ip: string; userAgent: string }`**
- 세션 쿠키 추출 + 토큰 검증 + userId 반환을 하나의 함수로 통합
- 실패 시 적절한 HTTP 에러를 throw

**적용 범위 (3가지 세션 패턴 구분):**

| 패턴 | 설명 | 적용 | 대상 라우트 |
|------|------|------|------------|
| A. 쿠키 직접 검증 | `cookies.get('gallery_session')` + `verifyUserSessionToken()` | `requireSession()` 적용 | upload, auth/me, passkey/* 등 ~8개 |
| B. 미들웨어 주입 헤더 | `request.headers.get('x-user-id')` (미들웨어가 검증 완료) | `getClientIP()`만 적용, 세션 로직 그대로 유지 | trash, share, copy, move 등 ~8개 |
| C. 인증 생성 라우트 | 세션이 없는 상태에서 세션을 생성하는 엔드포인트 | `getClientIP()`만 적용 | login, register, passkey/authenticate 등 |

### 1-2. `src/lib/response-utils.ts`

**`errorResponse(code: ErrorCode, message?: string, extra?: object): NextResponse`**
- ErrorCode enum에 매핑된 HTTP status와 기본 메시지 사용
- `extra` 파라미터로 추가 필드 전달 가능 (lockoutUntil, currentUsage 등)
- 기존 `{ error: '...' }` 형태 유지

**`successResponse(data: object): NextResponse`**
- data를 그대로 `NextResponse.json(data)` 반환 (기존 응답 shape 유지)
- `{ success: true }` 강제 추가 안 함 — 기존에 success가 있는 라우트만 그대로, 없는 라우트도 그대로

---

## 섹션 2: 인증 모듈 정리

### 2-1. Rate Limiting 통합 → `src/lib/rate-limit.ts`

현재 상태:
- `auth.ts`: `Map<string, { count, resetAt }>` → 반환: `{ allowed, remainingAttempts, resetAt }`
- `user-auth.ts`: `Map<string, { count, firstAttempt }>` → 반환: `{ allowed, remainingAttempts, lockoutUntil }`

변경:
- 단일 `RateLimiter` 클래스로 통합
- 설정값 (maxAttempts, lockoutDuration) 생성자 파라미터로 받음
- `check(ip)`, `record(ip)`, `clear(ip)` 메서드
- 반환 타입: `{ allowed, remainingAttempts, lockoutUntil }` (`lockoutUntil`로 통일)
- `auth.ts`의 `resetAt` 소비처 (`/api/auth/route.ts`)에서 `lockoutUntil`로 변경 (클라이언트에 전달하는 필드명이 `resetAt`이면 그대로 매핑)
- 100개 초과 시 자동 정리 로직 유지

### 2-2. 토큰 서명 → `src/lib/token.ts`

**기존 인코딩을 그대로 보존한다** (세션 무효화 방지):
- 갤러리 토큰: base64url 인코딩 + base64url HMAC → 그대로 유지
- 유저 토큰: base64 인코딩 + hex HMAC → 그대로 유지

`token.ts`는 공통 로직만 추출:
- `signToken(payload, encoding)` / `verifyToken(token, encoding)` — encoding 파라미터로 분기
- 서명 비교는 `timingSafeEqual`로 통일 (보안 개선, 동작 변경 아님)
- 만료, 서명 검증, 파싱 에러를 구조화된 결과로 반환

**미들웨어 예외:**
- `middleware.ts`는 Edge 런타임이라 Node.js `crypto` 사용 불가
- 현재 경량 검증(payload 디코딩만, HMAC 미검증)을 유지하며 `token.ts` 사용 안 함
- 이것은 의도된 아키텍처 결정이며 별도 문서화

### 2-3. 파일 구조 변경

```
변경 전:
  src/lib/auth.ts        → 갤러리 인증 (토큰 + rate limit)
  src/lib/user-auth.ts   → 유저 인증 (패스워드 + 토큰 + rate limit + CRUD)

변경 후:
  src/lib/auth/gallery.ts   → 갤러리 인증 (갤러리 패스워드 검증 + 세션)
  src/lib/auth/user.ts      → 유저 인증 (패스워드 + 패스키 + 매직링크 + CRUD)
  src/lib/auth/index.ts     → 공통 export (re-export)
  src/lib/rate-limit.ts     → Rate limiting 클래스
  src/lib/token.ts          → 토큰 서명/검증 유틸리티
```

두 인증 시스템은 **별개 모듈로 유지**한다:
- 갤러리 인증: 공유 패스워드, userId 없는 세션 (`SessionToken`)
- 유저 인증: 개인 계정, userId 있는 세션 (`UserSessionToken`)
- 공통 로직(토큰 서명, rate limit)만 별도 모듈로 추출
- `auth/index.ts`에서 양쪽을 re-export하여 import 경로 단순화

기존 import 변경:
- `from '@/lib/auth'` → `from '@/lib/auth'` (경로 동일, index.ts가 re-export)
- `from '@/lib/user-auth'` → `from '@/lib/auth'` (index.ts에서 re-export)

---

## 섹션 3: 에러 핸들링 체계화

### 3-1. 에러 코드 체계 → `src/lib/errors.ts`

```typescript
enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',           // 401
  SESSION_EXPIRED = 'SESSION_EXPIRED',     // 401
  RATE_LIMITED = 'RATE_LIMITED',           // 429
  INVALID_INPUT = 'INVALID_INPUT',         // 400
  NOT_FOUND = 'NOT_FOUND',               // 404
  FORBIDDEN = 'FORBIDDEN',               // 403
  STORAGE_LIMIT = 'STORAGE_LIMIT',       // 403
  INTERNAL_ERROR = 'INTERNAL_ERROR',     // 500
}
```

각 코드에 HTTP status와 기본 한국어 메시지 매핑.

### 3-2. bare catch 제거

모든 `catch {}` 또는 `catch (e) {}` 블록에:
- `console.error` 추가 (디버깅 가능하게)
- 적절한 에러 응답 반환
- 동작 자체는 변경 없음 (기존에 에러 삼키던 곳은 동일하게 처리하되 로깅만 추가)

### 3-3. 에러 메시지 언어 통일

구분:
- **유저 대면 메시지** (UI에 표시) → 한국어 유지/통일
- **개발자 대면 메시지** (API 에러, 밸리데이션) → 영어 유지 (클라이언트 코드가 문자열 매칭하는 경우 변경하면 깨짐)

기존 클라이언트가 에러 메시지 문자열로 분기하는 곳은 그대로 유지.

---

## 섹션 4: API 라우트 정리

### 4-1. 적용 대상

패턴별로 다르게 적용:

**패턴 A (쿠키 직접 검증) ~8개 라우트:**
- `getClientIP()` 로컬 선언 삭제 → `request-utils.ts` import
- 세션 검증 보일러플레이트 → `requireSession()` 호출
- 에러 응답 → `errorResponse()` 헬퍼 사용

**패턴 B (x-user-id 헤더) ~8개 라우트:**
- `getClientIP()` 로컬 선언 삭제 → `request-utils.ts` import
- 세션 검증은 기존 `x-user-id` 패턴 유지 (미들웨어에서 이미 검증)
- 에러 응답 → `errorResponse()` 헬퍼 사용

**패턴 C (인증 생성) ~6개 라우트:**
- `getClientIP()` 로컬 선언 삭제 → `request-utils.ts` import
- 에러 응답 → `errorResponse()` 헬퍼 사용

### 4-2. 변경하지 않는 것

- API 엔드포인트 URL
- 요청/응답 JSON 구조 (필드 추가/삭제 없음)
- 비즈니스 로직 (인증 흐름, 파일 처리, 트랜스코딩 등)
- 클라이언트 코드
- 미들웨어의 Edge 런타임 토큰 검증

---

## 작업 순서

안전한 순서로 단계적 진행:

1. **새 유틸리티 파일 생성** — `errors.ts`, `request-utils.ts`, `response-utils.ts`, `rate-limit.ts`, `token.ts` (아직 연결하지 않음)
2. **`getClientIP()` 마이그레이션** — 전체 라우트에서 로컬 선언 삭제 → import로 교체 (기계적, 최소 리스크)
3. **`auth.ts` 내부 마이그레이션** — rate-limit.ts, token.ts 사용하도록 변경, 기존 동작 보존 확인
4. **`user-auth.ts` 내부 마이그레이션** — 동일하게 rate-limit.ts, token.ts 사용
5. **auth 디렉토리 구조 변경** — auth/gallery.ts, auth/user.ts, auth/index.ts로 분리 + import 경로 변경
6. **API 라우트 정리** — 패턴별로 requireSession(), errorResponse() 적용
7. **bare catch 제거** — 전체 파일에서 에러 로깅 추가
8. **검증** — lint 통과 확인

각 단계 완료 시 lint로 안전성 확인.

---

## 새로 생성되는 파일

| 파일 | 역할 |
|------|------|
| `src/lib/errors.ts` | ErrorCode enum + HTTP status 매핑 |
| `src/lib/request-utils.ts` | getClientIP, requireSession |
| `src/lib/response-utils.ts` | errorResponse, successResponse |
| `src/lib/rate-limit.ts` | RateLimiter 클래스 |
| `src/lib/token.ts` | 토큰 서명/검증 유틸리티 |
| `src/lib/auth/gallery.ts` | 갤러리 인증 (기존 auth.ts에서 이동) |
| `src/lib/auth/user.ts` | 유저 인증 (기존 user-auth.ts에서 이동) |
| `src/lib/auth/index.ts` | 공통 re-export |

## 삭제되는 파일

| 파일 | 이유 |
|------|------|
| `src/lib/auth.ts` | auth/gallery.ts로 이동 |
| `src/lib/user-auth.ts` | auth/user.ts로 이동 |
