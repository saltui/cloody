import { http, createConfig, fallback } from 'wagmi'
import { sepolia, baseSepolia, base } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'
import { getAddress } from 'viem'

// WalletConnect Project ID (https://cloud.walletconnect.com에서 발급)
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ''

// Alchemy API Key (선택사항 - 더 안정적인 RPC)
const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || ''

export const config = createConfig({
  chains: [sepolia, baseSepolia, base],
  connectors: [
    injected(),
    ...(projectId ? [walletConnect({ projectId })] : []),
  ],
  transports: {
    // Sepolia: 여러 RPC fallback 사용
    [sepolia.id]: fallback([
      // Alchemy (가장 안정적)
      ...(alchemyApiKey ? [http(`https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`, {
        batch: { wait: 100 },
        retryCount: 2,
        retryDelay: 1000,
      })] : []),
      // 공용 RPC들 (fallback)
      http('https://ethereum-sepolia-rpc.publicnode.com', {
        batch: { wait: 100 },
        retryCount: 1,
        retryDelay: 500,
      }),
      http('https://rpc2.sepolia.org', {
        batch: { wait: 100 },
        retryCount: 1,
        retryDelay: 500,
      }),
      http('https://rpc.sepolia.org', {
        batch: { wait: 100 },
        retryCount: 1,
        retryDelay: 500,
      }),
    ]),
    [baseSepolia.id]: http(undefined, {
      batch: { wait: 100 },
      retryCount: 2,
    }),
    [base.id]: http(undefined, {
      batch: { wait: 100 },
      retryCount: 2,
    }),
  },
})

// 현재 사용 중인 체인 (테스트넷 / 메인넷)
export const ACTIVE_CHAIN = sepolia

// 컨트랙트 주소 (배포 후 업데이트 필요)
export const CONTRACT_ADDRESSES = {
  [sepolia.id]: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA || '',
  [baseSepolia.id]: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA || '',
  [base.id]: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_BASE || '',
} as const

export function getContractAddress(chainId: number): `0x${string}` | null {
  const address = CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES]
  if (!address) return null
  try {
    // EIP-55 체크섬으로 주소 정규화
    return getAddress(address)
  } catch {
    console.error('Invalid contract address:', address)
    return null
  }
}

// 블록 익스플로러 URL
export const EXPLORER_URLS = {
  [sepolia.id]: 'https://sepolia.etherscan.io',
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

// 익스플로러 이름
export const EXPLORER_NAMES = {
  [sepolia.id]: 'Etherscan',
  [baseSepolia.id]: 'BaseScan',
  [base.id]: 'BaseScan',
} as const

export function getExplorerName(chainId: number): string {
  return EXPLORER_NAMES[chainId as keyof typeof EXPLORER_NAMES] || 'Explorer'
}
