'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'

interface Role {
  id: string
  name: string
  description: string
  security_level: number
  permissions: string[]
  user_count: number
  department: string | null
  created_at: string
}

interface Permission {
  id: string
  name: string
  category: string
  description: string
}

export default function RolesPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assigningRole, setAssigningRole] = useState<Role | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formSecurityLevel, setFormSecurityLevel] = useState(1)
  const [formPermissions, setFormPermissions] = useState<string[]>([])
  const [formDepartment, setFormDepartment] = useState('')

  // Assign modal state
  const [userEmail, setUserEmail] = useState('')

  useEffect(() => {
    fetchRoles()
    fetchPermissions()
  }, [])

  const fetchRoles = async () => {
    try {
      const res = await fetch('/api/roles')
      if (!res.ok) throw new Error('Failed to fetch')

      const data = await res.json()
      setRoles(data.roles || [])
    } catch (error) {
      showToast('역할을 불러오는데 실패했습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const fetchPermissions = async () => {
    try {
      const res = await fetch('/api/permissions')
      if (!res.ok) throw new Error('Failed to fetch')

      const data = await res.json()
      setPermissions(data.permissions || [])
    } catch (error) {
      console.error('Failed to fetch permissions')
    }
  }

  const openCreateModal = () => {
    setEditingRole(null)
    setFormName('')
    setFormDescription('')
    setFormSecurityLevel(1)
    setFormPermissions([])
    setFormDepartment('')
    setShowModal(true)
  }

  const openEditModal = (role: Role) => {
    setEditingRole(role)
    setFormName(role.name)
    setFormDescription(role.description)
    setFormSecurityLevel(role.security_level)
    setFormPermissions(role.permissions)
    setFormDepartment(role.department || '')
    setShowModal(true)
  }

  const openAssignModal = (role: Role) => {
    setAssigningRole(role)
    setUserEmail('')
    setShowAssignModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formName) {
      showToast('역할 이름을 입력해주세요.', 'error')
      return
    }

    try {
      const method = editingRole ? 'PUT' : 'POST'
      const url = editingRole ? `/api/roles/${editingRole.id}` : '/api/roles'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          description: formDescription,
          security_level: formSecurityLevel,
          permissions: formPermissions,
          department: formDepartment || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save')
      }

      showToast(editingRole ? '역할이 수정되었습니다.' : '역할이 생성되었습니다.', 'success')
      setShowModal(false)
      fetchRoles()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '저장에 실패했습니다.', 'error')
    }
  }

  const handleDelete = async (roleId: string) => {
    if (!confirm('정말 삭제하시겠습니까? 이 역할을 가진 사용자는 권한을 잃게 됩니다.')) return

    try {
      const res = await fetch(`/api/roles/${roleId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')

      showToast('역할이 삭제되었습니다.', 'success')
      fetchRoles()
    } catch (error) {
      showToast('삭제에 실패했습니다.', 'error')
    }
  }

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!userEmail || !assigningRole) return

    try {
      const res = await fetch(`/api/roles/${assigningRole.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to assign')
      }

      showToast('역할이 할당되었습니다.', 'success')
      setShowAssignModal(false)
      fetchRoles()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '할당에 실패했습니다.', 'error')
    }
  }

  const togglePermission = (permId: string) => {
    if (formPermissions.includes(permId)) {
      setFormPermissions(formPermissions.filter(p => p !== permId))
    } else {
      setFormPermissions([...formPermissions, permId])
    }
  }

  const groupedPermissions = permissions.reduce((acc, perm) => {
    if (!acc[perm.category]) {
      acc[perm.category] = []
    }
    acc[perm.category].push(perm)
    return acc
  }, {} as Record<string, Permission[]>)

  const getSecurityLevelColor = (level: number) => {
    if (level >= 4) return 'var(--error)'
    if (level >= 3) return 'var(--warning)'
    return 'var(--success)'
  }

  const getSecurityLevelLabel = (level: number) => {
    if (level >= 4) return '최고'
    if (level >= 3) return '높음'
    if (level >= 2) return '중간'
    return '낮음'
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
          <h1 className="tds-header-title">역할 및 권한</h1>
          <button
            onClick={openCreateModal}
            className="tds-btn tds-btn-primary ml-auto"
          >
            새 역할
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">
        {/* 역할 목록 */}
        <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <div className="col-span-full flex justify-center py-8">
              <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
            </div>
          ) : roles.length === 0 ? (
            <div className="col-span-full text-center py-16">
              <div
                className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
              >
                <svg className="w-8 h-8" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <p className="tds-text-body tds-text-secondary">
                아직 역할이 없습니다.
              </p>
            </div>
          ) : (
            roles.map((role) => (
              <div key={role.id} className="tds-card p-4 sm:p-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="tds-text-title mb-1">{role.name}</h3>
                    <p className="tds-text-body tds-text-secondary text-sm">
                      {role.description || '설명 없음'}
                    </p>
                  </div>
                </div>

                <div className="space-y-3 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="tds-text-caption tds-text-secondary">보안 수준</span>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <div
                            key={level}
                            className="w-2 h-4 rounded-sm"
                            style={{
                              background: level <= role.security_level
                                ? getSecurityLevelColor(role.security_level)
                                : 'var(--glass-bg)',
                            }}
                          />
                        ))}
                      </div>
                      <span
                        className="text-xs font-medium"
                        style={{ color: getSecurityLevelColor(role.security_level) }}
                      >
                        {getSecurityLevelLabel(role.security_level)}
                      </span>
                    </div>
                  </div>

                  {role.department && (
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      <span className="tds-text-caption">{role.department}</span>
                    </div>
                  )}

                  <div>
                    <p className="tds-text-caption tds-text-secondary mb-2">
                      권한 {role.permissions.length}개
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {role.permissions.slice(0, 3).map((permId) => {
                        const perm = permissions.find(p => p.id === permId)
                        return perm ? (
                          <span
                            key={permId}
                            className="px-2 py-0.5 rounded-md text-xs"
                            style={{ background: 'var(--accent-gradient-subtle)', color: 'var(--accent-primary)' }}
                          >
                            {perm.name}
                          </span>
                        ) : null
                      })}
                      {role.permissions.length > 3 && (
                        <span
                          className="px-2 py-0.5 rounded-md text-xs"
                          style={{ background: 'var(--glass-bg)', color: 'var(--foreground-muted)' }}
                        >
                          +{role.permissions.length - 3}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" style={{ color: 'var(--foreground-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    <span className="tds-text-body">
                      사용자 <strong>{role.user_count}명</strong>
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 pt-3 border-t" style={{ borderColor: 'var(--glass-border)' }}>
                  <button
                    onClick={() => openAssignModal(role)}
                    className="tds-btn tds-btn-secondary flex-1 text-sm"
                  >
                    할당
                  </button>
                  <button
                    onClick={() => openEditModal(role)}
                    className="tds-btn tds-btn-secondary flex-1 text-sm"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(role.id)}
                    className="tds-btn text-sm"
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
            className="relative w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-4 sm:hidden" style={{ background: 'var(--glass-border)' }} />

            <h2 className="tds-text-title mb-4">
              {editingRole ? '역할 수정' : '새 역할'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="tds-text-label tds-text-secondary block mb-2">
                    역할 이름 *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                    className="tds-input"
                    placeholder="예: 문서 관리자"
                  />
                </div>

                <div>
                  <label className="tds-text-label tds-text-secondary block mb-2">
                    부서
                  </label>
                  <input
                    type="text"
                    value={formDepartment}
                    onChange={(e) => setFormDepartment(e.target.value)}
                    className="tds-input"
                    placeholder="선택사항"
                  />
                </div>
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
                  placeholder="역할에 대한 설명"
                />
              </div>

              <div>
                <label className="tds-text-label tds-text-secondary block mb-2">
                  보안 수준: {getSecurityLevelLabel(formSecurityLevel)}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={formSecurityLevel}
                    onChange={(e) => setFormSecurityLevel(Number(e.target.value))}
                    className="flex-1"
                  />
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div
                        key={level}
                        className="w-3 h-6 rounded-sm"
                        style={{
                          background: level <= formSecurityLevel
                            ? getSecurityLevelColor(formSecurityLevel)
                            : 'var(--glass-bg)',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="tds-text-label tds-text-secondary block mb-2">
                  권한 ({formPermissions.length}개 선택)
                </label>
                <div className="space-y-3 max-h-64 overflow-y-auto p-3 rounded-lg" style={{ background: 'var(--glass-bg)' }}>
                  {Object.entries(groupedPermissions).map(([category, perms]) => (
                    <div key={category}>
                      <p className="tds-text-caption font-semibold mb-2" style={{ color: 'var(--accent-primary)' }}>
                        {category}
                      </p>
                      <div className="space-y-2">
                        {perms.map((perm) => (
                          <label
                            key={perm.id}
                            className="flex items-start gap-3 p-2 rounded-lg cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            <input
                              type="checkbox"
                              checked={formPermissions.includes(perm.id)}
                              onChange={() => togglePermission(perm.id)}
                              className="mt-1"
                            />
                            <div className="flex-1">
                              <p className="tds-text-body font-medium">{perm.name}</p>
                              <p className="tds-text-caption tds-text-secondary">{perm.description}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
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
                  {editingRole ? '수정' : '생성'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 역할 할당 모달 */}
      {showAssignModal && assigningRole && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setShowAssignModal(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 sm:p-6"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-4 sm:hidden" style={{ background: 'var(--glass-border)' }} />

            <h2 className="tds-text-title mb-2">역할 할당</h2>
            <p className="tds-text-body tds-text-secondary mb-4">
              <strong>{assigningRole.name}</strong> 역할을 사용자에게 할당합니다.
            </p>

            <form onSubmit={handleAssignRole} className="space-y-4">
              <div>
                <label className="tds-text-label tds-text-secondary block mb-2">
                  사용자 이메일
                </label>
                <input
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  required
                  className="tds-input"
                  placeholder="user@example.com"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="tds-btn tds-btn-secondary flex-1"
                >
                  취소
                </button>
                <button type="submit" className="tds-btn tds-btn-primary flex-1">
                  할당
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}
