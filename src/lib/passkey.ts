import crypto from 'crypto'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server'
import { supabaseAdmin as supabase } from './supabase-admin'

function hashBinding(ip: string, userAgent: string): string {
  return crypto.createHash('sha256').update(`${ip}:${userAgent}`).digest('hex')
}

// WebAuthn 설정
const rpName = 'Cloody'
const rpID = process.env.WEBAUTHN_RP_ID || 'localhost'
const origin = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000'

export interface PasskeyCredential {
  id: string
  user_id: string
  credential_id: string // base64url encoded
  public_key: string // base64url encoded
  counter: number
  device_type: string
  backed_up: boolean
  transports: string[] | null
  created_at: string
  last_used_at: string | null
  name: string
}

// 사용자의 기존 패스키 자격증명 가져오기
export async function getUserPasskeys(userId: string): Promise<PasskeyCredential[]> {
  const { data, error } = await supabase
    .from('passkey_credentials')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching passkeys:', error)
    return []
  }

  return data || []
}

// 이메일로 사용자의 패스키 가져오기
export async function getPasskeysByEmail(email: string): Promise<PasskeyCredential[]> {
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase())
    .single()

  if (!user) return []
  return getUserPasskeys(user.id)
}

// 패스키 등록 옵션 생성
export async function createRegistrationOptions(userId: string, email: string, displayName?: string) {
  const existingPasskeys = await getUserPasskeys(userId)

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: email,
    userDisplayName: displayName || email,
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map((passkey) => ({
      id: passkey.credential_id,
      transports: passkey.transports as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform', // 플랫폼 인증기 선호 (Face ID, Touch ID 등)
    },
  })

  // 챌린지를 DB에 저장 (검증 시 사용)
  await supabase
    .from('users')
    .update({ passkey_challenge: options.challenge })
    .eq('id', userId)

  return options
}

// 패스키 등록 응답 검증
export async function verifyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  passkeyName?: string
) {
  // 저장된 챌린지 가져오기
  const { data: user } = await supabase
    .from('users')
    .select('passkey_challenge')
    .eq('id', userId)
    .single()

  if (!user?.passkey_challenge) {
    console.error('[passkey] Challenge not found for user:', userId, 'data:', user)
    throw new Error('Challenge not found')
  }

  console.log('[passkey] verifyRegistration config:', { expectedOrigin: origin, expectedRPID: rpID, challengeLength: user.passkey_challenge.length })

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: user.passkey_challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  })

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Verification failed')
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

  // 패스키 자격증명 저장
  const { error } = await supabase.from('passkey_credentials').insert({
    user_id: userId,
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    device_type: credentialDeviceType,
    backed_up: credentialBackedUp,
    transports: response.response.transports || null,
    name: passkeyName || `패스키 ${new Date().toLocaleDateString('ko-KR')}`,
  })

  if (error) {
    console.error('Error saving passkey:', error)
    throw new Error('Failed to save passkey')
  }

  // 챌린지 삭제
  await supabase
    .from('users')
    .update({ passkey_challenge: null })
    .eq('id', userId)

  return verification
}

// 패스키 인증 옵션 생성
export async function createAuthenticationOptions(email: string) {
  const passkeys = await getPasskeysByEmail(email)

  if (passkeys.length === 0) {
    throw new Error('No passkeys registered')
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: passkeys.map((passkey) => ({
      id: passkey.credential_id,
      transports: passkey.transports as AuthenticatorTransportFuture[] | undefined,
    })),
    userVerification: 'preferred',
  })

  // 챌린지를 임시 저장 (이메일 기반)
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase())
    .single()

  if (user) {
    await supabase
      .from('users')
      .update({ passkey_challenge: options.challenge })
      .eq('id', user.id)
  }

  return options
}

// 패스키 인증 응답 검증
export async function verifyAuthentication(
  email: string,
  response: AuthenticationResponseJSON
) {
  const { data: user } = await supabase
    .from('users')
    .select('id, passkey_challenge')
    .eq('email', email.toLowerCase())
    .single()

  if (!user?.passkey_challenge) {
    throw new Error('Challenge not found')
  }

  // 사용된 자격증명 찾기
  const { data: passkey } = await supabase
    .from('passkey_credentials')
    .select('*')
    .eq('user_id', user.id)
    .eq('credential_id', response.id)
    .single()

  if (!passkey) {
    throw new Error('Passkey not found')
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: user.passkey_challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: passkey.credential_id,
      publicKey: Buffer.from(passkey.public_key, 'base64url'),
      counter: passkey.counter,
      transports: passkey.transports as AuthenticatorTransportFuture[] | undefined,
    },
  })

  if (!verification.verified) {
    throw new Error('Authentication failed')
  }

  // 카운터 업데이트 및 마지막 사용 시간 기록
  await supabase
    .from('passkey_credentials')
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', passkey.id)

  // 챌린지 삭제
  await supabase
    .from('users')
    .update({ passkey_challenge: null })
    .eq('id', user.id)

  return { verified: true, userId: user.id }
}

// Discoverable 패스키 인증 옵션 생성 (이메일 없이)
export async function createDiscoverableAuthenticationOptions(ip: string, userAgent: string) {
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [], // 빈 배열 = 브라우저가 저장된 패스키 중 선택
    userVerification: 'preferred',
  })

  // 챌린지를 임시 테이블에 저장 (5분 후 만료, IP+UA 바인딩 포함)
  await supabase
    .from('passkey_challenges')
    .insert({
      challenge: options.challenge,
      binding_hash: hashBinding(ip, userAgent),
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })

  return options
}

// Discoverable 패스키 인증 응답 검증 (이메일 없이)
export async function verifyDiscoverableAuthentication(
  response: AuthenticationResponseJSON,
  ip: string,
  userAgent: string
) {
  // credential_id로 패스키 찾기
  const { data: passkey } = await supabase
    .from('passkey_credentials')
    .select('*, users!inner(id, email, passkey_challenge)')
    .eq('credential_id', response.id)
    .single()

  if (!passkey) {
    throw new Error('Passkey not found')
  }

  // clientDataJSON에서 challenge 추출하여 검증
  const clientData = JSON.parse(
    Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf-8')
  )

  // 해당 챌린지가 유효한지 확인 (바인딩 해시도 함께 검증)
  const { data: validChallenge } = await supabase
    .from('passkey_challenges')
    .select('challenge, binding_hash')
    .eq('challenge', clientData.challenge)
    .gte('expires_at', new Date().toISOString())
    .single()

  if (!validChallenge) {
    throw new Error('Challenge expired or invalid')
  }

  // IP+UA 바인딩 검증
  if (validChallenge.binding_hash && validChallenge.binding_hash !== hashBinding(ip, userAgent)) {
    // 사용된 챌린지 삭제 (재사용 방지)
    await supabase
      .from('passkey_challenges')
      .delete()
      .eq('challenge', validChallenge.challenge)
    throw new Error('Challenge binding mismatch')
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: validChallenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: passkey.credential_id,
      publicKey: Buffer.from(passkey.public_key, 'base64url'),
      counter: passkey.counter,
      transports: passkey.transports as AuthenticatorTransportFuture[] | undefined,
    },
  })

  if (!verification.verified) {
    throw new Error('Authentication failed')
  }

  // 카운터 업데이트 및 마지막 사용 시간 기록
  await supabase
    .from('passkey_credentials')
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', passkey.id)

  // 사용한 챌린지 삭제
  await supabase
    .from('passkey_challenges')
    .delete()
    .eq('challenge', validChallenge.challenge)

  return { verified: true, userId: passkey.user_id }
}

// 패스키 삭제
export async function deletePasskey(userId: string, passkeyId: string) {
  const { error } = await supabase
    .from('passkey_credentials')
    .delete()
    .eq('id', passkeyId)
    .eq('user_id', userId)

  if (error) {
    throw new Error('Failed to delete passkey')
  }

  return true
}

// 패스키 이름 변경
export async function renamePasskey(userId: string, passkeyId: string, newName: string) {
  const { error } = await supabase
    .from('passkey_credentials')
    .update({ name: newName })
    .eq('id', passkeyId)
    .eq('user_id', userId)

  if (error) {
    throw new Error('Failed to rename passkey')
  }

  return true
}
