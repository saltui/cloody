'use client'

import { createContext, useContext, useCallback, useRef, useMemo, ReactNode } from 'react'
import { supabase } from './supabase'

interface Photo {
  id: string
  url: string
  thumbnail_url: string | null
  name: string
  folder_id: string | null
  user_id: string
  order: number
  created_at: string
  // Video metadata
  file_type?: string
  file_size?: number
  is_video?: boolean
  duration?: number
  width?: number
  height?: number
  hls_url?: string
  hls_status?: 'not_applicable' | 'pending' | 'processing' | 'ready' | 'failed'
}

interface Folder {
  id: string
  name: string
  parent_id: string | null
  user_id: string
  created_at: string
}

interface CacheEntry<T> {
  data: T
  timestamp: number
  userId: string
}

export interface PaginatedResult<T> {
  data: T[]
  hasMore: boolean
  nextCursor: number
}

export type CategoryFilter = 'all' | 'photos' | 'videos' | 'documents'

interface DataCacheContextType {
  // 폴더 관련
  getFolders: (userId: string) => Promise<Folder[]>
  getFoldersByParent: (userId: string, parentId: string | null) => Promise<Folder[]>
  invalidateFolders: () => void

  // 사진 관련
  getPhotos: (userId: string, folderId: string | null) => Promise<Photo[]>
  getAllPhotos: (userId: string) => Promise<Photo[]>
  invalidatePhotos: (folderId?: string | null) => void

  // 페이지네이션 사진 (무한스크롤용)
  getPhotosPaginated: (
    userId: string,
    options: {
      category?: CategoryFilter
      folderId?: string | null
      cursor?: number
      limit?: number
    }
  ) => Promise<PaginatedResult<Photo>>

  // 전체 캐시 무효화
  invalidateAll: () => void

  // 프리페치
  prefetchFolder: (userId: string, folderId: string | null) => void
}

const CACHE_TTL = 5 * 60 * 1000 // 5분

const DataCacheContext = createContext<DataCacheContextType | null>(null)

export function DataCacheProvider({ children }: { children: ReactNode }) {
  // 캐시 저장소
  const foldersCache = useRef<CacheEntry<Folder[]> | null>(null)
  const photosCache = useRef<Map<string, CacheEntry<Photo[]>>>(new Map())
  const allPhotosCache = useRef<CacheEntry<Photo[]> | null>(null)

  // 진행 중인 요청 추적 (중복 요청 방지)
  const pendingRequests = useRef<Map<string, Promise<unknown>>>(new Map())

  const isCacheValid = <T,>(cache: CacheEntry<T> | null | undefined, userId: string): cache is CacheEntry<T> => {
    if (!cache) return false
    if (cache.userId !== userId) return false
    return Date.now() - cache.timestamp < CACHE_TTL
  }

  // 폴더 전체 가져오기 (캐시 우선)
  const getFolders = useCallback(async (userId: string): Promise<Folder[]> => {
    // 캐시 확인
    if (isCacheValid(foldersCache.current, userId)) {
      return foldersCache.current.data
    }

    // 진행 중인 요청 확인
    const pendingKey = `folders-${userId}`
    const pending = pendingRequests.current.get(pendingKey)
    if (pending) {
      return pending as Promise<Folder[]>
    }

    // 새 요청
    const request = (async () => {
      const { data } = await supabase
        .from('folders')
        .select('*')
        .eq('user_id', userId)
        .is('deleted_at', null) // 휴지통 제외
        .order('created_at', { ascending: true })

      const folders = (data || []) as Folder[]
      foldersCache.current = { data: folders, timestamp: Date.now(), userId }
      pendingRequests.current.delete(pendingKey)
      return folders
    })()

    pendingRequests.current.set(pendingKey, request)
    return request
  }, [])

  // 특정 부모의 하위 폴더 가져오기
  const getFoldersByParent = useCallback(async (userId: string, parentId: string | null): Promise<Folder[]> => {
    const allFolders = await getFolders(userId)
    return allFolders.filter(f =>
      parentId ? f.parent_id === parentId : f.parent_id === null
    )
  }, [getFolders])

  // 특정 폴더의 사진 가져오기
  const getPhotos = useCallback(async (userId: string, folderId: string | null): Promise<Photo[]> => {
    const cacheKey = folderId || 'root'
    const cached = photosCache.current.get(cacheKey)

    if (isCacheValid(cached, userId)) {
      return cached.data
    }

    const pendingKey = `photos-${cacheKey}-${userId}`
    const pending = pendingRequests.current.get(pendingKey)
    if (pending) {
      return pending as Promise<Photo[]>
    }

    const request = (async () => {
      let query = supabase
        .from('photos')
        .select('*')
        .eq('user_id', userId)
        .is('deleted_at', null) // 휴지통 제외
        .order('order', { ascending: true })
        .order('id', { ascending: true }) // 보조 정렬: 일관된 순서 보장

      if (folderId) {
        query = query.eq('folder_id', folderId)
      } else {
        query = query.is('folder_id', null)
      }

      const { data } = await query
      const photos = (data || []) as Photo[]

      photosCache.current.set(cacheKey, { data: photos, timestamp: Date.now(), userId })
      pendingRequests.current.delete(pendingKey)
      return photos
    })()

    pendingRequests.current.set(pendingKey, request)
    return request
  }, [])

  // 전체 사진 가져오기 (카테고리 필터용)
  const getAllPhotos = useCallback(async (userId: string): Promise<Photo[]> => {
    if (isCacheValid(allPhotosCache.current, userId)) {
      return allPhotosCache.current.data
    }

    const pendingKey = `all-photos-${userId}`
    const pending = pendingRequests.current.get(pendingKey)
    if (pending) {
      return pending as Promise<Photo[]>
    }

    const request = (async () => {
      const allPhotos: Photo[] = []
      let from = 0
      const pageSize = 1000

      while (true) {
        const { data: pageData } = await supabase
          .from('photos')
          .select('*')
          .eq('user_id', userId)
          .is('deleted_at', null) // 휴지통 제외
          .order('order', { ascending: false }) // 최신순 (getPhotosPaginated와 동일)
          .order('id', { ascending: false }) // 보조 정렬: 일관된 순서 보장
          .range(from, from + pageSize - 1)

        if (!pageData || pageData.length === 0) break
        allPhotos.push(...(pageData as Photo[]))
        if (pageData.length < pageSize) break
        from += pageSize
      }

      // 중복 제거
      const uniquePhotos = [...new Map(allPhotos.map(p => [p.id, p])).values()]
      allPhotosCache.current = { data: uniquePhotos, timestamp: Date.now(), userId }
      pendingRequests.current.delete(pendingKey)
      return uniquePhotos
    })()

    pendingRequests.current.set(pendingKey, request)
    return request
  }, [])

  // 캐시 무효화
  const invalidateFolders = useCallback(() => {
    foldersCache.current = null
  }, [])

  const invalidatePhotos = useCallback((folderId?: string | null) => {
    if (folderId === undefined) {
      photosCache.current.clear()
      allPhotosCache.current = null
    } else {
      const cacheKey = folderId || 'root'
      photosCache.current.delete(cacheKey)
      allPhotosCache.current = null // 전체 캐시도 무효화
    }
  }, [])

  const invalidateAll = useCallback(() => {
    foldersCache.current = null
    photosCache.current.clear()
    allPhotosCache.current = null
  }, [])

  // 프리페치 (백그라운드에서 데이터 로드)
  const prefetchFolder = useCallback((userId: string, folderId: string | null) => {
    // 이미 캐시되어 있으면 스킵
    const cacheKey = folderId || 'root'
    if (isCacheValid(photosCache.current.get(cacheKey), userId)) {
      return
    }

    // 백그라운드에서 조용히 로드
    getPhotos(userId, folderId).catch(() => {})
  }, [getPhotos])

  // 페이지네이션 사진 가져오기 (무한스크롤용)
  const getPhotosPaginated = useCallback(async (
    userId: string,
    options: {
      category?: CategoryFilter
      folderId?: string | null
      cursor?: number
      limit?: number
    }
  ): Promise<PaginatedResult<Photo>> => {
    const { category = 'all', folderId, cursor = 0, limit = 40 } = options

    // Supabase range는 inclusive이므로 limit개를 가져오려면 cursor ~ cursor+limit-1
    // hasMore 체크를 위해 1개 더 요청 (limit+1개)
    let query = supabase
      .from('photos')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null) // 휴지통 제외
      .order('order', { ascending: false })
      .order('id', { ascending: false }) // 보조 정렬: 일관된 순서 보장
      .range(cursor, cursor + limit)

    // 폴더 필터
    if (folderId !== undefined) {
      if (folderId) {
        query = query.eq('folder_id', folderId)
      } else {
        query = query.is('folder_id', null)
      }
    }

    // 카테고리 필터 (DB에서 직접 필터링)
    if (category === 'photos') {
      // 사진: 비디오가 아니거나 NULL이고, file_type이 image/로 시작하거나 NULL인 것
      // 기존 데이터 호환성을 위해 NULL도 포함
      query = query
        .or('is_video.eq.false,is_video.is.null')
        .or('file_type.like.image/%,file_type.is.null')
    } else if (category === 'videos') {
      query = query.eq('is_video', true)
    } else if (category === 'documents') {
      // 문서: 비디오가 아니고 file_type이 image/로 시작하지 않는 것
      query = query.eq('is_video', false).not('file_type', 'like', 'image/%')
    }

    const { data, error } = await query

    if (error) {
      console.error('getPhotosPaginated error:', error)
      return { data: [], hasMore: false, nextCursor: cursor }
    }

    const photos = (data || []) as Photo[]
    const hasMore = photos.length > limit
    const resultPhotos = hasMore ? photos.slice(0, limit) : photos

    return {
      data: resultPhotos,
      hasMore,
      nextCursor: cursor + resultPhotos.length,
    }
  }, [])

  // Context value를 useMemo로 안정화 (불필요한 리렌더 방지)
  const contextValue = useMemo(() => ({
    getFolders,
    getFoldersByParent,
    invalidateFolders,
    getPhotos,
    getAllPhotos,
    invalidatePhotos,
    getPhotosPaginated,
    invalidateAll,
    prefetchFolder,
  }), [
    getFolders,
    getFoldersByParent,
    invalidateFolders,
    getPhotos,
    getAllPhotos,
    invalidatePhotos,
    getPhotosPaginated,
    invalidateAll,
    prefetchFolder,
  ])

  return (
    <DataCacheContext.Provider value={contextValue}>
      {children}
    </DataCacheContext.Provider>
  )
}

export function useDataCache() {
  const context = useContext(DataCacheContext)
  if (!context) {
    throw new Error('useDataCache must be used within DataCacheProvider')
  }
  return context
}
