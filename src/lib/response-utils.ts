import { NextResponse } from 'next/server'
import { ErrorCode, ERROR_STATUS, ERROR_MESSAGE } from './errors'

export function errorResponse(
  code: ErrorCode,
  message?: string,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    { error: message || ERROR_MESSAGE[code], ...extra },
    { status: ERROR_STATUS[code] }
  )
}

export function successResponse(data?: Record<string, unknown>): NextResponse {
  return NextResponse.json(data ?? { success: true })
}
