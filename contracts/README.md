# DocumentRegistry Smart Contract

Vault 문서의 해시를 블록체인에 앵커링하여 무결성을 검증하는 스마트 컨트랙트

## 기능

- **registerDocument**: 문서 해시와 메타데이터를 블록체인에 등록
- **signDocument**: 승인자가 문서에 서명 (M-of-N 다중서명)
- **verifyHash**: 파일 해시가 블록체인에 기록되어 있는지 확인

## 배포 방법

### 1. Foundry 사용

```bash
# Foundry 설치
curl -L https://foundry.paradigm.xyz | bash
foundryup

# 배포 (Base Sepolia)
forge create contracts/DocumentRegistry.sol:DocumentRegistry \
  --rpc-url https://sepolia.base.org \
  --private-key YOUR_PRIVATE_KEY
```

### 2. Remix 사용

1. [Remix IDE](https://remix.ethereum.org) 접속
2. `contracts/DocumentRegistry.sol` 파일 업로드
3. Compile (Solidity 0.8.20+)
4. Deploy to Base Sepolia

### 3. Hardhat 사용

```bash
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
npx hardhat init

# hardhat.config.js에 Base Sepolia 네트워크 추가
# npx hardhat run scripts/deploy.js --network baseSepolia
```

## 환경 변수 설정

배포 후 `.env.local`에 컨트랙트 주소 추가:

```env
NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA=0x... (배포된 주소)
```

## 테스트넷 Faucet

- [Base Sepolia Faucet](https://www.alchemy.com/faucets/base-sepolia)
- [Coinbase Faucet](https://faucet.coinbase.com/)

## 가스비 예상

| 함수 | 예상 가스 |
|------|----------|
| registerDocument | ~150,000 |
| signDocument | ~50,000 |
| verifyHash (view) | 무료 |
