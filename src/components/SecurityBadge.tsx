'use client'

import { useState } from 'react'

interface SecurityBadgeProps {
  level: number
  name: string
  color?: string
  className?: string
  showTooltip?: boolean
}

const SECURITY_LEVELS = {
  1: {
    name: '일반',
    color: '#22c55e', // green
    bgColor: 'rgba(34, 197, 94, 0.15)',
    description: '일반 문서 - 제한 없음',
  },
  2: {
    name: '대외비',
    color: '#eab308', // yellow
    bgColor: 'rgba(234, 179, 8, 0.15)',
    description: '대외비 문서 - 외부 유출 주의',
  },
  3: {
    name: '기밀',
    color: '#f97316', // orange
    bgColor: 'rgba(249, 115, 22, 0.15)',
    description: '기밀 문서 - 승인된 인원만 접근 가능',
  },
  4: {
    name: '극비',
    color: '#ef4444', // red
    bgColor: 'rgba(239, 68, 68, 0.15)',
    description: '극비 문서 - 최고 수준 보안 필요',
  },
} as const

export default function SecurityBadge({
  level,
  name,
  color,
  className = '',
  showTooltip = true
}: SecurityBadgeProps) {
  const [showDescription, setShowDescription] = useState(false)

  // Get security level config
  const config = SECURITY_LEVELS[level as keyof typeof SECURITY_LEVELS] || {
    name: name,
    color: color || 'var(--foreground-muted)',
    bgColor: 'var(--glass-bg)',
    description: '알 수 없는 보안 등급',
  }

  const badgeColor = color || config.color
  const badgeBg = color ? `${color}26` : config.bgColor // 26 = 15% opacity in hex

  return (
    <div className="relative inline-block">
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${className}`}
        style={{
          background: badgeBg,
          color: badgeColor,
        }}
        onMouseEnter={() => showTooltip && setShowDescription(true)}
        onMouseLeave={() => showTooltip && setShowDescription(false)}
      >
        {/* Shield Icon */}
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
        <span>{name || config.name}</span>
      </div>

      {/* Tooltip */}
      {showTooltip && showDescription && (
        <div
          className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 rounded-lg shadow-lg whitespace-nowrap z-50 pointer-events-none"
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--glass-border)',
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: badgeColor }}
            />
            <span className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>
              {config.description}
            </span>
          </div>
          {/* Arrow */}
          <div
            className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-px"
            style={{
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid var(--glass-border)',
            }}
          />
        </div>
      )}
    </div>
  )
}
