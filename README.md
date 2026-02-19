# Cloody

개인용 웹 클라우드 프로젝트입니다.

## 핵심 기능
- 파일 업로드/정리: 사진, 동영상, 문서
- 폴더 관리 및 휴지통 복구
- 로그인: 패스키, 매직 링크, 2FA(TOTP)
- 스토리지: Cloudflare R2
- 데이터베이스: Supabase PostgreSQL

## 기술 스택
- Next.js 16 (App Router)
- TypeScript
- Supabase
- Cloudflare R2

## 로컬 실행
1. 의존성 설치
```bash
npm install
```

2. 환경 변수 파일 생성
```bash
cp .env.local.example .env.local
```

3. Supabase SQL Editor에서 아래 마이그레이션을 순서대로 실행
- `supabase/migrations/000_base_schema.sql`
- `supabase/migrations/001_add_video_metadata.sql`
- `supabase/migrations/002_transcoding_jobs.sql`

4. 개발 서버 실행
```bash
npm run dev
```

## 배포 환경 변수
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL`
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (매직 링크 사용 시)

## 라이선스
Proprietary software.
Copyright © 2026 Cloody Team.
