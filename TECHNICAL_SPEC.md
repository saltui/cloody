# Cloody 기술 스펙 문서

> 최종 업데이트: 2026-01-26

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택](#2-기술-스택)
3. [프로젝트 구조](#3-프로젝트-구조)
4. [핵심 기능별 구현](#4-핵심-기능별-구현)
5. [데이터베이스 스키마](#5-데이터베이스-스키마)
6. [API 엔드포인트](#6-api-엔드포인트)
7. [보안](#7-보안)
8. [환경 변수](#8-환경-변수)

---

## 1. 프로젝트 개요

Cloody는 개인용 클라우드 스토리지 + 블록체인 기반 문서 승인 시스템입니다.

### 주요 기능
- **파일 관리**: 사진/동영상/문서 업로드, 폴더 관리, 휴지통
- **다중 인증**: 비밀번호, 패스키(생체인증), 매직링크, 2FA
- **Vault**: 다중 서명 문서 승인 (M-of-N 방식)
- **블록체인**: 파일 해시 앵커링, 서명 기록 온체인 저장

---

## 2. 기술 스택

### Frontend

| 기술 | 버전 | 용도 |
|-----|-----|-----|
| Next.js | 16.1.4 | React 프레임워크 (App Router) |
| React | 19.2.3 | UI 라이브러리 |
| TypeScript | 5.x | 타입 안전성 |
| Tailwind CSS | 4.x | 스타일링 |
| wagmi | 3.4.1 | 이더리움 지갑/컨트랙트 연동 |
| RainbowKit | 2.2.10 | 지갑 연결 UI |
| SimpleWebAuthn | 13.2.2 | 패스키/WebAuthn |
| hls.js | 1.6.15 | HLS 비디오 스트리밍 |

### Backend

| 기술 | 용도 |
|-----|-----|
| Next.js API Routes | 서버 API |
| Supabase | PostgreSQL 데이터베이스 |
| Cloudflare R2 | 파일 스토리지 (S3 호환) |
| Nodemailer | 이메일 발송 |
| bcrypt | 비밀번호 해싱 |

### Blockchain

| 기술 | 용도 |
|-----|-----|
| Solidity 0.8.20 | 스마트 컨트랙트 |
| Hardhat | 컨트랙트 개발/배포 |
| viem | 이더리움 SDK |
| Base Sepolia | 테스트넷 |

---

## 3. 프로젝트 구조

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API 엔드포인트 (33개)
│   │   ├── auth/          # 인증 관련
│   │   ├── passkey/       # 패스키 관련
│   │   ├── vault/         # Vault 문서 승인
│   │   ├── upload/        # 파일 업로드
│   │   ├── trash/         # 휴지통
│   │   └── ...
│   ├── drive/             # 메인 파일 브라우저
│   ├── vault/             # Vault 페이지
│   ├── settings/          # 설정 페이지
│   └── trash/             # 휴지통 페이지
│
├── components/            # React 컴포넌트
│   ├── BlockchainBadge.tsx    # 블록체인 검증 배지
│   ├── VaultAuthModal.tsx     # Vault 패스키 인증
│   ├── Sidebar.tsx            # 사이드바
│   └── Toast.tsx              # 토스트 알림
│
├── lib/                   # 유틸리티 & 비즈니스 로직
│   ├── web3/              # 블록체인 관련
│   │   ├── config.ts      # wagmi 설정
│   │   ├── hooks.ts       # 컨트랙트 훅
│   │   └── abi.ts         # 스마트 컨트랙트 ABI
│   ├── supabase.ts        # DB 클라이언트
│   ├── r2.ts              # R2 스토리지
│   ├── passkey.ts         # WebAuthn 로직
│   ├── vault.ts           # Vault 비즈니스 로직
│   ├── hash.ts            # SHA-256 해싱
│   └── audit.ts           # 감사 로그
│
└── contracts/             # 스마트 컨트랙트
    └── DocumentRegistry.sol
```

---

## 4. 핵심 기능별 구현

### 4.1 인증 시스템

#### 지원 방식

| 방식 | 설명 | 관련 파일 |
|-----|-----|---------|
| **비밀번호** | 이메일 + 비밀번호 + 선택적 2FA | `/api/auth/login` |
| **매직링크** | 이메일로 일회용 로그인 링크 발송 (15분 유효) | `/api/auth/magic-link` |
| **패스키** | Face ID, Touch ID 등 생체인증 | `/api/passkey/authenticate` |
| **2FA** | TOTP 앱 (Google Authenticator 등) | `/api/2fa/setup` |

#### 세션 관리
```
- JWT 토큰 (HMAC-SHA256 서명)
- IP 바인딩 (다른 IP에서 접속 시 무효화)
- 7일 비활성 시 자동 로그아웃
- HttpOnly 쿠키로 저장
```

#### 흐름도
```
사용자 → 로그인 방식 선택
           ↓
    ┌──────┼──────┐
    ↓      ↓      ↓
  비밀번호  매직링크  패스키
    ↓      ↓      ↓
    └──────┼──────┘
           ↓
     Rate Limit 체크 (5회/15분)
           ↓
     이메일 화이트리스트 체크
           ↓
     세션 토큰 발급 (IP 바인딩)
           ↓
     쿠키 저장 → API 접근 허용
```

---

### 4.2 파일 스토리지

#### 저장소 구성

| 저장소 | 저장 내용 |
|-------|---------|
| **Cloudflare R2** | 실제 파일 (이미지, 동영상, 문서) |
| **Supabase** | 파일 메타데이터 (이름, 크기, URL, 생성일 등) |

#### 업로드 프로세스
```
1. 프론트엔드에서 파일 선택
2. Magic Bytes 검증 (파일 타입 확인)
3. 용량 체크 (사용자당 1GB 제한)
4. R2에 업로드
5. DB에 메타데이터 저장
6. 감사 로그 기록
```

#### 지원 파일 형식
- **이미지**: JPEG, PNG, GIF, WebP, HEIC, BMP
- **동영상**: MP4, MOV, WebM, MKV
- **문서**: PDF, Office (docx, xlsx, pptx), HWP

---

### 4.3 Vault (다중 서명 문서 승인)

#### 개념
```
"이 문서에 대해 지정된 N명 중 M명이 승인하면 최종 승인"

예: 3명 중 2명 승인 필요 (2-of-3)
```

#### 데이터 저장 위치

| 데이터 | 저장 위치 |
|-------|---------|
| 실제 파일 | Cloudflare R2 |
| 문서 메타데이터 (제목, 설명, 승인자 목록) | Supabase |
| 파일 해시 + 서명 기록 | 블록체인 (Base Sepolia) |

#### 워크플로우
```
1. 문서 생성
   - 파일 선택 → SHA-256 해시 계산
   - 승인자 이메일 입력 (최대 5명)
   - 필요 승인 수 설정 (M-of-N)
   - 만료일 설정 (기본 3일)

2. 블록체인 등록 (선택)
   - 파일 해시를 스마트 컨트랙트에 등록
   - 트랜잭션 해시 저장

3. 승인 프로세스
   - 승인자가 지갑 연결
   - 승인/거절 + 코멘트
   - 지갑 서명 (블록체인 기록)

4. 완료
   - 필요 수만큼 승인 시 → 상태: "approved"
   - 거절 시 → 상태: "rejected"
   - 만료 시 → 상태: "expired"
```

#### 관련 파일
- `src/lib/vault.ts` - 비즈니스 로직
- `src/app/api/vault/` - API 엔드포인트
- `src/app/vault/page.tsx` - UI
- `contracts/DocumentRegistry.sol` - 스마트 컨트랙트

---

### 4.4 블록체인 통합

#### 스마트 컨트랙트 (DocumentRegistry)

```solidity
// 핵심 함수들
registerDocument(fileHash, metadata, approvers, requiredApprovals, expiresIn)
  → 문서 등록, 문서 ID 반환

signDocument(documentId, comment)
  → 승인 서명

verifyHash(fileHash)
  → (존재여부, 완료여부, 문서ID) 반환

getDocumentByHash(fileHash)
  → 전체 문서 정보 반환
```

#### 네트워크 설정

| 네트워크 | 용도 | RPC |
|---------|-----|-----|
| Base Sepolia | 테스트넷 (현재 사용) | Alchemy |
| Base | 메인넷 (프로덕션) | Alchemy |

#### 파일 해시 검증 흐름
```
1. 파일 URL에서 SHA-256 해시 계산 (브라우저)
2. 블록체인에서 해당 해시로 문서 조회
3. 비교:
   - 일치 → "Verified" (녹색 배지)
   - 불일치 → "Tampered" (빨간 배지)
   - 미등록 → "Not Registered" (회색 배지)
```

---

### 4.5 휴지통 (Soft Delete)

```
삭제 요청 → deleted_at 타임스탬프 설정 (Soft Delete)
         → 30일 후 자동 영구 삭제 (Cleanup Job)

복원 요청 → deleted_at = null
```

---

### 4.6 비디오 트랜스코딩

```
원본 업로드 → FFmpeg로 HLS 변환
           → 다중 화질 (1080p, 720p, 480p, 360p)
           → R2에 세그먼트 저장
           → hls.js로 적응형 스트리밍
```

---

## 5. 데이터베이스 스키마

### 주요 테이블

#### users
```sql
id              UUID PRIMARY KEY
email           VARCHAR UNIQUE
password_hash   VARCHAR
email_verified  BOOLEAN
display_name    VARCHAR
avatar_url      VARCHAR
wallet_address  VARCHAR          -- 연결된 지갑 주소
totp_enabled    BOOLEAN          -- 2FA 활성화 여부
created_at      TIMESTAMP
```

#### photos (파일)
```sql
id              UUID PRIMARY KEY
user_id         UUID REFERENCES users
name            VARCHAR
url             VARCHAR          -- R2 URL
file_size       BIGINT
thumbnail_url   VARCHAR
file_type       VARCHAR
created_at      TIMESTAMP
deleted_at      TIMESTAMP        -- Soft delete용
```

#### vault_documents
```sql
id                  UUID PRIMARY KEY
file_id             UUID REFERENCES photos
owner_id            UUID REFERENCES users
title               VARCHAR
description         TEXT
required_approvals  INTEGER      -- 필요 승인 수
status              VARCHAR      -- pending/approved/rejected/expired
allowed_domain      VARCHAR      -- 도메인 제한
expires_at          TIMESTAMP
file_hash           VARCHAR      -- SHA-256 해시
blockchain_tx_hash  VARCHAR      -- 블록체인 트랜잭션
created_at          TIMESTAMP
```

#### vault_approvals
```sql
id              UUID PRIMARY KEY
document_id     UUID REFERENCES vault_documents
approver_email  VARCHAR
decision        VARCHAR          -- pending/approved/rejected
comment         TEXT
wallet_address  VARCHAR          -- 서명한 지갑
wallet_signature VARCHAR         -- 서명 데이터
decided_at      TIMESTAMP
```

#### passkey_credentials
```sql
id              UUID PRIMARY KEY
user_id         UUID REFERENCES users
credential_id   VARCHAR          -- WebAuthn credential
public_key      TEXT             -- 공개키
counter         INTEGER          -- 리플레이 방지
device_type     VARCHAR          -- singleDevice/multiDevice
name            VARCHAR          -- 기기 이름
created_at      TIMESTAMP
last_used_at    TIMESTAMP
```

#### audit_logs
```sql
id          UUID PRIMARY KEY
action      VARCHAR              -- LOGIN_SUCCESS, UPLOAD, etc.
ip          VARCHAR
user_agent  VARCHAR
details     JSONB
created_at  TIMESTAMP
```

---

## 6. API 엔드포인트

### 인증 (Auth)

| Method | Endpoint | 설명 |
|--------|----------|-----|
| POST | `/api/auth/register` | 회원가입 |
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/logout` | 로그아웃 |
| POST | `/api/auth/magic-link` | 매직링크 발송 |
| GET | `/api/auth/magic-link/verify` | 매직링크 검증 |
| GET | `/api/auth/me` | 현재 사용자 정보 |

### 패스키 (Passkey)

| Method | Endpoint | 설명 |
|--------|----------|-----|
| POST | `/api/passkey/register` | 패스키 등록 |
| POST | `/api/passkey/authenticate` | 패스키 인증 |
| GET | `/api/passkey` | 패스키 목록 |
| DELETE | `/api/passkey` | 패스키 삭제 |

### Vault

| Method | Endpoint | 설명 |
|--------|----------|-----|
| GET | `/api/vault` | 문서 목록 |
| POST | `/api/vault` | 문서 생성 |
| GET | `/api/vault/[id]` | 문서 상세 |
| POST | `/api/vault/[id]` | 승인/거절 |
| DELETE | `/api/vault/[id]` | 문서 삭제 |
| GET/POST | `/api/vault/verify` | 패스키 인증 |

### 파일

| Method | Endpoint | 설명 |
|--------|----------|-----|
| POST | `/api/upload` | 파일 업로드 |
| GET | `/api/image/[...path]` | 이미지 프록시 |
| POST | `/api/delete` | 파일 삭제 (휴지통) |
| POST | `/api/copy` | 파일 복사 |
| GET | `/api/storage` | 저장 용량 조회 |

### 휴지통

| Method | Endpoint | 설명 |
|--------|----------|-----|
| GET | `/api/trash` | 휴지통 목록 |
| POST | `/api/trash/restore` | 복원 |
| DELETE | `/api/trash` | 영구 삭제 |

---

## 7. 보안

### 인증 보안
- **비밀번호**: bcrypt (12 라운드)
- **세션**: IP 바인딩, 7일 타임아웃
- **Rate Limiting**: 5회/15분/IP
- **2FA**: TOTP (30초 윈도우)

### API 보안
- **이메일 화이트리스트**: 허용된 도메인/이메일만 가입 가능
- **감사 로그**: 모든 중요 작업 기록
- **파일 검증**: Magic Bytes로 실제 파일 타입 확인

### 블록체인 보안
- **파일 무결성**: SHA-256 해시로 변조 감지
- **서명 검증**: viem.verifyMessage로 지갑 서명 확인
- **타임스탬프**: 10분 허용 오차

---

## 8. 환경 변수

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=

# Email (SMTP)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=

# WebAuthn
WEBAUTHN_RP_ID=
WEBAUTHN_ORIGIN=

# Blockchain
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_ALCHEMY_API_KEY=
NEXT_PUBLIC_CONTRACT_ADDRESS_BASE_SEPOLIA=

# Security
GALLERY_PASSWORD=          # 세션 토큰 서명 키
TOTP_SECRET=              # 2FA 시크릿

# App
NEXT_PUBLIC_APP_URL=
```

---

## 요약

| 구분 | 기술 |
|-----|-----|
| **프레임워크** | Next.js 16 (React 19) |
| **데이터베이스** | Supabase (PostgreSQL) |
| **파일 저장소** | Cloudflare R2 |
| **인증** | JWT + Passkey + 2FA |
| **블록체인** | Base Sepolia + Solidity |
| **배포** | Vercel |

---

*이 문서는 Cloody 프로젝트의 기술적 구현을 설명합니다. 질문이 있으면 코드베이스를 참고하세요.*
