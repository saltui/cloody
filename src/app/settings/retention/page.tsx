'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'

interface RetentionPolicy {
  id: string
  name: string
  description: string
  retention_days: number
  document_types: string[]
  affected_count: number
  created_at: string
  updated_at: string
}

interface ExpiringDocument {
  id: string
  name: string
  expiry_date: string
  policy_name: string
  days_remaining: number
}

export default function RetentionPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [policies, setPolicies] = useState<RetentionPolicy[]>([])
  const [expiringDocs, setExpiringDocs] = useState<ExpiringDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState<RetentionPolicy | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formDays, setFormDays] = useState(365)
  const [formTypes, setFormTypes] = useState<string[]>([])
  const [newType, setNewType] = useState('')

  useEffect(() => {
    fetchPolicies()
    fetchExpiringDocuments()
  }, [])

  const fetchPolicies = async () => {
    try {
      const res = await fetch('/api/retention')
      if (!res.ok) throw new Error('Failed to fetch')

      const data = await res.json()
      setPolicies(data.policies || [])
    } catch (error) {
      showToast('보존 정책을 불러오는데 실패했습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const fetchExpiringDocuments = async () => {
    try {
      const res = await fetch('/api/retention/expiring')
      if (!res.ok) throw new Error('Failed to fetch')

      const data = await res.json()
      setExpiringDocs(data.documents || [])
    } catch (error) {
      console.error('Failed to fetch expiring documents')
    }
  }

  const openCreateModal = () => {
    setEditingPolicy(null)
    setFormName('')
    setFormDescription('')
    setFormDays(365)
    setFormTypes([])
    setShowModal(true)
  }

  const openEditModal = (policy: RetentionPolicy) => {
    setEditingPolicy(policy)
    setFormName(policy.name)
    setFormDescription(policy.description)
    setFormDays(policy.retention_days)
    setFormTypes(policy.document_types)
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formName || formDays < 1) {
      showToast('필수 항목을 입력해주세요.', 'error')
      return
    }

    try {
      const method = editingPolicy ? 'PUT' : 'POST'
      const url = editingPolicy ? `/api/retention/${editingPolicy.id}` : '/api/retention'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          description: formDescription,
          retention_days: formDays,
          document_types: formTypes,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save')
      }

      showToast(editingPolicy ? '정책이 수정되었습니다.' : '정책이 생성되었습니다.', 'success')
      setShowModal(false)
      fetchPolicies()
      fetchExpiringDocuments()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '저장에 실패했습니다.', 'error')
    }
  }

  const handleDelete = async (policyId: string) => {
    if (!confirm('정말 삭제하시겠습니까? 이 정책의 영향을 받는 문서는 기본 정책이 적용됩니다.')) return

    try {
      const res = await fetch(`/api/retention/${policyId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')

      showToast('정책이 삭제되었습니다.', 'success')
      fetchPolicies()
      fetchExpiringDocuments()
    } catch (error) {
      showToast('삭제에 실패했습니다.', 'error')
    }
  }

  const addDocumentType = () => {
    if (!newType.trim()) return
    if (formTypes.includes(newType.trim())) {
      showToast('이미 추가된 문서 유형입니다.', 'error')
      return
    }
    setFormTypes([...formTypes, newType.trim()])
    setNewType('')
  }

  const removeDocumentType = (type: string) => {
    setFormTypes(formTypes.filter(t => t !== type))
  }

  return (
    <main className="min-h-screen tds-safe-area-top tds-safe-area-bottom" style={{ background: 'var(--background)' }}>
      {/* 헤더 */}
      <header className="tds-header">
        <div className="max-w-7xl mx-auto w-full flex items-center gap-3 sm:gap-4">
          <button
            onClick={() => router.push('/settings')}
            className="tds-header-action"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="tds-header-title">보존 정책</h1>
          <button
            onClick={openCreateModal}
            className="tds-btn tds-btn-primary ml-auto"
          >
            새 정책
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">
        {/* 만료 예정 문서 알림 */}
        {expiringDocs.length > 0 && (
          <div className="tds-card p-4" style={{ background: 'rgba(234, 179, 8, 0.1)', borderColor: 'var(--warning)' }}>
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: 'var(--warning)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">
                <h3 className="tds-text-body font-semibold" style={{ color: 'var(--warning)' }}>
                  만료 예정 문서 {expiringDocs.length}건
                </h3>
                <p className="tds-text-caption mt-1" style={{ color: 'var(--foreground-secondary)' }}>
                  30일 이내에 보존 기간이 만료되는 문서가 있습니다.
                </p>
                <div className="mt-3 space-y-2">
                  {expiringDocs.slice(0, 5).map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-2 rounded-lg"
                      style={{ background: 'var(--background)' }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="tds-text-body truncate">{doc.name}</p>
                        <p className="tds-text-caption tds-text-secondary">
                          {doc.policy_name} • {doc.days_remaining}일 남음
                        </p>
                      </div>
                      <span
                        className="px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap"
                        style={{
                          background: doc.days_remaining <= 7
                            ? 'rgba(239, 68, 68, 0.1)'
                            : 'rgba(234, 179, 8, 0.1)',
                          color: doc.days_remaining <= 7
                            ? 'var(--error)'
                            : 'var(--warning)',
                        }}
                      >
                        {new Date(doc.expiry_date).toLocaleDateString('ko-KR')}
                      </span>
                    </div>
                  ))}
                  {expiringDocs.length > 5 && (
                    <p className="tds-text-caption tds-text-secondary text-center pt-2">
                      외 {expiringDocs.length - 5}건 더 있습니다.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 정책 목록 */}
        <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
          {loading ? (
            <div className="col-span-full flex justify-center py-8">
              <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
            </div>
          ) : policies.length === 0 ? (
            <div className="col-span-full text-center py-16">
              <div
                className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
              >
                <svg className="w-8 h-8" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="tds-text-body tds-text-secondary">
                아직 보존 정책이 없습니다.
              </p>
            </div>
          ) : (
            policies.map((policy) => (
              <div key={policy.id} className="tds-card p-4 sm:p-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="tds-text-title mb-1">{policy.name}</h3>
                    <p className="tds-text-body tds-text-secondary text-sm">
                      {policy.description || '설명 없음'}
                    </p>
                  </div>
                </div>

                <div className="space-y-3 mb-4">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="tds-text-body">
                      보존 기간: <strong>{policy.retention_days}일</strong>
                    </span>
                  </div>

                  {policy.document_types.length > 0 && (
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 mt-0.5" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <div className="flex-1">
                        <p className="tds-text-caption tds-text-secondary mb-1">문서 유형:</p>
                        <div className="flex flex-wrap gap-1">
                          {policy.document_types.map((type, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded-md text-xs"
                              style={{ background: 'var(--glass-bg)', color: 'var(--foreground-secondary)' }}
                            >
                              {type}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="tds-text-body">
                      영향 받는 문서: <strong>{policy.affected_count}건</strong>
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 pt-3 border-t" style={{ borderColor: 'var(--glass-border)' }}>
                  <button
                    onClick={() => openEditModal(policy)}
                    className="tds-btn tds-btn-secondary flex-1"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(policy.id)}
                    className="tds-btn flex-1"
                    style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)' }}
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 생성/수정 모달 */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setShowModal(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-4 sm:hidden" style={{ background: 'var(--glass-border)' }} />

            <h2 className="tds-text-title mb-4">
              {editingPolicy ? '정책 수정' : '새 보존 정책'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="tds-text-label tds-text-secondary block mb-2">
                  정책 이름 *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  className="tds-input"
                  placeholder="예: 계약서 보존 정책"
                />
              </div>

              <div>
                <label className="tds-text-label tds-text-secondary block mb-2">
                  설명
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  className="tds-input resize-none"
                  placeholder="정책에 대한 설명"
                />
              </div>

              <div>
                <label className="tds-text-label tds-text-secondary block mb-2">
                  보존 기간 (일) *
                </label>
                <input
                  type="number"
                  value={formDays}
                  onChange={(e) => setFormDays(Number(e.target.value))}
                  required
                  min="1"
                  className="tds-input"
                />
                <p className="tds-text-caption tds-text-secondary mt-1">
                  약 {Math.floor(formDays / 365)}년 {Math.floor((formDays % 365) / 30)}개월
                </p>
              </div>

              <div>
                <label className="tds-text-label tds-text-secondary block mb-2">
                  문서 유형
                </label>
                <div className="space-y-2">
                  {formTypes.map((type, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded-lg"
                      style={{ background: 'var(--glass-bg)' }}
                    >
                      <span className="tds-text-body">{type}</span>
                      <button
                        type="button"
                        onClick={() => removeDocumentType(type)}
                        className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newType}
                      onChange={(e) => setNewType(e.target.value)}
                      placeholder="문서 유형 추가"
                      className="tds-input flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addDocumentType()
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={addDocumentType}
                      className="tds-btn tds-btn-secondary"
                    >
                      추가
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="tds-btn tds-btn-secondary flex-1"
                >
                  취소
                </button>
                <button type="submit" className="tds-btn tds-btn-primary flex-1">
                  {editingPolicy ? '수정' : '생성'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}
