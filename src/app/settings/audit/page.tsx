'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'

interface AuditLog {
  id: string
  timestamp: string
  user: string
  action: string
  resource: string
  ip_address: string
  details?: string
}

type ActionFilter = 'all' | 'create' | 'read' | 'update' | 'delete' | 'login' | 'logout'

export default function AuditPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')
  const [userSearch, setUserSearch] = useState('')

  // Integrity status
  const [integrityStatus, setIntegrityStatus] = useState<'verified' | 'checking' | 'error'>('checking')

  useEffect(() => {
    fetchAuditLogs()
    checkIntegrity()
  }, [])

  const fetchAuditLogs = async () => {
    try {
      const params = new URLSearchParams()
      if (dateFrom) params.append('from', dateFrom)
      if (dateTo) params.append('to', dateTo)
      if (actionFilter !== 'all') params.append('action', actionFilter)
      if (userSearch) params.append('user', userSearch)

      const res = await fetch(`/api/audit?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch logs')

      const data = await res.json()
      setLogs(data.logs || [])
    } catch (error) {
      showToast('감사 로그를 불러오는데 실패했습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const checkIntegrity = async () => {
    try {
      const res = await fetch('/api/audit/integrity')
      if (!res.ok) throw new Error('Integrity check failed')

      const data = await res.json()
      setIntegrityStatus(data.verified ? 'verified' : 'error')
    } catch (error) {
      setIntegrityStatus('error')
    }
  }

  const handleDownloadCSV = async () => {
    setDownloading(true)
    try {
      const params = new URLSearchParams()
      if (dateFrom) params.append('from', dateFrom)
      if (dateTo) params.append('to', dateTo)
      if (actionFilter !== 'all') params.append('action', actionFilter)
      if (userSearch) params.append('user', userSearch)

      const res = await fetch(`/api/audit/export?${params.toString()}`)
      if (!res.ok) throw new Error('Export failed')

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      showToast('CSV 파일이 다운로드되었습니다.', 'success')
    } catch (error) {
      showToast('CSV 다운로드에 실패했습니다.', 'error')
    } finally {
      setDownloading(false)
    }
  }

  const applyFilters = () => {
    setLoading(true)
    fetchAuditLogs()
  }

  const resetFilters = () => {
    setDateFrom('')
    setDateTo('')
    setActionFilter('all')
    setUserSearch('')
    setLoading(true)
    fetchAuditLogs()
  }

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
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
          <h1 className="tds-header-title">감사 로그</h1>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">
        {/* 무결성 상태 */}
        <div className="tds-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: integrityStatus === 'verified'
                    ? 'rgba(34, 197, 94, 0.1)'
                    : integrityStatus === 'error'
                    ? 'rgba(239, 68, 68, 0.1)'
                    : 'rgba(234, 179, 8, 0.1)',
                }}
              >
                <svg
                  className="w-5 h-5"
                  style={{
                    color: integrityStatus === 'verified'
                      ? 'var(--success)'
                      : integrityStatus === 'error'
                      ? 'var(--error)'
                      : 'var(--warning)',
                  }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  {integrityStatus === 'verified' ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  ) : integrityStatus === 'error' ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  )}
                </svg>
              </div>
              <div>
                <p className="tds-text-body font-semibold">무결성 검증</p>
                <p className="tds-text-caption tds-text-secondary">
                  {integrityStatus === 'verified'
                    ? '로그 무결성이 확인되었습니다'
                    : integrityStatus === 'error'
                    ? '무결성 검증 오류'
                    : '검증 중...'}
                </p>
              </div>
            </div>
            <button
              onClick={checkIntegrity}
              className="tds-btn tds-btn-secondary"
              disabled={integrityStatus === 'checking'}
            >
              재검증
            </button>
          </div>
        </div>

        {/* 필터 */}
        <div className="tds-card p-4 sm:p-6">
          <h2 className="tds-text-title mb-4">필터</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="tds-text-label tds-text-secondary block mb-2">
                시작 날짜
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="tds-input"
              />
            </div>
            <div>
              <label className="tds-text-label tds-text-secondary block mb-2">
                종료 날짜
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="tds-input"
              />
            </div>
            <div>
              <label className="tds-text-label tds-text-secondary block mb-2">
                작업 유형
              </label>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value as ActionFilter)}
                className="tds-input"
              >
                <option value="all">전체</option>
                <option value="create">생성</option>
                <option value="read">조회</option>
                <option value="update">수정</option>
                <option value="delete">삭제</option>
                <option value="login">로그인</option>
                <option value="logout">로그아웃</option>
              </select>
            </div>
            <div>
              <label className="tds-text-label tds-text-secondary block mb-2">
                사용자 검색
              </label>
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="이메일 또는 이름"
                className="tds-input"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={applyFilters} className="tds-btn tds-btn-primary">
              적용
            </button>
            <button onClick={resetFilters} className="tds-btn tds-btn-secondary">
              초기화
            </button>
            <button
              onClick={handleDownloadCSV}
              disabled={downloading}
              className="tds-btn tds-btn-secondary ml-auto flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {downloading ? 'CSV 생성 중...' : 'CSV 다운로드'}
            </button>
          </div>
        </div>

        {/* 로그 테이블 */}
        <div className="tds-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: 'var(--background-secondary)' }}>
                  <th className="px-4 py-3 text-left tds-text-label tds-text-secondary">시간</th>
                  <th className="px-4 py-3 text-left tds-text-label tds-text-secondary">사용자</th>
                  <th className="px-4 py-3 text-left tds-text-label tds-text-secondary">작업</th>
                  <th className="px-4 py-3 text-left tds-text-label tds-text-secondary">리소스</th>
                  <th className="px-4 py-3 text-left tds-text-label tds-text-secondary">IP 주소</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center">
                      <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center tds-text-body tds-text-secondary">
                      조회된 로그가 없습니다.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="border-t" style={{ borderColor: 'var(--glass-border)' }}>
                      <td className="px-4 py-3 tds-text-body whitespace-nowrap">{formatTimestamp(log.timestamp)}</td>
                      <td className="px-4 py-3 tds-text-body">{log.user}</td>
                      <td className="px-4 py-3">
                        <span
                          className="px-2 py-1 rounded-md text-xs font-medium"
                          style={{
                            background: log.action.toLowerCase().includes('delete')
                              ? 'rgba(239, 68, 68, 0.1)'
                              : log.action.toLowerCase().includes('create')
                              ? 'rgba(34, 197, 94, 0.1)'
                              : 'rgba(49, 130, 246, 0.1)',
                            color: log.action.toLowerCase().includes('delete')
                              ? 'var(--error)'
                              : log.action.toLowerCase().includes('create')
                              ? 'var(--success)'
                              : 'var(--accent-primary)',
                          }}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 tds-text-body">{log.resource}</td>
                      <td className="px-4 py-3 tds-text-body font-mono text-sm">{log.ip_address}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  )
}
