'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { useToast } from '@/components/Toast'
import Sidebar from '@/components/Sidebar'
import BlockchainBadge from '@/components/BlockchainBadge'
import { supabase } from '@/lib/supabase'
import { VaultDocument, VaultApproval, getApprovalProgress, getTimeRemaining, isDocumentExpired } from '@/lib/vault'
import { useAccount, useSignMessage } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useSignDocument, useVerifyHash, useRegisterDocument } from '@/lib/web3'
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

  if (userLoading || loading) {
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
          className="h-[65px] px-4 flex items-center justify-between border-b sticky top-0 z-30"
          style={{ background: 'var(--background)', borderColor: 'var(--glass-border)' }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg xl:hidden hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <h1 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Vault</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn btn-primary flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">새 문서</span>
            </button>
          </div>
        </header>

        {/* Tabs */}
        <div className="px-4 pt-4">
          <div className="flex gap-2 border-b" style={{ borderColor: 'var(--glass-border)' }}>
            <button
              onClick={() => setActiveTab('owned')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
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
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'pending'
                  ? 'border-current'
                  : 'border-transparent hover:text-opacity-80'
              }`}
              style={{ color: activeTab === 'pending' ? 'var(--accent-primary)' : 'var(--foreground-muted)' }}
            >
              승인 대기
              {documents.filter(d => d.owner_id !== user?.id && d.status === 'pending').length > 0 && (
                <span
                  className="ml-2 px-1.5 py-0.5 rounded-full text-xs"
                  style={{ background: 'var(--error)', color: 'white' }}
                >
                  {documents.filter(d => d.owner_id !== user?.id && d.status === 'pending').length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Document List */}
        <div className="p-4">
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredDocs.map((doc) => {
                const progress = getApprovalProgress(doc)
                const myStatus = getMyApprovalStatus(doc)
                const timeInfo = getTimeRemaining(doc)

                return (
                  <div
                    key={doc.id}
                    onClick={() => setSelectedDoc(doc)}
                    className="card p-4 cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium truncate flex-1" style={{ color: 'var(--foreground)' }}>
                        {doc.title}
                      </h3>
                      {getStatusBadge(doc.status)}
                    </div>

                    {/* Expiration for pending docs */}
                    {doc.status === 'pending' && (
                      <div className="mb-3">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            background: timeInfo.expired ? 'rgba(239, 68, 68, 0.15)' : timeInfo.hours < 24 ? 'rgba(234, 179, 8, 0.15)' : 'var(--glass-bg)',
                            color: timeInfo.expired ? 'var(--error)' : timeInfo.hours < 24 ? 'var(--warning)' : 'var(--foreground-muted)',
                          }}
                        >
                          {timeInfo.text}
                        </span>
                      </div>
                    )}

                    {doc.description && (
                      <p className="text-sm mb-3 line-clamp-2" style={{ color: 'var(--foreground-muted)' }}>
                        {doc.description}
                      </p>
                    )}

                    {/* Progress */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span style={{ color: 'var(--foreground-muted)' }}>승인 진행</span>
                        <span style={{ color: 'var(--foreground-secondary)' }}>
                          {progress.approved}/{progress.required}
                        </span>
                      </div>
                      <div className="progress-bar">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${(progress.approved / progress.required) * 100}%` }}
                        />
                      </div>
                    </div>

                    {/* Approvers */}
                    <div className="flex items-center gap-1.5">
                      {doc.approvals?.slice(0, 3).map((approval, i) => (
                        <div
                          key={i}
                          className="w-6 h-6 rounded-full text-xs flex items-center justify-center font-medium"
                          style={{
                            background: approval.decision === 'approved'
                              ? 'rgba(34, 197, 94, 0.2)'
                              : approval.decision === 'rejected'
                              ? 'rgba(239, 68, 68, 0.2)'
                              : 'var(--glass-bg)',
                            color: approval.decision === 'approved'
                              ? 'var(--success)'
                              : approval.decision === 'rejected'
                              ? 'var(--error)'
                              : 'var(--foreground-muted)',
                            border: '1px solid var(--glass-border)',
                          }}
                          title={`${approval.approver_email} - ${approval.decision}`}
                        >
                          {approval.approver_email[0].toUpperCase()}
                        </div>
                      ))}
                      {(doc.approvals?.length || 0) > 3 && (
                        <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                          +{doc.approvals!.length - 3}
                        </span>
                      )}
                    </div>

                    {/* My status indicator for pending tab */}
                    {activeTab === 'pending' && myStatus === 'pending' && doc.status === 'pending' && (
                      <div
                        className="mt-3 py-1.5 px-2 rounded text-xs text-center font-medium"
                        style={{ background: 'var(--accent-gradient-subtle)', color: 'var(--accent-primary)' }}
                      >
                        내 승인이 필요합니다
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {/* Document Detail Modal - Redesigned for Better UX */}
      {selectedDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => { setSelectedDoc(null); setApprovalComment(''); }}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          {/* Two-panel layout: File Preview (left) + Document Info (right) */}
          <div
            className="relative w-full h-full md:h-auto md:max-h-[90vh] md:max-w-5xl md:m-4 flex flex-col md:flex-row md:rounded-2xl overflow-hidden"
            style={{ background: 'var(--card-bg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => { setSelectedDoc(null); setApprovalComment(''); }}
              className="absolute top-4 right-4 z-10 p-2 rounded-full transition-colors"
              style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Left Panel: File Preview (takes most space) */}
            <div
              className="flex-1 md:flex-[2] flex items-center justify-center p-4 md:p-8 min-h-[40vh] md:min-h-0"
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
                          className="max-w-full max-h-[60vh] md:max-h-[70vh] rounded-lg"
                          style={{ background: '#000' }}
                        />
                      )
                    }

                    if (isImage || selectedDoc.file.thumbnail_url) {
                      return (
                        <img
                          src={proxyUrl}
                          alt={selectedDoc.file.name}
                          className="max-w-full max-h-[60vh] md:max-h-[70vh] object-contain rounded-lg"
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
              className="md:flex-1 md:w-96 p-6 overflow-y-auto max-h-[50vh] md:max-h-[90vh]"
              style={{ borderLeft: '1px solid var(--glass-border)' }}
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

              {/* Comment Input for Approvers */}
              {selectedDoc.owner_id !== user?.id &&
               selectedDoc.status === 'pending' &&
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
              <div className="flex gap-2 pt-2">
                {/* Owner Actions */}
                {selectedDoc.owner_id === user?.id && (
                  <button
                    onClick={() => handleDelete(selectedDoc.id)}
                    className="btn flex-1 flex items-center justify-center gap-2"
                    style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)' }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    문서 삭제
                  </button>
                )}

                {/* Approver Actions */}
                {selectedDoc.owner_id !== user?.id &&
                 selectedDoc.status === 'pending' &&
                 getMyApprovalStatus(selectedDoc) === 'pending' && (
                  isDocumentExpired(selectedDoc) ? (
                    <div
                      className="flex-1 py-3 text-center text-sm rounded-xl font-medium"
                      style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)' }}
                    >
                      만료된 문서입니다
                    </div>
                  ) : (
                    <div className="flex-1 space-y-2">
                      {/* Wallet Status Indicator */}
                      {!user?.wallet_address ? (
                        <div
                          className="p-2.5 rounded-lg text-xs flex items-center gap-2"
                          style={{ background: 'rgba(234, 179, 8, 0.1)', color: 'var(--warning)' }}
                        >
                          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <span>승인하려면 먼저 설정에서 지갑을 연결하세요</span>
                        </div>
                      ) : !isConnected ? (
                        <div
                          className="p-2.5 rounded-lg text-xs flex items-center gap-2"
                          style={{ background: 'var(--glass-bg)', color: 'var(--foreground-muted)' }}
                        >
                          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>지갑 연결 후 서명이 필요합니다</span>
                        </div>
                      ) : address?.toLowerCase() !== user.wallet_address.toLowerCase() ? (
                        <div
                          className="p-2.5 rounded-lg text-xs flex items-center gap-2"
                          style={{ background: 'rgba(234, 179, 8, 0.1)', color: 'var(--warning)' }}
                        >
                          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <span>등록된 지갑으로 연결하세요 ({user.wallet_address.slice(0, 6)}...{user.wallet_address.slice(-4)})</span>
                        </div>
                      ) : (
                        <div
                          className="p-2.5 rounded-lg text-xs flex items-center gap-2"
                          style={{ background: 'rgba(34, 197, 94, 0.1)', color: 'var(--success)' }}
                        >
                          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>지갑 연결됨 ({address?.slice(0, 6)}...{address?.slice(-4)})</span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDecision(selectedDoc.id, 'rejected')}
                          disabled={processing}
                          className="btn flex-1 flex items-center justify-center gap-2"
                          style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)' }}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          {processing ? '처리중...' : '거절'}
                        </button>
                        <button
                          onClick={() => handleDecision(selectedDoc.id, 'approved')}
                          disabled={processing}
                          className="btn btn-primary flex-1 flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          {processing ? '처리중...' : '승인'}
                        </button>
                      </div>
                    </div>
                  )
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
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          onClick={() => setShowWalletPrompt(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm rounded-2xl p-6"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <div
                className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--accent-gradient-subtle)' }}
              >
                <svg className="w-8 h-8" style={{ color: 'var(--accent-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
                지갑 연결 필요
              </h3>
              <p className="text-sm mb-6" style={{ color: 'var(--foreground-muted)' }}>
                문서 승인/거절을 위해서는 블록체인 서명이 필요합니다.<br />
                먼저 설정 페이지에서 지갑을 계정에 연결해주세요.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowWalletPrompt(false)}
                  className="btn flex-1"
                >
                  취소
                </button>
                <button
                  onClick={() => router.push('/settings')}
                  className="btn btn-primary flex-1 flex items-center justify-center gap-2"
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

            txHash = await register({
              fileHash,
              metaData: JSON.stringify({
                title,
                createdAt: new Date().toISOString(),
              }),
              approvers: [],
              requiredApprovals: 0,
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: 'var(--foreground-muted)' }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
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

                {/* Approver Wallets Info */}
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                  * 블록체인 등록 시 승인자들의 지갑 주소가 필요합니다. 현재는 오프체인 승인만 기록됩니다.
                </p>
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
