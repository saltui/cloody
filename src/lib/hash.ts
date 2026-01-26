/**
 * SHA-256 Hash Utility
 * 파일의 디지털 지문(Hash)을 생성하여 블록체인에 앵커링
 */

// ArrayBuffer를 hex 문자열로 변환
function bufferToHex(buffer: ArrayBuffer): string {
  const hashArray = Array.from(new Uint8Array(buffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// 파일에서 SHA-256 해시 추출 (브라우저 Web Crypto API 사용)
export async function computeFileHash(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return '0x' + bufferToHex(hashBuffer)
}

// URL에서 파일을 가져와 해시 계산 (with AbortSignal support)
export async function computeHashFromUrl(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return '0x' + bufferToHex(hashBuffer)
}

// 문자열에서 SHA-256 해시 추출
export async function computeStringHash(str: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return '0x' + bufferToHex(hashBuffer)
}

// bytes32 형식으로 변환 (스마트 컨트랙트용)
export function hashToBytes32(hash: string): `0x${string}` {
  // 0x 제거 후 64자리 맞추기
  const cleanHash = hash.replace('0x', '').padStart(64, '0')
  return `0x${cleanHash}` as `0x${string}`
}

// 해시 비교 (대소문자 무시)
export function compareHashes(hash1: string, hash2: string): boolean {
  return hash1.toLowerCase() === hash2.toLowerCase()
}

// 해시 축약 표시 (UI용)
export function truncateHash(hash: string, startLen = 6, endLen = 4): string {
  if (hash.length <= startLen + endLen + 2) return hash
  return `${hash.slice(0, startLen + 2)}...${hash.slice(-endLen)}`
}
