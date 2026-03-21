export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  INVALID_INPUT = 'INVALID_INPUT',
  NOT_FOUND = 'NOT_FOUND',
  FORBIDDEN = 'FORBIDDEN',
  STORAGE_LIMIT = 'STORAGE_LIMIT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export const ERROR_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.SESSION_EXPIRED]: 401,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INVALID_INPUT]: 400,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.STORAGE_LIMIT]: 403,
  [ErrorCode.INTERNAL_ERROR]: 500,
}

export const ERROR_MESSAGE: Record<ErrorCode, string> = {
  [ErrorCode.UNAUTHORIZED]: '인증이 필요합니다',
  [ErrorCode.SESSION_EXPIRED]: '세션이 만료되었습니다',
  [ErrorCode.RATE_LIMITED]: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요',
  [ErrorCode.INVALID_INPUT]: '잘못된 입력입니다',
  [ErrorCode.NOT_FOUND]: '찾을 수 없습니다',
  [ErrorCode.FORBIDDEN]: '권한이 없습니다',
  [ErrorCode.STORAGE_LIMIT]: '저장 공간이 부족합니다',
  [ErrorCode.INTERNAL_ERROR]: '서버 오류가 발생했습니다',
}
