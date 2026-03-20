# Cloody 코드 품질 리팩토링 설계

## 목표

기능 변경 없이 코드 품질을 개선한다. 중복 코드 제거, 에러 핸들링 체계화, 모듈 책임 분리.

## 제약 조건

- API 엔드포인트 경로 변경 없음
- 요청/응답 데이터 구조 변경 없음
- 비즈니스 로직 변경 없음
- 클라이언트 호환성 100% 유지

---

## 섹션 1: 공통 유틸리티 추출

### 1-1. `src/lib/request-utils.ts`

**`getClientIP(request: NextRequest): string`**
- 현재 15개 이상 파일에 복붙된 IP 추출 로직을 단일 함수로 추출
- cf-connecting-ip → x-real-ip → x-forwarded-for → 127.0.0.1 순서 유지

**`requireSession(request: NextRequest): { userId: string; ip: string; userAgent: string }`**
- 세션 쿠키 추출 + 토큰 검증 + userId 반환을 하나의 함수로 통합
- 실패 시 적절한 HTTP 에러를 throw
- 15개 이상 API 라우트의 5~8줄 보일러플레이트를 1줄로 축소

### 1-2. `src/lib/response-utils.ts`

**`errorResponse(code: ErrorCode, message?: string): NextResponse`**
- ErrorCode enum에 매핑된 HTTP status와 기본 메시지 사용
- 선택적으로 커스텀 메시지 오버라이드

**`successResponse(data?: object): NextResponse`**
- `{ success: true, ...data }` 형태로 일관된 응답

---

## 섹션 2: 인증 모듈 통합

### 2-1. Rate Limiting 통합 → `src/lib/rate-limit.ts`

현재 상태:
- `auth.ts`: `Map<string, { count, resetAt }>`
- `user-auth.ts`: `Map<string, { count, firstAttempt }>`

변경:
- 단일 `RateLimiter` 클래스로 통합
- 설정값 (maxAttempts, lockoutDuration) 생성자 파라미터로 받음
- `check(ip)`, `record(ip)`, `clear(ip)` 메서드
- 100개 초과 시 자동 정리 로직 유지

### 2-2. 토큰 서명 통일 → `src/lib/token.ts`

현재 상태:
- `auth.ts`: base64url 인코딩 + HMAC-SHA256
- `user-auth.ts`: base64 인코딩 + HMAC-SHA256

변경:
- base64url로 통일
- `signToken(payload): string`, `verifyToken(token): payload | null` 공통 함수
- 토큰 만료, 서명 검증, 파싱 에러를 구조화된 결과로 반환

### 2-3. 파일 구조 변경

```
변경 전:
  src/lib/auth.ts        → 갤러리 인증 (토큰 + rate limit)
  src/lib/user-auth.ts   → 유저 인증 (패스워드 + 토큰 + rate limit + CRUD)

변경 후:
  src/lib/auth.ts        → 통합 인증 (유저 + 갤러리)
  src/lib/rate-limit.ts  → Rate limiting 클래스
  src/lib/token.ts       → 토큰 생성/검증 유틸리티
```

- `user-auth.ts`의 모든 export를 `auth.ts`로 이동
- 기존 import 경로 (`user-auth`) 전부 `auth`로 변경
- `user-auth.ts` 삭제

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

- 기존 한국어 메시지 유지
- 영어로 되어 있는 에러 메시지를 한국어로 통일
- ErrorCode의 기본 메시지는 한국어

---

## 섹션 4: API 라우트 정리

### 4-1. 적용 대상

모든 API 라우트 (~35개)에 대해:
- `getClientIP()` 로컬 선언 삭제 → `request-utils.ts` import
- 세션 검증 보일러플레이트 → `requireSession()` 호출
- 에러 응답 → `errorResponse()` 헬퍼 사용
- 성공 응답 → `successResponse()` 헬퍼 사용

### 4-2. 변경하지 않는 것

- API 엔드포인트 URL
- 요청/응답 JSON 구조
- 비즈니스 로직 (인증 흐름, 파일 처리, 트랜스코딩 등)
- 클라이언트 코드

---

## 작업 순서

모듈별 순차 진행 (방식 1):

1. **공통 유틸리티 생성** — errors.ts, request-utils.ts, response-utils.ts
2. **인증 모듈 통합** — rate-limit.ts, token.ts 추출 → auth.ts 통합 → user-auth.ts 삭제
3. **API 라우트 정리** — 인증 API → 패스키 API → 파일 API → 기타 API 순서
4. **검증** — lint 통과 확인

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

## 삭제되는 파일

| 파일 | 이유 |
|------|------|
| `src/lib/user-auth.ts` | auth.ts로 통합 |
