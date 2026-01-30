'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { useToast } from '@/components/Toast'
import Sidebar from '@/components/Sidebar'
import BlockchainBadge from '@/components/BlockchainBadge'
import VaultAuthModal from '@/components/VaultAuthModal'
import { supabase } from '@/lib/supabase'
import { VaultDocument, VaultApproval, getApprovalProgress, getTimeRemaining, isDocumentExpired } from '@/lib/vault'
import { useAccount, useSignMessage } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useSignDocument, useVerifyHash, useRegisterDocument, useDocumentByHash, useHasApproved, useDocument } from '@/lib/web3'
import { computeHashFromUrl } from '@/lib/hash'

type TabType = 'owned' | 'pending'

export default function VaultPage() {
  const router = useRouter()
  const { user, isLoading: userLoading } = useUser()
  const { showToast } = useToast()

  // Wallet hooks
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { signMessageAsync } = useSignMessage()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [documents, setDocuments] = useState<VaultDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('owned')
  const [selectedDoc, setSelectedDoc] = useState<VaultDocument | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [approvalComment, setApprovalComment] = useState('')
  const [showWalletPrompt, setShowWalletPrompt] = useState(false)

  // 패스키 인증 상태
  const [authChecking, setAuthChecking] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null)

  // 문서 목록 조회
  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/vault')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setDocuments(data.documents || [])
    } catch (error) {
      showToast('문서 목록을 불러오는데 실패했습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login')
      return
    }
    if (user) {
      fetchDocuments()
    }
  }, [user, userLoading, router])

  // 패스키 인증 필요 여부 체크
  useEffect(() => {
    const checkAuth = async () => {
      if (!user) {
        setAuthChecking(false)
        return
      }

      // 1. localStorage 먼저 체크 (네트워크 호출 없이 빠르게)
      const intervalStr = localStorage.getItem('vault_auth_interval')
      const interval = intervalStr ? parseInt(intervalStr, 10) : 5 // 기본값 5분
      const lastAuthStr = localStorage.getItem('vault_last_auth')
      const lastAuth = lastAuthStr ? parseInt(lastAuthStr, 10) : 0
      const now = Date.now()
      const elapsed = now - lastAuth
      const intervalMs = interval * 60 * 1000

      // 2. 인증이 아직 유효하면 API 호출 없이 바로 통과
      if (interval !== 0 && lastAuth > 0 && elapsed <= intervalMs) {
        setIsAuthenticated(true)
        setAuthChecking(false)
        return
      }

      // 3. 인증이 필요한 경우에만 API 호출 (패스키 유무 확인)
      try {
        const res = await fetch('/api/vault/verify')
        const data = await res.json()

        if (!data.hasPasskey) {
          // 패스키가 없으면 인증 불필요
          setHasPasskey(false)
          setIsAuthenticated(true)
          setAuthChecking(false)
          return
        }

        setHasPasskey(true)

        // 4. 재인증 필요
        setIsAuthenticated(false)
        setShowAuthModal(true)
      } catch {
        // 오류 시 인증 없이 접근 허용
        setIsAuthenticated(true)
      } finally {
        setAuthChecking(false)
      }
    }

    if (!userLoading && user) {
      checkAuth()
    }
  }, [user, userLoading])

  // 필터링된 문서
  const filteredDocs = documents.filter(doc => {
    if (activeTab === 'owned') {
      return doc.owner_id === user?.id
    } else {
      // 내가 승인해야 하는 문서 (내 소유가 아니고 내가 승인자)
      return doc.owner_id !== user?.id && doc.approvals?.some(
        a => a.approver_email.toLowerCase() === user?.email?.toLowerCase()
      )
    }
  })

  // 승인/거절 처리 (지갑 서명 필요)
  const handleDecision = async (docId: string, decision: 'approved' | 'rejected') => {
    // 1. 계정에 연결된 지갑 확인
    if (!user?.wallet_address) {
      setShowWalletPrompt(true)
      showToast('승인/거절하려면 먼저 설정에서 지갑을 연결해주세요.', 'error')
      return
    }

    // 2. 지갑 연결 확인
    if (!isConnected || !address) {
      if (openConnectModal) {
        openConnectModal()
      }
      showToast('지갑을 연결해주세요.', 'error')
      return
    }

    // 3. 연결된 지갑이 계정에 등록된 지갑과 일치하는지 확인
    if (address.toLowerCase() !== user.wallet_address.toLowerCase()) {
      showToast(`등록된 지갑(${user.wallet_address.slice(0, 6)}...${user.wallet_address.slice(-4)})으로 연결해주세요.`, 'error')
      return
    }

    setProcessing(true)
    try {
      // 4. 서명 메시지 생성
      const timestamp = Date.now()
      const message = `Cloody Vault ${decision === 'approved' ? 'Approval' : 'Rejection'}\n\nDocument ID: ${docId}\nDecision: ${decision}\nComment: ${approvalComment || 'N/A'}\nTimestamp: ${timestamp}`

      // 5. 지갑 서명 요청
      const signature = await signMessageAsync({ message })

      // 6. API에 서명과 함께 전송
      const res = await fetch(`/api/vault/${docId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          comment: approvalComment || undefined,
          walletAddress: address,
          signature,
          signedMessage: message,
          timestamp,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '처리에 실패했습니다.')
      }

      showToast(decision === 'approved' ? '승인했습니다.' : '거절했습니다.', 'success')
      setApprovalComment('')
      await fetchDocuments()
      setSelectedDoc(null)
    } catch (error) {
      if (error instanceof Error && error.message.includes('User rejected')) {
        showToast('서명이 취소되었습니다.', 'error')
      } else {
        showToast(error instanceof Error ? error.message : '처리에 실패했습니다.', 'error')
      }
    } finally {
      setProcessing(false)
    }
  }

  // 문서 삭제
  const handleDelete = async (docId: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return

    try {
      const res = await fetch(`/api/vault/${docId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제 실패')

      showToast('문서가 삭제되었습니다.', 'success')
      await fetchDocuments()
      setSelectedDoc(null)
    } catch (error) {
      showToast('삭제에 실패했습니다.', 'error')
    }
  }

  // 상태 배지
  const getStatusBadge = (status: string) => {
    const styles: Record<string, { bg: string; text: string; label: string }> = {
      pending: { bg: 'rgba(234, 179, 8, 0.15)', text: 'var(--warning)', label: '대기중' },
      approved: { bg: 'rgba(34, 197, 94, 0.15)', text: 'var(--success)', label: '승인됨' },
      rejected: { bg: 'rgba(239, 68, 68, 0.15)', text: 'var(--error)', label: '거절됨' },
      expired: { bg: 'rgba(107, 114, 128, 0.15)', text: 'var(--foreground-muted)', label: '만료됨' },
    }
    const style = styles[status] || styles.pending
    return (
      <span
        className="px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: style.bg, color: style.text }}
      >
        {style.label}
      </span>
    )
  }

  // 내 승인 상태 확인
  const getMyApprovalStatus = (doc: VaultDocument) => {
    const myApproval = doc.approvals?.find(
      a => a.approver_email.toLowerCase() === user?.email?.toLowerCase()
    )
    return myApproval?.decision || 'pending'
  }

  // 패스키 인증 모달
  if (showAuthModal && !isAuthenticated) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--background)' }}>
        <VaultAuthModal
          onSuccess={() => {
            setIsAuthenticated(true)
            setShowAuthModal(false)
          }}
          onCancel={() => {
            router.push('/drive?tab=more')
          }}
        />
      </div>
    )
  }

  if (userLoading || loading || authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="xl:ml-64">
        {/* Header */}
        <header
          className="h-[56px] sm:h-[65px] px-3 sm:px-4 flex items-center justify-between border-b sticky top-0 z-30"
          style={{ background: 'var(--background)', borderColor: 'var(--glass-border)' }}
        >
          <div className="flex items-center gap-2 sm:gap-3">
            {/* 모바일: 뒤로가기 버튼 (더보기 탭으로) */}
            <button
              onClick={() => router.push('/drive?tab=more')}
              className="xl:hidden p-2 -ml-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex-shrink-0"
              style={{ color: 'var(--foreground)' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            {/* 데스크톱: 사이드바 토글 */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="hidden xl:hidden p-2 -ml-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex-shrink-0"
              style={{ color: 'var(--foreground)' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <h1 className="text-base sm:text-lg font-semibold truncate" style={{ color: 'var(--foreground)' }}>Vault</h1>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn btn-primary flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">새 문서</span>
            </button>
          </div>
        </header>

        {/* Tabs */}
        <div className="px-3 sm:px-4 pt-3 sm:pt-4">
          <div className="flex gap-1 sm:gap-2 border-b" style={{ borderColor: 'var(--glass-border)' }}>
            <button
              onClick={() => setActiveTab('owned')}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'owned'
                  ? 'border-current'
                  : 'border-transparent hover:text-opacity-80'
              }`}
              style={{ color: activeTab === 'owned' ? 'var(--accent-primary)' : 'var(--foreground-muted)' }}
            >
              내 문서
            </button>
            <button
              onClick={() => setActiveTab('pending')}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'pending'
                  ? 'border-current'
                  : 'border-transparent hover:text-opacity-80'
              }`}
              style={{ color: activeTab === 'pending' ? 'var(--accent-primary)' : 'var(--foreground-muted)' }}
            >
              승인 대기
              {documents.filter(d => d.owner_id !== user?.id && d.status === 'pending').length > 0 && (
                <span
                  className="ml-1.5 sm:ml-2 px-1.5 py-0.5 rounded-full text-[10px] sm:text-xs"
                  style={{ background: 'var(--error)', color: 'white' }}
                >
                  {documents.filter(d => d.owner_id !== user?.id && d.status === 'pending').length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Document List */}
        <div className="p-3 sm:p-4">
          {filteredDocs.length === 0 ? (
            <div className="text-center py-16">
              <div
                className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
              >
                <svg className="w-8 h-8" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                {activeTab === 'owned' ? '아직 문서가 없습니다.' : '승인 대기 중인 문서가 없습니다.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {filteredDocs.map((doc) => {
                const progress = getApprovalProgress(doc)
                const myStatus = getMyApprovalStatus(doc)
                const timeInfo = getTimeRemaining(doc)
                const needsMyApproval = myStatus === 'pending' && doc.status === 'pending' && !timeInfo.expired

                return (
                  <div
                    key={doc.id}
                    onClick={() => setSelectedDoc(doc)}
                    className="card p-4 cursor-pointer hover:border-opacity-60 transition-colors"
                    style={{ opacity: timeInfo.expired ? 0.6 : 1 }}
                  >
                    {/* 제목 + 상태 배지 */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h3 className="font-medium line-clamp-1" style={{ color: 'var(--foreground)' }}>
                        {doc.title}
                      </h3>
                      {getStatusBadge(doc.status)}
                    </div>

                    {/* 승인 진행 바 */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span style={{ color: 'var(--foreground-muted)' }}>
                          {progress.approved}/{progress.required} 승인
                        </span>
                        {doc.status === 'pending' && (
                          <span style={{ color: 'var(--foreground-muted)' }}>
                            {timeInfo.text}
                          </span>
                        )}
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--glass-bg)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min((progress.approved / progress.required) * 100, 100)}%`,
                            background: doc.status === 'approved' ? 'var(--success)' : doc.status === 'rejected' ? 'var(--error)' : 'var(--accent-primary)',
                          }}
                        />
                      </div>
                    </div>

                    {/* 승인자 아바타 */}
                    <div className="flex items-center gap-1">
                      {doc.approvals?.slice(0, 5).map((approval, i) => (
                        <div
                          key={i}
                          className="w-6 h-6 rounded-full text-[10px] flex items-center justify-center font-medium"
                          style={{
                            background: approval.decision === 'approved'
                              ? 'var(--success)'
                              : approval.decision === 'rejected'
                              ? 'var(--error)'
                              : 'var(--glass-bg)',
                            color: approval.decision !== 'pending' ? 'white' : 'var(--foreground-muted)',
                          }}
                          title={approval.approver_email}
                        >
                          {approval.decision === 'approved' ? '✓' : approval.decision === 'rejected' ? '✗' : approval.approver_email[0].toUpperCase()}
                        </div>
                      ))}
                      {(doc.approvals?.length || 0) > 5 && (
                        <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                          +{doc.approvals!.length - 5}
                        </span>
                      )}
                    </div>

                    {/* 내 승인 필요 표시 */}
                    {needsMyApproval && (
                      <div
                        className="mt-3 py-2 text-xs text-center font-medium rounded-lg"
                        style={{ background: 'var(--accent-primary)', color: 'white' }}
                      >
                        승인 필요
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {/* Document Detail Modal - Mobile Bottom Sheet / Desktop Modal */}
      {selectedDoc && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          onClick={() => { setSelectedDoc(null); setApprovalComment(''); }}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          {/* Two-panel layout: File Preview (left) + Document Info (right) */}
          <div
            className="relative w-full h-[90vh] sm:h-auto sm:max-h-[90vh] sm:max-w-5xl sm:m-4 flex flex-col sm:flex-row rounded-t-2xl sm:rounded-2xl overflow-hidden"
            style={{ background: 'var(--card-bg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile drag handle */}
            <div className="w-10 h-1 rounded-full mx-auto mt-2 mb-1 sm:hidden" style={{ background: 'var(--glass-border)' }} />

            {/* Close button */}
            <button
              onClick={() => { setSelectedDoc(null); setApprovalComment(''); }}
              className="absolute top-3 sm:top-4 right-3 sm:right-4 z-10 p-2 rounded-full transition-colors"
              style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Left Panel: File Preview (takes most space) */}
            <div
              className="flex-[1] sm:flex-[2] flex items-center justify-center p-3 sm:p-4 md:p-8 min-h-[30vh] sm:min-h-[40vh] md:min-h-0"
              style={{ background: '#0a0a0a' }}
            >
              {selectedDoc.file ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  {/* File Preview - Always visible */}
                  {(() => {
                    const fileUrl = selectedDoc.file.url
                    const fileName = selectedDoc.file.name.toLowerCase()
                    const isVideo = fileName.endsWith('.mp4') || fileName.endsWith('.mov') || fileName.endsWith('.webm')
                    const isImage = fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') || fileName.endsWith('.png') || fileName.endsWith('.gif') || fileName.endsWith('.webp')

                    // Extract path from R2 URL for proxy
                    const getProxyUrl = (url: string) => {
                      try {
                        const urlObj = new URL(url)
                        const path = urlObj.pathname.substring(1) // Remove leading /
                        return `/api/image/${path}`
                      } catch {
                        return url
                      }
                    }

                    const proxyUrl = getProxyUrl(fileUrl)

                    if (isVideo) {
                      return (
                        <video
                          src={proxyUrl}
                          controls
                          className="max-w-full max-h-[25vh] sm:max-h-[60vh] md:max-h-[70vh] rounded-lg"
                          style={{ background: '#000' }}
                        />
                      )
                    }

                    if (isImage || selectedDoc.file.thumbnail_url) {
                      return (
                        <img
                          src={proxyUrl}
                          alt={selectedDoc.file.name}
                          className="max-w-full max-h-[25vh] sm:max-h-[60vh] md:max-h-[70vh] object-contain rounded-lg"
                          onError={(e) => {
                            // Fallback to thumbnail if main image fails
                            if (selectedDoc.file?.thumbnail_url) {
                              (e.target as HTMLImageElement).src = getProxyUrl(selectedDoc.file.thumbnail_url)
                            }
                          }}
                        />
                      )
                    }

                    // Non-image/video file
                    return (
                      <div className="text-center">
                        <div
                          className="w-24 h-24 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                        >
                          <svg className="w-12 h-12" style={{ color: 'var(--accent-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium" style={{ color: 'var(--foreground-muted)' }}>
                          {selectedDoc.file.name}
                        </p>
                      </div>
                    )
                  })()}
                </div>
              ) : (
                <div className="text-center">
                  <div
                    className="w-24 h-24 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                    style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                  >
                    <svg className="w-12 h-12" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>파일 없음</p>
                </div>
              )}
            </div>

            {/* Right Panel: Document Info */}
            <div
              className="flex-1 sm:flex-none sm:w-96 p-4 sm:p-6 overflow-y-auto max-h-[55vh] sm:max-h-[90vh] border-t sm:border-t-0 sm:border-l"
              style={{ borderColor: 'var(--glass-border)' }}
            >
              {/* Header with Status */}
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
                    {selectedDoc.title}
                  </h2>
                  {selectedDoc.file && (
                    <p className="text-xs truncate" style={{ color: 'var(--foreground-muted)' }}>
                      {selectedDoc.file.name}
                    </p>
                  )}
                </div>
                {getStatusBadge(selectedDoc.status)}
              </div>

              {/* Badges Row: Expiration + Blockchain */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {/* Expiration Badge */}
                {selectedDoc.status === 'pending' && (
                  (() => {
                    const timeInfo = getTimeRemaining(selectedDoc)
                    return (
                      <div
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
                        style={{
                          background: timeInfo.expired ? 'rgba(239, 68, 68, 0.15)' : timeInfo.hours < 24 ? 'rgba(234, 179, 8, 0.15)' : 'var(--glass-bg)',
                          color: timeInfo.expired ? 'var(--error)' : timeInfo.hours < 24 ? 'var(--warning)' : 'var(--foreground-muted)',
                        }}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {timeInfo.text}
                      </div>
                    )
                  })()
                )}

                {/* Blockchain Verification Badge */}
                {selectedDoc.file?.url && (
                  <BlockchainBadge fileUrl={selectedDoc.file.url} />
                )}
              </div>

              {/* Description */}
              {selectedDoc.description && (
                <div className="mb-4">
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--foreground-secondary)' }}>
                    {selectedDoc.description}
                  </p>
                </div>
              )}

              {/* Approval Progress Bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="font-medium" style={{ color: 'var(--foreground)' }}>승인 현황</span>
                  <span style={{ color: 'var(--accent-primary)' }}>
                    {getApprovalProgress(selectedDoc).approved} / {getApprovalProgress(selectedDoc).required}
                  </span>
                </div>
                <div className="progress-bar h-2">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${(getApprovalProgress(selectedDoc).approved / getApprovalProgress(selectedDoc).required) * 100}%` }}
                  />
                </div>
              </div>

              {/* Approvers List */}
              <div className="mb-4">
                <div className="space-y-2">
                  {selectedDoc.approvals?.map((approval) => (
                    <div
                      key={approval.id}
                      className="p-3 rounded-xl"
                      style={{ background: 'var(--glass-bg)' }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-8 h-8 rounded-full text-sm flex items-center justify-center font-medium"
                            style={{
                              background: approval.decision === 'approved'
                                ? 'rgba(34, 197, 94, 0.2)'
                                : approval.decision === 'rejected'
                                ? 'rgba(239, 68, 68, 0.2)'
                                : 'var(--background)',
                              color: approval.decision === 'approved'
                                ? 'var(--success)'
                                : approval.decision === 'rejected'
                                ? 'var(--error)'
                                : 'var(--foreground-muted)',
                              border: '1px solid var(--glass-border)',
                            }}
                          >
                            {approval.decision === 'approved' ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : approval.decision === 'rejected' ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            ) : (
                              approval.approver_email[0].toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm truncate" style={{ color: 'var(--foreground-secondary)' }}>
                              {approval.approver_email}
                            </p>
                          </div>
                        </div>
                        <span
                          className="text-xs font-medium shrink-0"
                          style={{
                            color: approval.decision === 'approved'
                              ? 'var(--success)'
                              : approval.decision === 'rejected'
                              ? 'var(--error)'
                              : 'var(--foreground-muted)',
                          }}
                        >
                          {approval.decision === 'approved' ? '승인됨' : approval.decision === 'rejected' ? '거절됨' : '대기중'}
                        </span>
                      </div>
                      {/* Comment */}
                      {approval.comment && (
                        <div
                          className="mt-2 text-xs p-2.5 rounded-lg italic"
                          style={{ background: 'var(--background)', color: 'var(--foreground-muted)' }}
                        >
                          "{approval.comment}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* On-chain Signing Section */}
              {selectedDoc.file?.url && (
                <OnChainSigningSection
                  fileUrl={selectedDoc.file.url}
                  onSignSuccess={() => fetchDocuments()}
                />
              )}

              {/* Comment Input for Approvers - 생성자도 승인자면 표시 */}
              {selectedDoc.status === 'pending' &&
               getMyApprovalStatus(selectedDoc) === 'pending' &&
               !isDocumentExpired(selectedDoc) && (
                <div className="mb-4">
                  <label className="block text-xs font-medium mb-2" style={{ color: 'var(--foreground-muted)' }}>
                    코멘트 (선택사항)
                  </label>
                  <textarea
                    value={approvalComment}
                    onChange={(e) => setApprovalComment(e.target.value)}
                    placeholder="승인 또는 거절 사유를 입력하세요..."
                    rows={2}
                    className="input w-full resize-none text-sm"
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-3 pt-2">
                {/* 만료된 문서 */}
                {selectedDoc.status === 'pending' && isDocumentExpired(selectedDoc) && (
                  <p className="text-sm text-center py-2" style={{ color: 'var(--error)' }}>
                    만료된 문서입니다
                  </p>
                )}

                {/* 승인 버튼 영역 - 승인 대기 상태일 때만 */}
                {selectedDoc.status === 'pending' &&
                 getMyApprovalStatus(selectedDoc) === 'pending' &&
                 !isDocumentExpired(selectedDoc) && (
                  <>
                    {/* 지갑 미연결 시 안내 */}
                    {!user?.wallet_address ? (
                      <button
                        onClick={() => router.push('/settings')}
                        className="w-full btn py-3 text-sm"
                      >
                        설정에서 지갑 연결하기
                      </button>
                    ) : !isConnected ? (
                      <button
                        onClick={() => openConnectModal?.()}
                        className="w-full btn btn-primary py-3 text-sm"
                      >
                        지갑 연결하고 승인하기
                      </button>
                    ) : address?.toLowerCase() !== user.wallet_address.toLowerCase() ? (
                      <p className="text-xs text-center py-2" style={{ color: 'var(--foreground-muted)' }}>
                        등록된 지갑({user.wallet_address.slice(0, 6)}...)으로 연결해주세요
                      </p>
                    ) : (
                      /* 승인/거절 버튼 */
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => handleDecision(selectedDoc.id, 'rejected')}
                          disabled={processing}
                          className="btn py-3 text-sm"
                        >
                          {processing ? '처리중...' : '거절'}
                        </button>
                        <button
                          onClick={() => handleDecision(selectedDoc.id, 'approved')}
                          disabled={processing}
                          className="btn btn-primary py-3 text-sm"
                        >
                          {processing ? '처리중...' : '승인'}
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* 삭제 버튼 - 소유자만, 미승인 상태에서만 */}
                {selectedDoc.owner_id === user?.id && selectedDoc.status !== 'approved' && (
                  <button
                    onClick={() => handleDelete(selectedDoc.id)}
                    className="w-full text-sm py-2"
                    style={{ color: 'var(--foreground-muted)' }}
                  >
                    문서 삭제
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && user && (
        <CreateVaultModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            fetchDocuments()
            setShowCreateModal(false)
          }}
          userEmail={user.email}
          userId={user.id}
        />
      )}

      {/* Wallet Connection Prompt Modal */}
      {showWalletPrompt && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setShowWalletPrompt(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 sm:p-6"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile drag handle */}
            <div className="w-10 h-1 rounded-full mx-auto mb-4 sm:hidden" style={{ background: 'var(--glass-border)' }} />

            <div className="text-center">
              <div
                className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--accent-gradient-subtle)' }}
              >
                <svg className="w-7 h-7 sm:w-8 sm:h-8" style={{ color: 'var(--accent-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-base sm:text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
                지갑 연결 필요
              </h3>
              <p className="text-sm mb-6" style={{ color: 'var(--foreground-muted)' }}>
                문서 승인/거절을 위해서는 블록체인 서명이 필요합니다.<br />
                먼저 설정 페이지에서 지갑을 계정에 연결해주세요.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => setShowWalletPrompt(false)}
                  className="btn flex-1 py-3 sm:py-2 order-2 sm:order-1"
                >
                  취소
                </button>
                <button
                  onClick={() => router.push('/settings')}
                  className="btn btn-primary flex-1 py-3 sm:py-2 flex items-center justify-center gap-2 order-1 sm:order-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  설정으로 이동
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 문서 생성 모달
function CreateVaultModal({
  onClose,
  onCreated,
  userEmail,
  userId,
}: {
  onClose: () => void
  onCreated: () => void
  userEmail: string
  userId: string
}) {
  const { showToast } = useToast()
  const [files, setFiles] = useState<{ id: string; name: string; url: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  // Web3 hooks
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { register, txHash, isPending: isRegistering, isConfirming, isSuccess: isRegisterSuccess } = useRegisterDocument()

  const [selectedFileId, setSelectedFileId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [approverEmails, setApproverEmails] = useState<string[]>([])
  const [newApproverEmail, setNewApproverEmail] = useState('')
  const [requiredApprovals, setRequiredApprovals] = useState(1)
  const [restrictDomain, setRestrictDomain] = useState(true)
  const [registerOnChain, setRegisterOnChain] = useState(false)
  const [approverWallets, setApproverWallets] = useState<string[]>([])

  const userDomain = userEmail.split('@')[1] || ''

  // 내 파일 목록 조회
  useEffect(() => {
    const fetchFiles = async () => {
      try {
        const { data, error } = await supabase
          .from('photos')
          .select('id, name, url')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })

        if (error) throw error
        setFiles(data || [])
      } catch {
        showToast('파일 목록을 불러오는데 실패했습니다.', 'error')
      } finally {
        setLoading(false)
      }
    }
    fetchFiles()
  }, [userId])

  const addApprover = () => {
    const email = newApproverEmail.trim()
    if (!email) return
    if (email.toLowerCase() === userEmail.toLowerCase()) {
      return // 본인은 추가 불가
    }
    if (approverEmails.some(e => e.toLowerCase() === email.toLowerCase())) {
      return // 중복 불가
    }
    if (approverEmails.length >= 9) {
      return // 최대 10명 (본인 포함)
    }
    setApproverEmails([...approverEmails, email])
    setNewApproverEmail('')
  }

  const removeApprover = (index: number) => {
    setApproverEmails(approverEmails.filter((_, i) => i !== index))
  }

  // 모든 승인자 (생성자 포함)
  const allApprovers = [userEmail, ...approverEmails]
  const validApprovers = allApprovers

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedFileId || !title) {
      showToast('필수 항목을 입력해주세요.', 'error')
      return
    }

    // 블록체인 등록 선택 시 지갑 연결 확인
    if (registerOnChain && !isConnected) {
      showToast('블록체인 등록을 위해 지갑을 연결해주세요.', 'error')
      return
    }

    setCreating(true)
    try {
      let fileHash: string | undefined
      let txHash: string | undefined

      // 블록체인 등록 시 - 먼저 블록체인에 등록 (실패하면 문서 생성 안 함)
      if (registerOnChain) {
        const selectedFile = files.find(f => f.id === selectedFileId)
        if (selectedFile?.url) {
          try {
            // 프록시 URL로 변환하여 해시 계산
            const urlObj = new URL(selectedFile.url)
            const proxyUrl = `/api/image/${urlObj.pathname.substring(1)}`
            fileHash = await computeHashFromUrl(proxyUrl)
            showToast('파일 해시 계산 완료', 'success')
          } catch (hashError) {
            console.error('Hash computation error:', hashError)
            showToast('파일 해시 계산에 실패했습니다.', 'error')
            setCreating(false)
            return
          }

          // 블록체인에 먼저 등록
          try {
            showToast('블록체인에 등록 중... 지갑에서 트랜잭션을 승인해주세요.', 'info')

            // 유효한 지갑 주소 필터링 (0x로 시작하고 42자)
            const validWallets = approverWallets
              .map(w => w.trim())
              .filter(w => /^0x[a-fA-F0-9]{40}$/.test(w)) as `0x${string}`[]

            // 생성자 지갑 주소 포함
            const allApproverWallets = address ? [address, ...validWallets] : validWallets

            // 온체인 승인자가 있으면 M-of-N 설정, 없으면 해시만 등록
            const onChainRequired = allApproverWallets.length > 0
              ? Math.min(requiredApprovals, allApproverWallets.length)
              : 0

            txHash = await register({
              fileHash,
              metaData: JSON.stringify({
                title,
                createdAt: new Date().toISOString(),
                approverCount: allApproverWallets.length,
                requiredApprovals: onChainRequired,
              }),
              approvers: allApproverWallets,
              requiredApprovals: onChainRequired,
              expiresInSeconds: 365 * 24 * 60 * 60, // 1년
            })

            showToast(`블록체인 등록 완료! TX: ${txHash.slice(0, 10)}...`, 'success')
          } catch (chainError) {
            console.error('Blockchain registration error:', chainError)
            if (chainError instanceof Error && chainError.message.includes('User rejected')) {
              showToast('트랜잭션이 취소되었습니다. 문서가 생성되지 않았습니다.', 'error')
            } else {
              showToast('블록체인 등록에 실패했습니다. 문서가 생성되지 않았습니다.', 'error')
            }
            setCreating(false)
            return // 블록체인 등록 실패 시 문서 생성 중단
          }
        }
      }

      // 오프체인 문서 생성 (블록체인 등록 성공 후 또는 블록체인 미사용 시)
      const res = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: selectedFileId,
          title,
          description,
          requiredApprovals: Math.min(requiredApprovals, validApprovers.length),
          approverEmails: validApprovers,
          restrictDomain,
          registerOnChain,
          fileHash,
          txHash,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '생성 실패')
      }

      showToast('문서가 생성되었습니다.', 'success')
      onCreated()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '생성에 실패했습니다.', 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="w-10 h-1 rounded-full mx-auto mb-4 sm:hidden" style={{ background: 'var(--glass-border)' }} />

        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: 'var(--foreground-muted)' }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-base sm:text-lg font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
          새 Vault 문서
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* File Selection */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground-secondary)' }}>
              파일 선택 *
            </label>
            {loading ? (
              <div className="h-10 rounded-lg animate-pulse" style={{ background: 'var(--glass-bg)' }} />
            ) : (
              <select
                value={selectedFileId}
                onChange={(e) => setSelectedFileId(e.target.value)}
                required
                className="input w-full"
              >
                <option value="">파일을 선택하세요</option>
                {files.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground-secondary)' }}>
              제목 * <span className="font-normal" style={{ color: 'var(--foreground-muted)' }}>({title.length}/100)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 100))}
              required
              maxLength={100}
              placeholder="문서 제목"
              className="input w-full"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground-secondary)' }}>
              설명 <span className="font-normal" style={{ color: 'var(--foreground-muted)' }}>({description.length}/500)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              maxLength={500}
              placeholder="문서에 대한 설명 (선택사항)"
              rows={2}
              className="input w-full resize-none"
            />
          </div>

          {/* Approvers */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground-secondary)' }}>
              승인자
            </label>

            {/* 승인자 목록 (생성자 포함) */}
            <div className="space-y-2 mb-3">
              {/* 생성자 (나) - 항상 포함 */}
              <div
                className="flex items-center gap-3 p-2.5 rounded-lg"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
                  style={{ background: 'var(--accent-gradient)', color: 'white' }}
                >
                  {userEmail[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                    {userEmail}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>생성자 (나)</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-gradient-subtle)', color: 'var(--accent-primary)' }}>
                  필수
                </span>
              </div>

              {/* 추가된 승인자들 */}
              {approverEmails.map((email, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-2.5 rounded-lg"
                  style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
                    style={{ background: 'var(--background)', color: 'var(--foreground-muted)', border: '1px solid var(--glass-border)' }}
                  >
                    {email[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--foreground-secondary)' }}>
                      {email}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeApprover(index)}
                    className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ color: 'var(--foreground-muted)' }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {/* 승인자 추가 입력 */}
            <div className="flex gap-2">
              <input
                type="email"
                value={newApproverEmail}
                onChange={(e) => setNewApproverEmail(e.target.value)}
                placeholder={restrictDomain ? `추가할 승인자 이메일 (@${userDomain})` : '추가할 승인자 이메일'}
                className="input flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addApprover()
                  }
                }}
              />
              <button
                type="button"
                onClick={addApprover}
                disabled={!newApproverEmail.trim()}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-opacity"
                style={{
                  background: 'var(--glass-bg)',
                  color: 'var(--foreground-secondary)',
                  border: '1px solid var(--glass-border)',
                  opacity: newApproverEmail.trim() ? 1 : 0.5,
                }}
              >
                추가
              </button>
            </div>
          </div>

          {/* Required Approvals */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground-secondary)' }}>
              필요 승인 수
            </label>
            <select
              value={requiredApprovals}
              onChange={(e) => setRequiredApprovals(Number(e.target.value))}
              className="input w-full"
            >
              {Array.from({ length: validApprovers.length }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {validApprovers.length}명 중 {n}명 승인 필요
                </option>
              ))}
            </select>
            <p className="text-xs mt-1" style={{ color: 'var(--foreground-muted)' }}>
              M-of-N 다중서명: 총 {validApprovers.length}명 중 {requiredApprovals}명의 승인이 필요합니다.
            </p>
          </div>

          {/* Domain Restriction */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="restrictDomain"
              checked={restrictDomain}
              onChange={(e) => setRestrictDomain(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <label htmlFor="restrictDomain" className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
              같은 조직(@{userDomain})만 승인자로 허용
            </label>
          </div>

          {/* Blockchain Registration Option */}
          <div
            className="p-4 rounded-xl"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                id="registerOnChain"
                checked={registerOnChain}
                onChange={(e) => setRegisterOnChain(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="registerOnChain" className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                블록체인에 등록 (선택사항)
              </label>
            </div>
            <p className="text-xs ml-6" style={{ color: 'var(--foreground-muted)' }}>
              문서 해시를 블록체인에 기록하여 위변조 방지 및 검증이 가능합니다.
            </p>

            {registerOnChain && (
              <div className="mt-4 space-y-3">
                {/* Wallet Connection Status */}
                {!isConnected ? (
                  <div
                    className="p-3 rounded-lg flex items-center justify-between"
                    style={{ background: 'rgba(234, 179, 8, 0.1)' }}
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4" style={{ color: 'var(--warning)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="text-sm" style={{ color: 'var(--warning)' }}>
                        지갑 연결이 필요합니다
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openConnectModal?.()}
                      className="text-sm px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: 'var(--accent-gradient)', color: 'white' }}
                    >
                      연결
                    </button>
                  </div>
                ) : (
                  <div
                    className="p-3 rounded-lg flex items-center gap-2"
                    style={{ background: 'rgba(34, 197, 94, 0.1)' }}
                  >
                    <svg className="w-4 h-4" style={{ color: 'var(--success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm" style={{ color: 'var(--success)' }}>
                      지갑 연결됨: {address?.slice(0, 6)}...{address?.slice(-4)}
                    </span>
                  </div>
                )}

                {/* On-chain Approvers */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium" style={{ color: 'var(--foreground-secondary)' }}>
                    온체인 승인자 지갑 주소 (선택)
                  </label>
                  <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    지갑 주소를 입력하면 해당 주소만 온체인에서 승인 가능합니다. 비워두면 해시만 등록됩니다.
                  </p>

                  {/* Creator wallet - auto included */}
                  <div
                    className="flex items-center gap-2 p-2 rounded-lg text-xs"
                    style={{ background: 'var(--background)', border: '1px solid var(--glass-border)' }}
                  >
                    <span className="font-mono" style={{ color: 'var(--foreground-secondary)' }}>
                      {address?.slice(0, 10)}...{address?.slice(-8)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--accent-gradient-subtle)', color: 'var(--accent-primary)' }}>
                      나
                    </span>
                  </div>

                  {/* Additional approver wallets */}
                  {approverWallets.map((wallet, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={wallet}
                        onChange={(e) => {
                          const updated = [...approverWallets]
                          updated[index] = e.target.value
                          setApproverWallets(updated)
                        }}
                        placeholder="0x..."
                        className="input flex-1 text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setApproverWallets(approverWallets.filter((_, i) => i !== index))}
                        className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                        style={{ color: 'var(--foreground-muted)' }}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}

                  {approverWallets.length < 9 && (
                    <button
                      type="button"
                      onClick={() => setApproverWallets([...approverWallets, ''])}
                      className="text-xs px-3 py-1.5 rounded-lg"
                      style={{ background: 'var(--glass-bg)', color: 'var(--accent-primary)', border: '1px solid var(--glass-border)' }}
                    >
                      + 지갑 주소 추가
                    </button>
                  )}

                  {(approverWallets.filter(w => w.trim()).length > 0 || address) && (
                    <div className="pt-2">
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--foreground-secondary)' }}>
                        온체인 필요 승인 수
                      </label>
                      <select
                        value={requiredApprovals}
                        onChange={(e) => setRequiredApprovals(Number(e.target.value))}
                        className="input w-full text-sm"
                      >
                        {Array.from({ length: approverWallets.filter(w => w.trim()).length + 1 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {approverWallets.filter(w => w.trim()).length + 1}명 중 {n}명
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn flex-1">
              취소
            </button>
            <button type="submit" disabled={creating} className="btn btn-primary flex-1">
              {creating ? '생성 중...' : '생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// 온체인 서명 섹션 컴포넌트
function OnChainSigningSection({
  fileUrl,
  onSignSuccess,
}: {
  fileUrl: string
  onSignSuccess?: () => void
}) {
  const { showToast } = useToast()
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()

  const [fileHash, setFileHash] = useState<string | null>(null)
  const [computingHash, setComputingHash] = useState(false)
  const [hashError, setHashError] = useState(false)
  const [loadingTimeout, setLoadingTimeout] = useState(false)

  // 해시 계산
  useEffect(() => {
    const computeHash = async () => {
      if (!fileUrl) return
      setComputingHash(true)
      setHashError(false)
      try {
        const urlObj = new URL(fileUrl)
        const proxyUrl = `/api/image/${urlObj.pathname.substring(1)}`
        const hash = await computeHashFromUrl(proxyUrl)
        setFileHash(hash)
      } catch (error) {
        console.error('Failed to compute hash:', error)
        setHashError(true)
      } finally {
        setComputingHash(false)
      }
    }
    computeHash()
  }, [fileUrl])

  // 온체인 검증
  const { exists, documentId, isLoading: verifyLoading } = useVerifyHash(fileHash || undefined)

  // 로딩 타임아웃 (5초)
  useEffect(() => {
    if (computingHash || verifyLoading) {
      const timer = setTimeout(() => setLoadingTimeout(true), 5000)
      return () => clearTimeout(timer)
    }
    setLoadingTimeout(false)
  }, [computingHash, verifyLoading])

  // 온체인 문서 정보
  const { document: chainDoc, isLoading: docLoading, refetch: refetchDoc } = useDocument(
    exists && documentId && documentId > BigInt(0) ? documentId : undefined
  )

  // 현재 사용자가 이미 승인했는지 확인
  const { hasApproved: alreadyApproved, isLoading: approvalCheckLoading, refetch: refetchApproval } = useHasApproved(
    exists && documentId && documentId > BigInt(0) ? documentId : undefined,
    address
  )

  // 서명 훅
  const { sign, txHash, isPending, isConfirming, isSuccess, error: signError } = useSignDocument()

  // 서명 성공 시 refetch
  useEffect(() => {
    if (isSuccess) {
      showToast('온체인 서명 완료!', 'success')
      refetchDoc()
      refetchApproval()
      onSignSuccess?.()
    }
  }, [isSuccess])

  // 서명 실행
  const handleSign = () => {
    if (!isConnected) {
      openConnectModal?.()
      return
    }
    if (!documentId || documentId === BigInt(0)) {
      showToast('문서가 블록체인에 등록되지 않았습니다.', 'error')
      return
    }
    sign(documentId, '')
  }

  // 해시 계산 실패
  if (hashError) {
    return null
  }

  // 로딩 중 (타임아웃 시 스킵)
  if ((computingHash || verifyLoading) && !loadingTimeout) {
    return (
      <p className="text-xs py-2" style={{ color: 'var(--foreground-muted)' }}>
        블록체인 확인 중...
      </p>
    )
  }

  // 블록체인에 없거나 타임아웃
  if (!exists || loadingTimeout) {
    return null
  }

  // 블록체인 문서 정보 로딩 중
  if (docLoading) {
    return (
      <p className="text-xs py-2" style={{ color: 'var(--foreground-muted)' }}>
        온체인 정보 로딩...
      </p>
    )
  }

  // 문서 정보가 없음
  if (!chainDoc) {
    return null
  }

  const {
    approvers,
    approvalCount,
    requiredApprovals,
    isFinalized,
  } = chainDoc

  // 승인자 목록이 없으면 (해시만 등록된 경우) 표시 안 함
  if (!approvers || approvers.length === 0) {
    return null
  }

  // 현재 사용자가 승인자인지 확인
  const isApprover = approvers.some(
    (a: `0x${string}`) => a.toLowerCase() === address?.toLowerCase()
  )

  return (
    <div
      className="p-4 rounded-xl space-y-3"
      style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
    >
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
          온체인 다중서명
        </span>
        {isFinalized && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(34, 197, 94, 0.15)', color: 'var(--success)' }}>
            완료됨
          </span>
        )}
      </div>

      {/* 온체인 승인 진행률 */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span style={{ color: 'var(--foreground-muted)' }}>온체인 승인</span>
          <span style={{ color: 'var(--accent-primary)' }}>
            {Number(approvalCount)} / {Number(requiredApprovals)}
          </span>
        </div>
        <div className="progress-bar h-1.5">
          <div
            className="progress-bar-fill"
            style={{ width: `${(Number(approvalCount) / Number(requiredApprovals)) * 100}%` }}
          />
        </div>
      </div>

      {/* 승인자 목록 */}
      <div className="space-y-1.5">
        <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
          온체인 승인자 ({approvers.length}명)
        </span>
        {approvers.map((approver: `0x${string}`, i: number) => {
          const isMe = approver.toLowerCase() === address?.toLowerCase()
          return (
            <div
              key={i}
              className="flex items-center gap-2 p-2 rounded-lg text-xs"
              style={{ background: 'var(--background)' }}
            >
              <span className="font-mono flex-1 truncate" style={{ color: 'var(--foreground-secondary)' }}>
                {approver.slice(0, 8)}...{approver.slice(-6)}
              </span>
              {isMe && (
                <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--accent-gradient-subtle)', color: 'var(--accent-primary)' }}>
                  나
                </span>
              )}
              {/* 승인 상태는 개별 확인이 필요하지만 일단 간단히 표시 */}
            </div>
          )
        })}
      </div>

      {/* 서명 버튼 */}
      {isApprover && !isFinalized && (
        <div className="pt-2">
          {approvalCheckLoading ? (
            <div className="text-xs text-center py-2" style={{ color: 'var(--foreground-muted)' }}>
              승인 상태 확인 중...
            </div>
          ) : alreadyApproved ? (
            <div
              className="flex items-center justify-center gap-2 py-2 rounded-lg text-sm"
              style={{ background: 'rgba(34, 197, 94, 0.1)', color: 'var(--success)' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              온체인 서명 완료
            </div>
          ) : (
            <button
              onClick={handleSign}
              disabled={isPending || isConfirming || !isConnected}
              className="w-full btn flex items-center justify-center gap-2"
              style={{
                background: 'var(--accent-gradient)',
                color: 'white',
                opacity: isPending || isConfirming ? 0.7 : 1,
              }}
            >
              {isPending || isConfirming ? (
                <>
                  <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'white', borderTopColor: 'transparent' }} />
                  {isPending ? '서명 요청 중...' : '확인 중...'}
                </>
              ) : !isConnected ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  지갑 연결 필요
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  온체인 서명
                </>
              )}
            </button>
          )}

          {signError && (
            <p className="text-xs mt-2 text-center" style={{ color: 'var(--error)' }}>
              {signError.message?.includes('User rejected') ? '서명이 취소되었습니다.' : '서명 실패'}
            </p>
          )}

          {txHash && (
            <p className="text-xs mt-2 text-center truncate" style={{ color: 'var(--foreground-muted)' }}>
              TX: {txHash.slice(0, 10)}...{txHash.slice(-8)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
