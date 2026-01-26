import { http, createConfig } from 'wagmi'
import { baseSepolia, base } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

// WalletConnect Project ID (https://cloud.walletconnect.com에서 발급)
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ''

export const config = createConfig({
  chains: [baseSepolia, base],
  connectors: [
    injected(),
    ...(projectId ? [walletConnect({ projectId })] : []),
  ],
  transports: {
    [baseSepolia.id]: http(),
    [base.id]: http(),
  },
})

// 현재 사용 중인 체인 (테스트넷 / 메인넷)
export const ACTIVE_CHAIN = baseSepolia

// 컨트랙트 주소 (배포 후 업데이트 필요)
export const CONTRACT_ADDRESSES = {
  [baseSepolia.id]: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA || '',
  [base.id]: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_BASE || '',
} as const

export function getContractAddress(chainId: number): string {
  return CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES] || ''
}

// 블록 익스플로러 URL
export const EXPLORER_URLS = {
  [baseSepolia.id]: 'https://sepolia.basescan.org',
  [base.id]: 'https://basescan.org',
} as const

export function getExplorerUrl(chainId: number): string {
  return EXPLORER_URLS[chainId as keyof typeof EXPLORER_URLS] || ''
}

export function getTxUrl(chainId: number, txHash: string): string {
  return `${getExplorerUrl(chainId)}/tx/${txHash}`
}

export function getAddressUrl(chainId: number, address: string): string {
  return `${getExplorerUrl(chainId)}/address/${address}`
}
