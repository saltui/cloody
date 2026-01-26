'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'

interface ConnectWalletProps {
  className?: string
  compact?: boolean
  showWhenConnected?: boolean // false면 연결됐을 때 숨김
}

export default function ConnectWallet({ className = '', compact = false, showWhenConnected = true }: ConnectWalletProps) {
  return (
    <div className={className}>
      <ConnectButton.Custom>
        {({
          account,
          chain,
          openAccountModal,
          openConnectModal,
          mounted,
        }) => {
          const ready = mounted
          const connected = ready && account && chain

          return (
            <div
              {...(!ready && {
                'aria-hidden': true,
                style: {
                  opacity: 0,
                  pointerEvents: 'none',
                  userSelect: 'none',
                },
              })}
            >
              {(() => {
                // 연결 안됨 - 연결 버튼 표시
                if (!connected) {
                  return (
                    <button
                      onClick={openConnectModal}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl font-medium text-sm transition-all hover:scale-[1.02] active:scale-[0.98] ${
                        compact ? 'px-2.5 py-1.5' : ''
                      }`}
                      style={{
                        background: 'var(--accent-gradient)',
                        color: 'white',
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      {!compact && <span>지갑 연결</span>}
                    </button>
                  )
                }

                // 연결됨 - showWhenConnected가 false면 숨김
                if (!showWhenConnected) {
                  return null
                }

                // 지원하지 않는 네트워크 (세폴리아 외)
                if (chain.unsupported) {
                  return (
                    <button
                      onClick={openAccountModal}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl font-medium text-sm"
                      style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        color: 'var(--error)',
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      {!compact && <span>네트워크 오류</span>}
                    </button>
                  )
                }

                // 정상 연결 - 간단한 상태만 표시
                return (
                  <button
                    onClick={openAccountModal}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    style={{
                      background: 'var(--glass-bg)',
                      color: 'var(--foreground)',
                      border: '1px solid var(--glass-border)',
                    }}
                  >
                    <div
                      className="w-5 h-5 rounded-full"
                      style={{
                        background: `linear-gradient(135deg, #${account.address.slice(2, 8)}, #${account.address.slice(-6)})`,
                      }}
                    />
                    <span className="font-mono">
                      {account.displayName}
                    </span>
                  </button>
                )
              })()}
            </div>
          )
        }}
      </ConnectButton.Custom>
    </div>
  )
}
