import { createHmac, timingSafeEqual } from 'crypto'

// Separate fallbacks to preserve existing token compatibility.
// Gallery auth originally used 'fallback-secret-key', user auth used 'default-secret-key-change-me'.
const GALLERY_SECRET = process.env.GALLERY_PASSWORD || 'fallback-secret-key'
const USER_SECRET = process.env.GALLERY_PASSWORD || 'default-secret-key-change-me'

// ---------------------------------------------------------------------------
// Gallery tokens  (auth.ts format)
// Encoding: base64url payload  +  base64url HMAC-SHA256
// ---------------------------------------------------------------------------

export interface GallerySessionPayload {
  sessionId: string
  createdAt: number
  expiresAt: number
  ip: string
  lastActivity: number
}

function gallerySign(payloadStr: string): string {
  return createHmac('sha256', GALLERY_SECRET).update(payloadStr).digest('base64url')
}

export function signGalleryToken(payload: GallerySessionPayload): string {
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = gallerySign(payloadStr)
  return `${payloadStr}.${signature}`
}

export function verifyGalleryToken(token: string): GallerySessionPayload | null {
  try {
    const dotIndex = token.indexOf('.')
    if (dotIndex === -1) return null

    const payloadStr = token.slice(0, dotIndex)
    const signature = token.slice(dotIndex + 1)

    const expectedSignature = gallerySign(payloadStr)
    const sigBuf = Buffer.from(signature, 'base64url')
    const expBuf = Buffer.from(expectedSignature, 'base64url')

    if (sigBuf.length !== expBuf.length) return null
    if (!timingSafeEqual(sigBuf, expBuf)) return null

    return JSON.parse(Buffer.from(payloadStr, 'base64url').toString()) as GallerySessionPayload
  } catch (error) {
    console.error('[token] verifyGalleryToken failed:', error)
    return null
  }
}

// ---------------------------------------------------------------------------
// User tokens  (user-auth.ts format)
// Encoding: base64 payload  +  hex HMAC-SHA256
// ---------------------------------------------------------------------------

export interface UserSessionPayload {
  userId: string
  email: string
  displayName: string | null
  sessionId: string
  createdAt: number
  expiresAt: number
  ip: string
  lastActivity: number
}

function userSign(data: string): string {
  return createHmac('sha256', USER_SECRET).update(data).digest('hex')
}

export function signUserToken(payload: UserSessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64')
  const signature = userSign(data)
  return `${data}.${signature}`
}

export function verifyUserToken(token: string): UserSessionPayload | null {
  try {
    const dotIndex = token.indexOf('.')
    if (dotIndex === -1) return null

    const data = token.slice(0, dotIndex)
    const signature = token.slice(dotIndex + 1)

    const expectedSignature = userSign(data)
    const sigBuf = Buffer.from(signature, 'hex')
    const expBuf = Buffer.from(expectedSignature, 'hex')

    if (sigBuf.length !== expBuf.length) return null
    if (!timingSafeEqual(sigBuf, expBuf)) return null

    return JSON.parse(Buffer.from(data, 'base64').toString()) as UserSessionPayload
  } catch (error) {
    console.error('[token] verifyUserToken failed:', error)
    return null
  }
}
