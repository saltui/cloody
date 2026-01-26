'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'

interface ConnectWalletProps {
  className?: string
  compact?: boolean
}

export default function ConnectWallet({ className = '', compact = false }: ConnectWalletProps) {
  return (
    <div className={className}>
      <ConnectButton.Custom>
        {({
          account,
          chain,
          openAccountModal,
          openChainModal,
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

                if (chain.unsupported) {
                  return (
                    <button
                      onClick={openChainModal}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl font-medium text-sm"
                      style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        color: 'var(--error)',
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      {!compact && <span>네트워크 변경</span>}
                    </button>
                  )
                }

                return (
                  <div className="flex items-center gap-2">
                    {/* Chain Selector */}
                    <button
                      onClick={openChainModal}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      style={{
                        background: 'var(--glass-bg)',
                        color: 'var(--foreground-secondary)',
                        border: '1px solid var(--glass-border)',
                      }}
                    >
                      {chain.hasIcon && chain.iconUrl && (
                        <img
                          alt={chain.name ?? 'Chain icon'}
                          src={chain.iconUrl}
                          className="w-4 h-4 rounded-full"
                        />
                      )}
                      {!compact && <span>{chain.name}</span>}
                    </button>

                    {/* Account */}
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
                          background: `linear-gradient(135deg, ${account.address.slice(2, 8)}, ${account.address.slice(-6)})`,
                        }}
                      />
                      <span className="font-mono">
                        {account.displayName}
                      </span>
                      {account.displayBalance && !compact && (
                        <span style={{ color: 'var(--foreground-muted)' }}>
                          {account.displayBalance}
                        </span>
                      )}
                    </button>
                  </div>
                )
              })()}
            </div>
          )
        }}
      </ConnectButton.Custom>
    </div>
  )
}

// Simple version for headers
export function WalletStatus({ className = '' }: { className?: string }) {
  return (
    <div className={className}>
      <ConnectButton
        accountStatus="avatar"
        chainStatus="icon"
        showBalance={false}
      />
    </div>
  )
}
