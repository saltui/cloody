# Cloody

**ISMS 준수 및 EDMS 기능을 갖춘 차세대 프라이빗 클라우드**

Cloody는 기업의 정보보호관리체계(ISMS) 요건을 충족하고 전자문서관리시스템(EDMS)의 무결성을 보장하기 위해 설계된 엔터프라이즈급 내부 클라우드 솔루션입니다. 블록체인 기술을 활용한 문서 원본 증명과 Vault 기반의 다중 서명 승인 프로세스를 제공합니다.

---

## 🚀 프로젝트 개요

단순한 파일 저장소를 넘어, **보안(Security)**, **무결성(Integrity)**, **감사(Audit)**에 초점을 맞춘 시스템입니다.

- **Private Cloud**: Cloudflare R2 기반의 안전하고 빠른 파일 저장소
- **ISMS Security**: 다중 인증(MFA), 세션 관리, 접근 통제 등 보안 컴플라이언스 준수
- **Blockchain EDMS**: 문서의 해시값을 블록체인(Base Sepolia)에 기록하여 위변조 방지 및 원본 증명
- **Vault Approval**: M-of-N 다중 서명 방식을 통한 중요 문서 승인 워크플로우

---

## ✨ 핵심 기능 (Security & Compliance)

### 1. 강력한 접근 통제 (ISMS)
- **Multi-Factor Authentication (MFA)**:
    - **Passkeys (WebAuthn)**: 생체 인증(FaceID, TouchID)을 통한 암호 없는 로그인
    - **2FA (TOTP)**: Google Authenticator 등을 이용한 2단계 인증
    - **Magic Link**: 이메일 기반의 안전한 일회용 로그인 링크
- **세션 보안**: IP 바인딩 및 강제 만료 정책으로 세션 탈취 방지

### 2. 데이터 무결성 및 EDMS (Blockchain)
- **Document Anchoring**: 업로드된 파일의 SHA-256 해시를 계산하여 스마트 컨트랙트에 영구 기록
- **Verification Badge**: 파일 열람 시 블록체인 기록과 대조하여 `Verified`(원본), `Tampered`(변조됨), `Not Registered`(미등록) 상태 표시
- **Audit Logs**: 파일 접근, 다운로드, 삭제 등 모든 중요 행위를 기록하여 감사 추적 가능

### 3. Vault (보안 금고 & 결재)
- **M-of-N Multi-Sig**: 중요 문서는 지정된 승인자 N명 중 M명 이상의 서명이 있어야 최종 승인/열람 가능
- **On-Chain Signatures**: 승인/거절 이력이 블록체인에 기록되어 부인 방지(Non-repudiation) 보장
- **Time-Locked**: 유효 기간 설정으로 권한의 한시적 부여

### 4. 고가용성 스토리지 및 미디어 처리
- **Resiliency**: Cloudflare R2를 이용한 99.999999999% 내구성
- **Soft Delete**: 휴지통 기능을 통해 실수로 삭제된 데이터의 복원 가능 (30일 보관)
- **Video Transcoding**: 업로드된 영상을 HLS로 자동 변환하여 다양한 네트워크 환경에서 스트리밍 최적화

---

## 🛠 기술 스택 (Tech Stack)

### Frontend
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4, Lucide React
- **Web3**: Wagmi, Viem, RainbowKit
- **Auth**: SimpleWebAuthn (Passkeys)

### Backend & Infrastructure
- **Database**: Supabase (PostgreSQL)
- **Storage**: Cloudflare R2 (S3 Compatible)
- **API**: Next.js API Routes (Serverless)
- **Media**: FFmpeg (HLS Transcoding)

### Blockchain
- **Network**: Base Sepolia (Testnet)
- **Smart Contract**: Solidity 0.8.20
- **Dev Tools**: Hardhat, Alchemy

---

## 🏁 시작하기 (Getting Started)

### 사전 준비사항
- Node.js 18+
- Supabase 프로젝트
- Cloudflare R2 버킷
- WalletConnect Project ID

### 설치 및 실행

1. **저장소 클론**
   ```bash
   git clone https://github.com/your-org/cloody.git
   cd cloody
   npm install
   ```

2. **환경 변수 설정**
   `.env.local` 파일을 생성하고 필요한 값을 입력합니다. (예제는 `.env.local.example` 참고)
   ```bash
   cp .env.local.example .env.local
   ```

3. **개발 서버 실행**
   ```bash
   npm run dev
   ```

---

## 📦 배포 (Deployment)

Vercel 배포에 최적화되어 있습니다. 다음 환경 변수를 Vercel 프로젝트 설정에 반드시 추가해야 합니다.

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `NEXT_PUBLIC_ALCHEMY_API_KEY` (선택 사항, 안정성 향상)

---

## 📄 라이선스

This project is proprietary software.
Copyright © 2026 Cloody Team. All rights reserved.
