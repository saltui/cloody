'use client'

import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount, useChainId } from 'wagmi'
import { DocumentRegistryABI } from './abi'
import { getContractAddress, getTxUrl } from './config'
import { hashToBytes32 } from '../hash'

// 문서 등록
export function useRegisterDocument() {
  const chainId = useChainId()
  const contractAddress = getContractAddress(chainId)

  const { writeContractAsync, data: hash, isPending, error } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const register = async (params: {
    fileHash: string
    metaData: string
    approvers?: `0x${string}`[]
    requiredApprovals?: number
    expiresInSeconds?: number
  }) => {
    if (!contractAddress) {
      throw new Error('Contract not deployed on this chain')
    }

    // 기본값: 승인자 없이 해시만 등록 (위변조 방지용)
    const approvers = params.approvers || []
    const requiredApprovals = params.requiredApprovals || 0
    const expiresInSeconds = params.expiresInSeconds || 365 * 24 * 60 * 60 // 기본 1년

    const txHash = await writeContractAsync({
      address: contractAddress,
      abi: DocumentRegistryABI,
      functionName: 'registerDocument',
      args: [
        hashToBytes32(params.fileHash),
        params.metaData,
        approvers,
        BigInt(requiredApprovals),
        BigInt(expiresInSeconds),
      ],
      gas: BigInt(500_000), // MetaMask 가스 리밋 cap (16,777,216) 초과 방지
    })

    return txHash
  }

  return {
    register,
    txHash: hash,
    txUrl: hash ? getTxUrl(chainId, hash) : null,
    isPending,
    isConfirming,
    isSuccess,
    error,
  }
}

// 문서 서명
export function useSignDocument() {
  const chainId = useChainId()
  const contractAddress = getContractAddress(chainId)

  const { writeContract, data: hash, isPending, error } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const sign = (documentId: bigint, comment: string) => {
    if (!contractAddress) {
      throw new Error('Contract not deployed on this chain')
    }

    writeContract({
      address: contractAddress,
      abi: DocumentRegistryABI,
      functionName: 'signDocument',
      args: [documentId, comment],
      gas: BigInt(200_000), // MetaMask 가스 리밋 cap 초과 방지
    })
  }

  return {
    sign,
    txHash: hash,
    txUrl: hash ? getTxUrl(chainId, hash) : null,
    isPending,
    isConfirming,
    isSuccess,
    error,
  }
}

// 해시로 문서 검증
export function useVerifyHash(fileHash: string | undefined) {
  const chainId = useChainId()
  const contractAddress = getContractAddress(chainId)

  const { data, isLoading, error, refetch } = useReadContract({
    address: contractAddress ?? '0x0000000000000000000000000000000000000000',
    abi: DocumentRegistryABI,
    functionName: 'verifyHash',
    args: fileHash ? [hashToBytes32(fileHash)] : undefined,
    query: {
      enabled: !!fileHash && !!contractAddress,
      staleTime: 60 * 1000, // 1분간 캐시
      gcTime: 5 * 60 * 1000, // 5분간 GC 방지
      retry: 1, // 실패 시 1회만 재시도
    },
  })

  return {
    exists: data?.[0] ?? false,
    isFinalized: data?.[1] ?? false,
    documentId: data?.[2] ?? BigInt(0),
    isLoading,
    error,
    refetch,
  }
}

// 문서 ID로 조회
export function useDocument(documentId: bigint | undefined) {
  const chainId = useChainId()
  const contractAddress = getContractAddress(chainId)

  const { data, isLoading, error, refetch } = useReadContract({
    address: contractAddress ?? '0x0000000000000000000000000000000000000000',
    abi: DocumentRegistryABI,
    functionName: 'getDocument',
    args: documentId ? [documentId] : undefined,
    query: {
      enabled: !!documentId && documentId > BigInt(0) && !!contractAddress,
    },
  })

  return {
    document: data,
    isLoading,
    error,
    refetch,
  }
}

// 해시로 문서 조회
export function useDocumentByHash(fileHash: string | undefined) {
  const chainId = useChainId()
  const contractAddress = getContractAddress(chainId)

  const { data, isLoading, error, refetch } = useReadContract({
    address: contractAddress ?? '0x0000000000000000000000000000000000000000',
    abi: DocumentRegistryABI,
    functionName: 'getDocumentByHash',
    args: fileHash ? [hashToBytes32(fileHash)] : undefined,
    query: {
      enabled: !!fileHash && !!contractAddress,
      staleTime: 60 * 1000, // 1분간 캐시
      gcTime: 5 * 60 * 1000, // 5분간 GC 방지
      retry: 1, // 실패 시 1회만 재시도
    },
  })

  return {
    document: data,
    isLoading,
    error,
    refetch,
  }
}

// 승인 여부 확인
export function useHasApproved(documentId: bigint | undefined, approver: `0x${string}` | undefined) {
  const chainId = useChainId()
  const contractAddress = getContractAddress(chainId)

  const { data, isLoading, error, refetch } = useReadContract({
    address: contractAddress ?? '0x0000000000000000000000000000000000000000',
    abi: DocumentRegistryABI,
    functionName: 'hasApproved',
    args: documentId && approver ? [documentId, approver] : undefined,
    query: {
      enabled: !!documentId && !!approver && !!contractAddress,
    },
  })

  return {
    hasApproved: data ?? false,
    isLoading,
    error,
    refetch,
  }
}

// 현재 사용자의 월렛 주소
export function useWalletAddress() {
  const { address, isConnected } = useAccount()
  return { address, isConnected }
}

// 컨트랙트 연결 상태
export function useContractStatus() {
  const chainId = useChainId()
  const contractAddress = getContractAddress(chainId)
  const { isConnected } = useAccount()

  return {
    isContractAvailable: !!contractAddress,
    isWalletConnected: isConnected,
    isReady: !!contractAddress && isConnected,
    contractAddress,
    chainId,
  }
}
