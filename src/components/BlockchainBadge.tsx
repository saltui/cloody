'use client'

import { useState, useEffect } from 'react'
import { useVerifyHash, useDocumentByHash, getExplorerUrl, getTxUrl } from '@/lib/web3'
import { computeHashFromUrl, truncateHash, compareHashes } from '@/lib/hash'
import { useChainId } from 'wagmi'

interface BlockchainBadgeProps {
  fileUrl: string
  className?: string
}

type VerificationStatus = 'loading' | 'verified' | 'not_registered' | 'tampered' | 'error'

export default function BlockchainBadge({ fileUrl, className = '' }: BlockchainBadgeProps) {
  const chainId = useChainId()
  const [currentHash, setCurrentHash] = useState<string | null>(null)
  const [status, setStatus] = useState<VerificationStatus>('loading')
  const [showModal, setShowModal] = useState(false)

  // 현재 파일의 해시 계산
  useEffect(() => {
    if (!fileUrl) return

    const computeHash = async () => {
      try {
        // 프록시 URL로 변환
        const proxyUrl = fileUrl.startsWith('/api/image/')
          ? fileUrl
          : (() => {
              try {
                const urlObj = new URL(fileUrl)
                return `/api/image/${urlObj.pathname.substring(1)}`
              } catch {
                return fileUrl
              }
            })()

        const hash = await computeHashFromUrl(proxyUrl)
        setCurrentHash(hash)
      } catch (error) {
        console.error('Hash computation error:', error)
        setStatus('error')
      }
    }

    computeHash()
  }, [fileUrl])

  // 블록체인에서 해시 검증
  const { exists, isFinalized, isLoading } = useVerifyHash(currentHash || undefined)
  const { document: onChainDoc } = useDocumentByHash(currentHash || undefined)

  // 상태 결정
  useEffect(() => {
    if (!currentHash) return
    if (isLoading) {
      setStatus('loading')
      return
    }

    if (!exists) {
      setStatus('not_registered')
    } else if (onChainDoc && compareHashes(currentHash, onChainDoc.fileHash)) {
      setStatus('verified')
    } else {
      setStatus('tampered')
    }
  }, [currentHash, exists, isLoading, onChainDoc])

  const getStatusConfig = () => {
    switch (status) {
      case 'loading':
        return {
          bg: 'var(--glass-bg)',
          color: 'var(--foreground-muted)',
          icon: (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ),
          text: '검증 중...',
        }
      case 'verified':
        return {
          bg: 'rgba(34, 197, 94, 0.15)',
          color: 'var(--success)',
          icon: (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          ),
          text: 'Blockchain Verified',
        }
      case 'not_registered':
        return {
          bg: 'var(--glass-bg)',
          color: 'var(--foreground-muted)',
          icon: (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          text: 'Not Registered',
        }
      case 'tampered':
        return {
          bg: 'rgba(239, 68, 68, 0.15)',
          color: 'var(--error)',
          icon: (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          text: 'Tampered!',
        }
      default:
        return {
          bg: 'rgba(239, 68, 68, 0.15)',
          color: 'var(--error)',
          icon: (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          text: 'Error',
        }
    }
  }

  const config = getStatusConfig()

  return (
    <>
      {/* Badge */}
      <button
        onClick={() => setShowModal(true)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-opacity hover:opacity-80 ${className}`}
        style={{ background: config.bg, color: config.color }}
      >
        {config.icon}
        <span>{config.text}</span>
      </button>

      {/* Verification Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md rounded-2xl p-6"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: 'var(--foreground-muted)' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: config.bg }}
              >
                <svg className="w-6 h-6" style={{ color: config.color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
                  블록체인 검증
                </h3>
                <p className="text-sm" style={{ color: config.color }}>
                  {config.text}
                </p>
              </div>
            </div>

            {/* Hash Comparison */}
            <div className="space-y-4">
              {/* Current File Hash */}
              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--foreground-muted)' }}>
                  현재 파일 해시 (SHA-256)
                </p>
                <div
                  className="p-3 rounded-lg font-mono text-xs break-all"
                  style={{ background: 'var(--glass-bg)', color: 'var(--foreground-secondary)' }}
                >
                  {currentHash || '계산 중...'}
                </div>
              </div>

              {/* On-chain Hash */}
              {exists && onChainDoc && (
                <div>
                  <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--foreground-muted)' }}>
                    블록체인 기록 해시
                  </p>
                  <div
                    className="p-3 rounded-lg font-mono text-xs break-all"
                    style={{ background: 'var(--glass-bg)', color: 'var(--foreground-secondary)' }}
                  >
                    {onChainDoc.fileHash}
                  </div>
                </div>
              )}

              {/* Match Status */}
              {currentHash && exists && onChainDoc && (
                <div
                  className="p-3 rounded-lg flex items-center gap-2"
                  style={{
                    background: compareHashes(currentHash, onChainDoc.fileHash)
                      ? 'rgba(34, 197, 94, 0.1)'
                      : 'rgba(239, 68, 68, 0.1)',
                    color: compareHashes(currentHash, onChainDoc.fileHash)
                      ? 'var(--success)'
                      : 'var(--error)',
                  }}
                >
                  {compareHashes(currentHash, onChainDoc.fileHash) ? (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm font-medium">해시가 일치합니다. 문서가 위변조되지 않았습니다.</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span className="text-sm font-medium">해시가 불일치합니다. 문서가 변경되었을 수 있습니다.</span>
                    </>
                  )}
                </div>
              )}

              {/* On-chain Details */}
              {exists && onChainDoc && (
                <div className="pt-2 border-t" style={{ borderColor: 'var(--glass-border)' }}>
                  <p className="text-xs font-medium mb-2" style={{ color: 'var(--foreground-muted)' }}>
                    블록체인 정보
                  </p>
                  <div className="space-y-2 text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                    <div className="flex justify-between">
                      <span>문서 ID</span>
                      <span className="font-mono">#{onChainDoc.id.toString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>업로더</span>
                      <span className="font-mono">{truncateHash(onChainDoc.uploader)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>승인 현황</span>
                      <span>{onChainDoc.approvalCount.toString()}/{onChainDoc.requiredApprovals.toString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>상태</span>
                      <span
                        className="font-medium"
                        style={{ color: onChainDoc.isFinalized ? 'var(--success)' : 'var(--warning)' }}
                      >
                        {onChainDoc.isFinalized ? '최종 승인됨' : '승인 진행 중'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Explorer Link */}
              {exists && (
                <a
                  href={getExplorerUrl(chainId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 p-3 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
                  style={{ background: 'var(--accent-gradient-subtle)', color: 'var(--accent-primary)' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  BaseScan에서 보기
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
