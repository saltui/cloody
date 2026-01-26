'use client'

import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount, useChainId } from 'wagmi'
import { DocumentRegistryABI } from './abi'
import { getContractAddress, getTxUrl } from './config'
import { hashToBytes32 } from '../hash'

// 문서 등록
export function useRegisterDocument() {
  const chainId = useChainId()
  const contractAddress = getContractAddress(chainId)

  const { writeContract, data: hash, isPending, error } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const register = async (params: {
    fileHash: string
    metaData: string
    approvers: `0x${string}`[]
    requiredApprovals: number
    expiresInSeconds: number
  }) => {
    if (!contractAddress) {
      throw new Error('Contract not deployed on this chain')
    }

    writeContract({
      address: contractAddress as `0x${string}`,
      abi: DocumentRegistryABI,
      functionName: 'registerDocument',
      args: [
        hashToBytes32(params.fileHash),
        params.metaData,
        params.approvers,
        BigInt(params.requiredApprovals),
        BigInt(params.expiresInSeconds),
      ],
    })
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
      address: contractAddress as `0x${string}`,
      abi: DocumentRegistryABI,
      functionName: 'signDocument',
      args: [documentId, comment],
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
    address: contractAddress as `0x${string}`,
    abi: DocumentRegistryABI,
    functionName: 'verifyHash',
    args: fileHash ? [hashToBytes32(fileHash)] : undefined,
    query: {
      enabled: !!fileHash && !!contractAddress,
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
    address: contractAddress as `0x${string}`,
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
    address: contractAddress as `0x${string}`,
    abi: DocumentRegistryABI,
    functionName: 'getDocumentByHash',
    args: fileHash ? [hashToBytes32(fileHash)] : undefined,
    query: {
      enabled: !!fileHash && !!contractAddress,
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
    address: contractAddress as `0x${string}`,
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
