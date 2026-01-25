'use client'

import { ReactNode } from 'react'
import { Global, css } from '@emotion/react'

// TDS 기본 스타일 - 토스 스타일 인터랙션 포함
const globalStyles = css`
  /* Global interaction styles */
  * {
    -webkit-tap-highlight-color: transparent;
  }

  /* TDS Button Styles */
  .tds-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 20px;
    font-size: 15px;
    font-weight: 600;
    border-radius: 12px;
    border: none;
    cursor: pointer;
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    white-space: nowrap;
    user-select: none;
    position: relative;
    overflow: hidden;
  }

  .tds-btn::after {
    content: '';
    position: absolute;
    inset: 0;
    background: currentColor;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .tds-btn:hover::after {
    opacity: 0.08;
  }

  .tds-btn:active::after {
    opacity: 0.12;
  }

  .tds-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none !important;
  }

  .tds-btn:disabled::after {
    display: none;
  }

  .tds-btn-primary {
    background: var(--accent-primary, #3182f6);
    color: white;
  }

  .tds-btn-primary:hover:not(:disabled) {
    background: #2b74e0;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(49, 130, 246, 0.3);
  }

  .tds-btn-primary:active:not(:disabled) {
    transform: scale(0.97) translateY(0);
    box-shadow: none;
    background: #2563c7;
  }

  .tds-btn-secondary {
    background: var(--background-tertiary, #f2f3f6);
    color: var(--foreground, #191f28);
  }

  html.dark .tds-btn-secondary {
    background: var(--background-tertiary, #1f1f25);
    color: var(--foreground, #ececef);
  }

  .tds-btn-secondary:hover:not(:disabled) {
    background: #e8e9ed;
    transform: translateY(-1px);
  }

  html.dark .tds-btn-secondary:hover:not(:disabled) {
    background: #2a2a32;
  }

  .tds-btn-secondary:active:not(:disabled) {
    transform: scale(0.97) translateY(0);
    background: #dcdde1;
  }

  html.dark .tds-btn-secondary:active:not(:disabled) {
    background: #252530;
  }

  .tds-btn-ghost {
    background: transparent;
    color: var(--foreground-secondary, #4e5968);
  }

  .tds-btn-ghost:hover:not(:disabled) {
    background: var(--background-tertiary, #f2f3f6);
  }

  html.dark .tds-btn-ghost:hover:not(:disabled) {
    background: var(--background-tertiary, #1f1f25);
  }

  .tds-btn-ghost:active:not(:disabled) {
    transform: scale(0.97);
    background: #e8e9ed;
  }

  html.dark .tds-btn-ghost:active:not(:disabled) {
    background: #2a2a32;
  }

  .tds-btn-sm {
    padding: 10px 14px;
    font-size: 13px;
    border-radius: 10px;
  }

  .tds-btn-lg {
    padding: 16px 24px;
    font-size: 17px;
    border-radius: 14px;
  }

  .tds-btn-block {
    width: 100%;
  }

  /* TDS Input Styles */
  .tds-input {
    width: 100%;
    padding: 14px 16px;
    font-size: 16px;
    border: 1px solid var(--border-default, rgba(0, 0, 0, 0.06));
    border-radius: 12px;
    background: var(--background, #ffffff);
    color: var(--foreground, #191f28);
    outline: none;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  html.dark .tds-input {
    background: var(--background-tertiary, #1f1f25);
    border-color: var(--border-default, rgba(255, 255, 255, 0.08));
    color: var(--foreground, #ececef);
  }

  .tds-input::placeholder {
    color: var(--foreground-muted, #8b95a1);
  }

  .tds-input:hover:not(:disabled):not(:focus) {
    border-color: rgba(0, 0, 0, 0.15);
  }

  html.dark .tds-input:hover:not(:disabled):not(:focus) {
    border-color: rgba(255, 255, 255, 0.15);
  }

  .tds-input:focus {
    border-color: var(--accent-primary, #3182f6);
    box-shadow: 0 0 0 3px rgba(49, 130, 246, 0.1);
  }

  .tds-input:disabled {
    background: var(--background-secondary, #f7f8fa);
    cursor: not-allowed;
    opacity: 0.6;
  }

  html.dark .tds-input:disabled {
    background: var(--background-secondary, #17171c);
  }

  /* TDS Card Styles */
  .tds-card {
    background: var(--card-bg, #ffffff);
    border-radius: 16px;
    border: 1px solid var(--glass-border, rgba(0, 0, 0, 0.06));
    overflow: hidden;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  html.dark .tds-card {
    background: var(--card-bg, #1f1f25);
    border-color: var(--glass-border, rgba(255, 255, 255, 0.06));
  }

  .tds-card-clickable {
    cursor: pointer;
  }

  .tds-card-clickable:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
    border-color: rgba(0, 0, 0, 0.1);
  }

  html.dark .tds-card-clickable:hover {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .tds-card-clickable:active {
    transform: scale(0.98) translateY(0);
    box-shadow: none;
  }

  .tds-card-elevated {
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.1));
    border: none;
  }

  /* TDS Text Styles */
  .tds-text-display {
    font-size: 32px;
    font-weight: 700;
    line-height: 1.3;
    color: var(--foreground, #191f28);
  }

  .tds-text-headline {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.4;
    color: var(--foreground, #191f28);
  }

  .tds-text-title {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--foreground, #191f28);
  }

  .tds-text-body {
    font-size: 15px;
    font-weight: 400;
    line-height: 1.6;
    color: var(--foreground, #191f28);
  }

  .tds-text-caption {
    font-size: 13px;
    font-weight: 400;
    line-height: 1.5;
    color: var(--foreground, #191f28);
  }

  .tds-text-label {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.4;
    letter-spacing: 0.02em;
    color: var(--foreground, #191f28);
  }

  .tds-text-secondary {
    color: var(--foreground-secondary, #4e5968) !important;
  }

  .tds-text-tertiary {
    color: var(--foreground-muted, #8b95a1) !important;
  }

  /* TDS Badge Styles */
  .tds-badge {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 600;
    border-radius: 8px;
    background: var(--background-tertiary, #f2f3f6);
    color: var(--foreground-secondary, #4e5968);
    transition: all 0.15s ease;
  }

  html.dark .tds-badge {
    background: var(--background-tertiary, #1f1f25);
    color: var(--foreground-secondary, #8f959e);
  }

  .tds-badge-primary {
    background: rgba(49, 130, 246, 0.1);
    color: var(--accent-primary, #3182f6);
  }

  .tds-badge-success {
    background: rgba(0, 200, 83, 0.1);
    color: var(--success, #00c853);
  }

  .tds-badge-error {
    background: rgba(244, 67, 54, 0.1);
    color: var(--error, #f44336);
  }

  /* TDS Skeleton */
  .tds-skeleton {
    background: linear-gradient(
      90deg,
      var(--background-secondary, #f7f8fa) 25%,
      var(--background-tertiary, #f2f3f6) 50%,
      var(--background-secondary, #f7f8fa) 75%
    );
    background-size: 200% 100%;
    animation: tds-skeleton-shimmer 1.5s ease-in-out infinite;
  }

  html.dark .tds-skeleton {
    background: linear-gradient(
      90deg,
      var(--background-secondary, #17171c) 25%,
      var(--background-tertiary, #1f1f25) 50%,
      var(--background-secondary, #17171c) 75%
    );
    background-size: 200% 100%;
  }

  @keyframes tds-skeleton-shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  /* TDS Bottom Navigation - Toss Style */
  .tds-bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    background: var(--background, #ffffff);
    border-top: 1px solid var(--glass-border, rgba(0, 0, 0, 0.04));
    padding-bottom: env(safe-area-inset-bottom);
    z-index: 100;
  }

  /* PC 해상도에서 하단 탭 숨김 (xl: 1280px) */
  @media (min-width: 1280px) {
    .tds-bottom-nav {
      display: none !important;
    }
  }

  html.dark .tds-bottom-nav {
    background: #191919;
    border-top-color: rgba(255, 255, 255, 0.08);
  }

  .tds-bottom-nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 10px 0 8px;
    color: #8b8b8b;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
  }

  html.dark .tds-bottom-nav-item {
    color: #6b6b6b;
  }

  .tds-bottom-nav-item::before {
    content: '';
    position: absolute;
    inset: 4px 8px;
    background: transparent;
    border-radius: 12px;
    transition: background 0.15s ease;
  }

  .tds-bottom-nav-item:active::before {
    background: rgba(0, 0, 0, 0.05);
  }

  html.dark .tds-bottom-nav-item:active::before {
    background: rgba(255, 255, 255, 0.05);
  }

  .tds-bottom-nav-item.active {
    color: var(--foreground, #191f28);
  }

  html.dark .tds-bottom-nav-item.active {
    color: #ffffff;
  }

  .tds-bottom-nav-item:active {
    transform: scale(0.95);
  }

  .tds-bottom-nav-item svg {
    width: 26px;
    height: 26px;
    position: relative;
    z-index: 1;
    transition: transform 0.15s ease;
  }

  .tds-bottom-nav-item:active svg {
    transform: scale(0.9);
  }

  .tds-bottom-nav-item span {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: -0.02em;
    position: relative;
    z-index: 1;
  }

  /* TDS FAB */
  .tds-fab {
    position: fixed;
    bottom: calc(72px + env(safe-area-inset-bottom));
    right: 16px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--accent-primary, #3182f6);
    color: white;
    border: none;
    box-shadow: 0 4px 16px rgba(49, 130, 246, 0.4);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 50;
  }

  .tds-fab:hover {
    transform: scale(1.08);
    box-shadow: 0 8px 28px rgba(49, 130, 246, 0.5);
    background: #2b74e0;
  }

  .tds-fab:active {
    transform: scale(0.92);
    box-shadow: 0 2px 8px rgba(49, 130, 246, 0.3);
  }

  .tds-fab svg {
    width: 28px;
    height: 28px;
    transition: transform 0.2s ease;
  }

  .tds-fab:active svg {
    transform: rotate(90deg);
  }

  /* TDS Header */
  .tds-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--background, #ffffff);
    border-bottom: 1px solid var(--glass-border, rgba(0, 0, 0, 0.06));
    position: sticky;
    top: 0;
    z-index: 10;
  }

  html.dark .tds-header {
    background: var(--background, #17171c);
    border-bottom-color: var(--glass-border, rgba(255, 255, 255, 0.06));
  }

  .tds-header-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--foreground, #191f28);
  }

  .tds-header-action {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--foreground, #191f28);
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .tds-header-action:hover {
    background: var(--background-tertiary, #f2f3f6);
  }

  html.dark .tds-header-action:hover {
    background: var(--background-tertiary, #1f1f25);
  }

  .tds-header-action:active {
    transform: scale(0.9);
    background: #e8e9ed;
  }

  html.dark .tds-header-action:active {
    background: #2a2a32;
  }

  /* TDS Sheet */
  .tds-sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
    animation: tds-fade-in 0.2s ease;
    backdrop-filter: blur(4px);
  }

  .tds-sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--background, #ffffff);
    border-radius: 20px 20px 0 0;
    padding: 20px;
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
    z-index: 101;
    animation: tds-slide-up 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  }

  html.dark .tds-sheet {
    background: var(--background-elevated, #26262d);
  }

  .tds-sheet-handle {
    width: 36px;
    height: 4px;
    background: var(--foreground-muted, #8b95a1);
    border-radius: 2px;
    margin: 0 auto 16px;
    opacity: 0.3;
  }

  @keyframes tds-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes tds-slide-up {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }

  @keyframes tds-dialog-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* TDS Dialog (PC Modal) */
  .tds-dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
    animation: tds-fade-in 0.2s ease;
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .tds-dialog {
    width: 100%;
    max-width: 400px;
    max-height: calc(100vh - 48px);
    background: var(--background, #ffffff);
    border-radius: 20px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 101;
    animation: tds-dialog-in 0.2s cubic-bezier(0.32, 0.72, 0, 1);
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  }

  html.dark .tds-dialog {
    background: var(--background-elevated, #26262d);
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  }

  .tds-dialog-header {
    padding: 20px 20px 0;
  }

  .tds-dialog-header h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--foreground, #191f28);
    margin: 0;
  }

  .tds-dialog-header p {
    font-size: 14px;
    color: var(--foreground-secondary, #4e5968);
    margin: 4px 0 0;
  }

  .tds-dialog-body {
    padding: 16px 20px;
    flex: 1;
    overflow-y: auto;
  }

  .tds-dialog-footer {
    padding: 16px 20px 20px;
    display: flex;
    gap: 10px;
  }

  .tds-dialog-footer .tds-btn {
    flex: 1;
  }

  /* TDS Responsive Modal (Sheet on mobile, Dialog on desktop) */
  .tds-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
    animation: tds-fade-in 0.2s ease;
    backdrop-filter: blur(4px);
  }

  .tds-modal {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--background, #ffffff);
    border-radius: 20px 20px 0 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 101;
    animation: tds-slide-up 0.3s cubic-bezier(0.32, 0.72, 0, 1);
    max-height: 85vh;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  @keyframes tds-slide-up {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  html.dark .tds-modal {
    background: var(--background-elevated, #26262d);
  }

  @media (min-width: 640px) {
    .tds-modal-backdrop {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .tds-modal {
      position: relative;
      bottom: auto;
      left: auto;
      right: auto;
      width: 100%;
      max-width: 400px;
      max-height: calc(100vh - 48px);
      border-radius: 20px;
      animation: tds-dialog-in 0.2s cubic-bezier(0.32, 0.72, 0, 1);
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }

    html.dark .tds-modal {
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
  }

  .tds-modal-handle {
    width: 36px;
    height: 4px;
    background: var(--foreground-muted, #8b95a1);
    border-radius: 2px;
    margin: 8px auto 0;
    opacity: 0.3;
  }

  @media (min-width: 640px) {
    .tds-modal-handle {
      display: none;
    }
  }

  .tds-modal-header {
    padding: 16px 20px 0;
  }

  @media (min-width: 640px) {
    .tds-modal-header {
      padding: 20px 20px 0;
    }
  }

  .tds-modal-header h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--foreground, #191f28);
    margin: 0;
  }

  .tds-modal-header p {
    font-size: 14px;
    color: var(--foreground-secondary, #4e5968);
    margin: 4px 0 0;
  }

  .tds-modal-body {
    padding: 16px 20px;
    flex: 1;
    overflow-y: auto;
  }

  .tds-modal-footer {
    padding: 12px 20px;
    display: flex;
    gap: 10px;
    border-top: 1px solid var(--glass-border, rgba(0, 0, 0, 0.06));
  }

  html.dark .tds-modal-footer {
    border-top-color: var(--glass-border, rgba(255, 255, 255, 0.06));
  }

  @media (min-width: 640px) {
    .tds-modal-footer {
      padding: 16px 20px 20px;
      border-top: none;
    }
  }

  .tds-modal-footer .tds-btn {
    flex: 1;
  }

  /* TDS Image Grid */
  .tds-image-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
  }

  @media (min-width: 640px) {
    .tds-image-grid {
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
    }
  }

  @media (min-width: 1024px) {
    .tds-image-grid {
      grid-template-columns: repeat(5, 1fr);
    }
  }

  .tds-image-grid-item {
    aspect-ratio: 1;
    overflow: hidden;
    position: relative;
    background: var(--background-tertiary, #f2f3f6);
    cursor: pointer;
  }

  html.dark .tds-image-grid-item {
    background: var(--background-tertiary, #1f1f25);
  }

  .tds-image-grid-item::after {
    content: '';
    position: absolute;
    inset: 0;
    background: black;
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }

  .tds-image-grid-item:hover::after {
    opacity: 0.05;
  }

  .tds-image-grid-item:active::after {
    opacity: 0.1;
  }

  .tds-image-grid-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .tds-image-grid-item:active img {
    transform: scale(0.95);
  }

  /* TDS List Item */
  .tds-list-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: var(--background, #ffffff);
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
    position: relative;
  }

  html.dark .tds-list-item {
    background: var(--background, #17171c);
  }

  .tds-list-item:hover {
    background: var(--background-secondary, #f7f8fa);
  }

  html.dark .tds-list-item:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .tds-list-item:active {
    background: #eeeff2;
    transform: scale(0.99);
  }

  html.dark .tds-list-item:active {
    background: rgba(255, 255, 255, 0.06);
  }

  /* TDS Divider */
  .tds-divider {
    height: 1px;
    background: var(--glass-border, rgba(0, 0, 0, 0.06));
    margin: 0;
  }

  html.dark .tds-divider {
    background: var(--glass-border, rgba(255, 255, 255, 0.06));
  }

  /* TDS Checkbox / Toggle */
  .tds-toggle {
    position: relative;
    width: 52px;
    height: 32px;
    border-radius: 16px;
    background: #e0e0e0;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    border: none;
    padding: 0;
  }

  html.dark .tds-toggle {
    background: #3a3a3a;
  }

  .tds-toggle.active {
    background: var(--accent-primary, #3182f6);
  }

  .tds-toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .tds-toggle.active::after {
    transform: translateX(20px);
  }

  .tds-toggle:active::after {
    width: 32px;
  }

  .tds-toggle.active:active::after {
    transform: translateX(16px);
  }

  /* TDS Ripple effect */
  .tds-ripple {
    position: relative;
    overflow: hidden;
  }

  .tds-ripple::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    background: currentColor;
    opacity: 0;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    transition: width 0.4s ease, height 0.4s ease, opacity 0.4s ease;
  }

  .tds-ripple:active::before {
    width: 200%;
    height: 200%;
    opacity: 0.1;
  }

  /* Utility classes */
  .tds-safe-area-top {
    padding-top: env(safe-area-inset-top);
  }

  .tds-safe-area-bottom {
    padding-bottom: env(safe-area-inset-bottom);
  }

  .tds-pressable {
    transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
  }

  .tds-pressable:active {
    transform: scale(0.97);
  }

  .tds-hover-lift {
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .tds-hover-lift:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  html.dark .tds-hover-lift:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  /* TDS Sidebar Navigation */
  .sidebar-nav-item {
    position: relative;
  }

  .sidebar-nav-item::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 8px;
    background: transparent;
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .sidebar-nav-item:hover:not(.sidebar-nav-item-active)::before {
    background: var(--background-tertiary, #f2f3f6);
  }

  html.dark .sidebar-nav-item:hover:not(.sidebar-nav-item-active)::before {
    background: rgba(255, 255, 255, 0.04);
  }

  .sidebar-nav-item:active::before {
    background: var(--background-secondary, #e8e9ed) !important;
  }

  html.dark .sidebar-nav-item:active::before {
    background: rgba(255, 255, 255, 0.08) !important;
  }

  .sidebar-nav-item:active {
    transform: scale(0.98);
  }

  .sidebar-nav-item:hover svg,
  .sidebar-nav-item:active svg {
    transform: scale(1.1);
  }

  .sidebar-nav-item-active {
    font-weight: 600;
  }

  .sidebar-nav-item-active::after {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 16px;
    background: var(--accent-primary, #3182f6);
    border-radius: 0 2px 2px 0;
  }

  /* Sidebar User Card */
  .sidebar-user-card {
    position: relative;
  }

  .sidebar-user-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 8px;
    background: transparent;
    transition: all 0.15s ease;
  }

  .sidebar-user-card:hover::before {
    background: rgba(0, 0, 0, 0.02);
  }

  html.dark .sidebar-user-card:hover::before {
    background: rgba(255, 255, 255, 0.02);
  }

  .sidebar-user-card:hover .avatar {
    transform: scale(1.05);
  }

  /* Sidebar Logout Button */
  .sidebar-logout-btn {
    position: relative;
  }

  .sidebar-logout-btn::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 6px;
    background: transparent;
    transition: all 0.15s ease;
  }

  .sidebar-logout-btn:hover {
    color: var(--error, #f44336) !important;
  }

  .sidebar-logout-btn:hover::before {
    background: rgba(244, 67, 54, 0.08);
  }

  .sidebar-logout-btn:active {
    transform: scale(0.9);
  }

  .sidebar-logout-btn:hover svg {
    transform: translateX(2px);
  }

  .sidebar-logout-btn:active svg {
    transform: translateX(4px) scale(0.9);
  }

  /* Sidebar Storage Card */
  .sidebar-storage-card {
    cursor: default;
  }

  .sidebar-storage-card:hover {
    border-color: var(--accent-primary, #3182f6) !important;
  }

  .sidebar-storage-card:hover span:last-of-type {
    color: var(--accent-primary, #3182f6) !important;
  }

  /* Progress bar animation */
  .progress-bar-fill {
    position: relative;
    overflow: hidden;
  }

  .progress-bar-fill::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.3) 50%,
      transparent 100%
    );
    animation: progress-shimmer 2s ease-in-out infinite;
  }

  @keyframes progress-shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  /* Settings Tab Items */
  .settings-tab-item {
    position: relative;
  }

  .settings-tab-item::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 12px;
    background: transparent;
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .settings-tab-item:not(.settings-tab-active):hover::before {
    background: var(--background-tertiary, #f2f3f6);
  }

  html.dark .settings-tab-item:not(.settings-tab-active):hover::before {
    background: rgba(255, 255, 255, 0.04);
  }

  .settings-tab-item:active {
    transform: scale(0.97);
  }

  .settings-tab-item:hover svg,
  .settings-tab-item:active svg {
    transform: scale(1.1);
  }

  .settings-tab-active {
    box-shadow: 0 4px 12px rgba(49, 130, 246, 0.3);
  }

  .settings-tab-active:hover {
    box-shadow: 0 6px 16px rgba(49, 130, 246, 0.4);
    transform: translateY(-1px);
  }

  .settings-tab-active:active {
    transform: scale(0.97) translateY(0);
    box-shadow: 0 2px 8px rgba(49, 130, 246, 0.2);
  }

  /* Settings Logout Button */
  .settings-logout-btn {
    cursor: pointer;
  }

  .settings-logout-btn:hover {
    background: rgba(244, 67, 54, 0.05) !important;
    border-color: rgba(244, 67, 54, 0.2) !important;
  }

  .settings-logout-btn:active {
    transform: scale(0.98);
    background: rgba(244, 67, 54, 0.1) !important;
  }

  .settings-logout-btn:hover svg {
    transform: translateX(4px);
  }

  .settings-logout-btn:active svg {
    transform: translateX(6px) scale(0.95);
  }

  /* Upload Panel */
  .upload-panel {
    animation: upload-panel-slide-in 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  }

  @keyframes upload-panel-slide-in {
    from {
      opacity: 0;
      transform: translateY(20px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .upload-panel:hover {
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  }

  html.dark .upload-panel:hover {
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  }

  .upload-panel-btn:active {
    transform: scale(0.9);
  }

  .upload-panel-btn:hover svg {
    transform: scale(1.1);
  }

  .upload-panel-btn:active svg {
    transform: scale(0.9) !important;
  }

  /* Modal Animations */
  .modal-backdrop {
    animation: modal-fade-in 0.2s ease;
  }

  .modal-content {
    animation: modal-scale-in 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  }

  @keyframes modal-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes modal-scale-in {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(10px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  /* Dropdown Menu Animations */
  .dropdown-menu {
    animation: dropdown-slide 0.2s cubic-bezier(0.32, 0.72, 0, 1);
    transform-origin: top right;
  }

  @keyframes dropdown-slide {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(-4px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  /* Toast Notifications */
  .toast {
    animation: toast-slide-in 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  }

  @keyframes toast-slide-in {
    from {
      opacity: 0;
      transform: translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Folder Picker */
  .folder-picker-item {
    position: relative;
  }

  .folder-picker-item::before {
    content: '';
    position: absolute;
    inset: 4px 8px;
    border-radius: 12px;
    background: transparent;
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .folder-picker-item:hover:not(.folder-picker-item-active)::before {
    background: var(--background-tertiary, #f2f3f6);
  }

  html.dark .folder-picker-item:hover:not(.folder-picker-item-active)::before {
    background: rgba(255, 255, 255, 0.04);
  }

  .folder-picker-item:active::before {
    background: var(--background-secondary, #e8e9ed) !important;
  }

  html.dark .folder-picker-item:active::before {
    background: rgba(255, 255, 255, 0.08) !important;
  }

  .folder-picker-item:active {
    transform: scale(0.98);
  }

  .folder-picker-item:hover > div:first-of-type {
    transform: scale(1.05);
  }

  .folder-picker-item:active > div:first-of-type {
    transform: scale(0.95);
  }

  .folder-picker-item-active {
    position: relative;
  }

  .folder-picker-item-active::after {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 24px;
    background: var(--accent-primary, #3182f6);
    border-radius: 0 3px 3px 0;
  }
`

interface TdsProviderProps {
  children: ReactNode
}

export function TdsProvider({ children }: TdsProviderProps) {
  return (
    <>
      <Global styles={globalStyles} />
      {children}
    </>
  )
}
