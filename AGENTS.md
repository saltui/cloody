# AGENTS.md - Cloody

## Project Overview

Cloody는 개인용 미디어 클라우드 앱입니다. 사용자 인증(Passkey/Magic Link), 미디어 업로드/관리 기능을 제공합니다.

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **React:** 19.x
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS v4
- **UI:** Toss Design System Mobile (`@toss/tds-mobile`)
- **Database:** Supabase
- **Storage:** Cloudflare R2 (S3-compatible)
- **Auth:** WebAuthn (Passkey), Magic Link, Email

## Development Setup

```bash
# Install dependencies
npm install

# Set up environment
cp .env.local.example .env.local
# Fill in Supabase, AWS, and other credentials

# Start development server
npm run dev
```

## Build & Test Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Next.js dev server (use this during iteration) |
| `npm run build` | Production build (avoid during agent sessions) |
| `npm run lint` | ESLint validation |
| `npm run start` | Start production server |

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API Routes
│   │   ├── auth/          # Auth endpoints (register, login, magic-link)
│   │   ├── passkey/       # WebAuthn passkey endpoints
│   │   ├── thumbnail/     # Image processing (HEIC conversion)
│   │   └── delete/        # Media deletion
│   ├── settings/          # Settings page
│   ├── trash/             # Trash/deleted items
│   └── viewer/            # Media viewer
supabase/                  # Supabase migrations
migrations/                # Database migrations
public/                    # Static assets
```

## Code Style Guidelines

- TypeScript strict mode 사용
- Toss Design System 컴포넌트 우선 사용
- API Routes는 App Router 방식 (`route.ts`)
- 서버 컴포넌트 기본, 필요시에만 `"use client"`

## Important Notes for Agents

- **Dev Server 필수:** 개발 중에는 항상 `npm run dev` 사용, production build 피하기
- **HEIC 처리:** iOS 이미지는 `heic2any`로 변환 필요
- **인증 흐름:** Passkey → Magic Link → Email 순서로 fallback
- **S3 업로드:** presigned URL 방식 사용
- **Supabase:** Row Level Security (RLS) 활성화됨

## Environment Variables

필수 환경 변수 (`.env.local`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`, `R2_PUBLIC_URL`

## Security Considerations

- 절대 `.env.local` 파일 커밋하지 않기
- Supabase RLS 정책 항상 확인
- API Routes에서 인증 상태 검증 필수
- S3 presigned URL 만료 시간 적절히 설정
