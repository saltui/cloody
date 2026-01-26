import { supabase } from './supabase'

export interface VaultDocument {
  id: string
  file_id: string
  owner_id: string
  title: string
  description: string | null
  required_approvals: number
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  allowed_domain: string | null
  expires_at: string | null
  file_hash: string | null
  blockchain_tx_hash: string | null
  created_at: string
  // Joined data
  file?: {
    id: string
    name: string
    url: string
    thumbnail_url: string | null
  }
  owner?: {
    email: string
    display_name: string | null
  }
  approvals?: VaultApproval[]
}

export interface VaultApproval {
  id: string
  document_id: string
  approver_email: string
  decision: 'pending' | 'approved' | 'rejected'
  comment: string | null
  ip_address: string | null
  user_agent: string | null
  wallet_address: string | null
  wallet_signature: string | null
  decided_at: string | null
  created_at: string
}

// 이메일에서 도메인 추출
export function getEmailDomain(email: string): string {
  return email.split('@')[1] || ''
}

// 같은 도메인인지 확인
export function isSameDomain(email1: string, email2: string): boolean {
  return getEmailDomain(email1).toLowerCase() === getEmailDomain(email2).toLowerCase()
}

// 기본 만료 기한 (3일)
const DEFAULT_EXPIRY_DAYS = 3

// Vault 문서 생성
export async function createVaultDocument(params: {
  fileId: string
  ownerId: string
  title: string
  description?: string
  requiredApprovals: number
  approverEmails: string[]
  allowedDomain?: string
  expiresInDays?: number
  fileHash?: string
}): Promise<{ document: VaultDocument | null; error: string | null }> {
  const { fileId, ownerId, title, description, requiredApprovals, approverEmails, allowedDomain, expiresInDays = DEFAULT_EXPIRY_DAYS, fileHash } = params

  // 최소 승인 수 검증
  if (requiredApprovals < 1 || requiredApprovals > approverEmails.length) {
    return { document: null, error: '필요 승인 수가 올바르지 않습니다.' }
  }

  // 만료일 계산 (기본 3일)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + expiresInDays)

  // 문서 생성 (file_hash는 DB 컬럼이 있을 때만 포함)
  const insertData: Record<string, unknown> = {
    file_id: fileId,
    owner_id: ownerId,
    title,
    description: description || null,
    required_approvals: requiredApprovals,
    allowed_domain: allowedDomain || null,
    expires_at: expiresAt.toISOString(),
  }

  // file_hash 컬럼이 있는 경우에만 추가 (마이그레이션 후)
  if (fileHash) {
    insertData.file_hash = fileHash
  }

  const { data: document, error: docError } = await supabase
    .from('vault_documents')
    .insert(insertData)
    .select()
    .single()

  if (docError || !document) {
    console.error('Create vault document error:', docError)
    return { document: null, error: '문서 생성에 실패했습니다.' }
  }

  // 승인자 추가
  const approvals = approverEmails.map(email => ({
    document_id: document.id,
    approver_email: email.toLowerCase(),
    decision: 'pending',
  }))

  const { error: approvalError } = await supabase
    .from('vault_approvals')
    .insert(approvals)

  if (approvalError) {
    console.error('Create vault approvals error:', approvalError)
    // 문서 삭제 (롤백)
    await supabase.from('vault_documents').delete().eq('id', document.id)
    return { document: null, error: '승인자 추가에 실패했습니다.' }
  }

  return { document, error: null }
}

// 내 Vault 문서 목록 조회 (내가 올린 것 + 내가 승인해야 하는 것)
export async function getMyVaultDocuments(userId: string, userEmail: string): Promise<VaultDocument[]> {
  // 1. 내가 올린 문서
  const { data: ownedDocs } = await supabase
    .from('vault_documents')
    .select(`
      *,
      file:photos(id, name, url, thumbnail_url),
      owner:users(email, display_name),
      approvals:vault_approvals(*)
    `)
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })

  // 2. 내가 승인해야 하는 문서
  const { data: approvalDocs } = await supabase
    .from('vault_approvals')
    .select(`
      document:vault_documents(
        *,
        file:photos(id, name, url, thumbnail_url),
        owner:users(email, display_name),
        approvals:vault_approvals(*)
      )
    `)
    .eq('approver_email', userEmail.toLowerCase())
    .not('document', 'is', null)

  // 합치기 (중복 제거)
  const allDocs = [...(ownedDocs || [])]
  const ownedIds = new Set(allDocs.map(d => d.id))

  for (const item of approvalDocs || []) {
    const doc = item.document as unknown as VaultDocument | null
    if (doc && !ownedIds.has(doc.id)) {
      allDocs.push(doc)
    }
  }

  return allDocs as VaultDocument[]
}

// 문서 상세 조회
export async function getVaultDocument(documentId: string): Promise<VaultDocument | null> {
  const { data } = await supabase
    .from('vault_documents')
    .select(`
      *,
      file:photos(id, name, url, thumbnail_url),
      owner:users(email, display_name),
      approvals:vault_approvals(*)
    `)
    .eq('id', documentId)
    .single()

  return data as VaultDocument | null
}

// 승인/거절 처리
export async function processApproval(params: {
  documentId: string
  approverEmail: string
  decision: 'approved' | 'rejected'
  comment?: string
  ipAddress?: string
  userAgent?: string
  walletAddress?: string
  signature?: string
}): Promise<{ success: boolean; error: string | null; documentStatus?: string }> {
  const { documentId, approverEmail, decision, comment, ipAddress, userAgent, walletAddress, signature } = params

  // 승인 레코드 찾기
  const { data: approval, error: findError } = await supabase
    .from('vault_approvals')
    .select('*')
    .eq('document_id', documentId)
    .eq('approver_email', approverEmail.toLowerCase())
    .single()

  if (findError || !approval) {
    return { success: false, error: '승인 권한이 없습니다.' }
  }

  if (approval.decision !== 'pending') {
    return { success: false, error: '이미 처리된 요청입니다.' }
  }

  // 문서 상태 확인
  const { data: document } = await supabase
    .from('vault_documents')
    .select('status, required_approvals, expires_at')
    .eq('id', documentId)
    .single()

  if (!document || document.status !== 'pending') {
    return { success: false, error: '처리할 수 없는 문서입니다.' }
  }

  // 만료 확인
  if (document.expires_at && new Date(document.expires_at) < new Date()) {
    // 만료된 문서는 상태 업데이트
    await supabase
      .from('vault_documents')
      .update({ status: 'expired' })
      .eq('id', documentId)
    return { success: false, error: '만료된 문서입니다.' }
  }

  // 승인 업데이트 (지갑 서명은 DB 컬럼이 있을 때만 포함)
  const updateData: Record<string, unknown> = {
    decision,
    comment: comment || null,
    ip_address: ipAddress || null,
    user_agent: userAgent || null,
    decided_at: new Date().toISOString(),
  }

  // wallet 필드는 마이그레이션 후에 추가
  if (walletAddress) {
    updateData.wallet_address = walletAddress
  }
  if (signature) {
    updateData.wallet_signature = signature
  }

  const { error: updateError } = await supabase
    .from('vault_approvals')
    .update(updateData)
    .eq('id', approval.id)

  if (updateError) {
    return { success: false, error: '처리에 실패했습니다.' }
  }

  // 거절이면 문서도 거절 처리
  if (decision === 'rejected') {
    await supabase
      .from('vault_documents')
      .update({ status: 'rejected' })
      .eq('id', documentId)
    return { success: true, error: null, documentStatus: 'rejected' }
  }

  // 승인 수 확인
  const { data: approvals } = await supabase
    .from('vault_approvals')
    .select('decision')
    .eq('document_id', documentId)

  const approvedCount = approvals?.filter(a => a.decision === 'approved').length || 0

  // M-of-N 달성 시 문서 승인 처리
  if (approvedCount >= document.required_approvals) {
    await supabase
      .from('vault_documents')
      .update({ status: 'approved' })
      .eq('id', documentId)
    return { success: true, error: null, documentStatus: 'approved' }
  }

  return { success: true, error: null, documentStatus: 'pending' }
}

// 승인 진행 상황
export function getApprovalProgress(document: VaultDocument): {
  approved: number
  rejected: number
  pending: number
  total: number
  required: number
  isComplete: boolean
} {
  const approvals = document.approvals || []
  const approved = approvals.filter(a => a.decision === 'approved').length
  const rejected = approvals.filter(a => a.decision === 'rejected').length
  const pending = approvals.filter(a => a.decision === 'pending').length

  return {
    approved,
    rejected,
    pending,
    total: approvals.length,
    required: document.required_approvals,
    isComplete: document.status === 'approved' || document.status === 'rejected',
  }
}

// 문서 만료 여부 확인
export function isDocumentExpired(document: VaultDocument): boolean {
  if (!document.expires_at) return false
  return new Date(document.expires_at) < new Date()
}

// 남은 시간 계산
export function getTimeRemaining(document: VaultDocument): {
  expired: boolean
  text: string
  hours: number
} {
  if (!document.expires_at) {
    return { expired: false, text: '만료 없음', hours: Infinity }
  }

  const now = new Date()
  const expiresAt = new Date(document.expires_at)
  const diffMs = expiresAt.getTime() - now.getTime()

  if (diffMs <= 0) {
    return { expired: true, text: '만료됨', hours: 0 }
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return { expired: false, text: `${days}일 남음`, hours }
  }

  if (hours > 0) {
    return { expired: false, text: `${hours}시간 ${minutes}분 남음`, hours }
  }

  return { expired: false, text: `${minutes}분 남음`, hours: 0 }
}
