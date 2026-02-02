import { supabase } from './supabase'

/**
 * Document version interface matching the database schema
 */
export interface DocumentVersion {
  id: string
  photo_id: string
  version_number: number
  url: string
  file_size: number
  file_hash: string
  changed_by: string
  change_reason?: string
  created_at: string
  is_current: boolean
}

/**
 * Create a new version for a document
 * @param photoId - The ID of the photo/document
 * @param url - The R2 URL of the version
 * @param fileSize - Size of the file in bytes
 * @param fileHash - Hash of the file content
 * @param changedBy - User ID who created this version
 * @param changeReason - Optional reason for the change
 * @returns The created DocumentVersion
 */
export async function createVersion(
  photoId: string,
  url: string,
  fileSize: number,
  fileHash: string,
  changedBy: string,
  changeReason?: string
): Promise<DocumentVersion> {
  // Get the current max version number
  const { data: maxVersion } = await supabase
    .from('document_versions')
    .select('version_number')
    .eq('photo_id', photoId)
    .order('version_number', { ascending: false })
    .limit(1)
    .single()

  const nextVersionNumber = (maxVersion?.version_number || 0) + 1

  // Mark all existing versions as not current
  await supabase
    .from('document_versions')
    .update({ is_current: false })
    .eq('photo_id', photoId)
    .eq('is_current', true)

  // Create the new version
  const { data, error } = await supabase
    .from('document_versions')
    .insert({
      photo_id: photoId,
      version_number: nextVersionNumber,
      url,
      file_size: fileSize,
      file_hash: fileHash,
      changed_by: changedBy,
      change_reason: changeReason,
      is_current: true,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create version: ${error.message}`)
  }

  return data as DocumentVersion
}

/**
 * Get all versions for a document, ordered by version number descending
 * @param photoId - The ID of the photo/document
 * @returns Array of DocumentVersion objects
 */
export async function getVersions(photoId: string): Promise<DocumentVersion[]> {
  const { data, error } = await supabase
    .from('document_versions')
    .select('*')
    .eq('photo_id', photoId)
    .order('version_number', { ascending: false })

  if (error) {
    throw new Error(`Failed to get versions: ${error.message}`)
  }

  return (data || []) as DocumentVersion[]
}

/**
 * Get a specific version of a document
 * @param photoId - The ID of the photo/document
 * @param versionNumber - The version number to retrieve
 * @returns The DocumentVersion or null if not found
 */
export async function getVersion(
  photoId: string,
  versionNumber: number
): Promise<DocumentVersion | null> {
  const { data, error } = await supabase
    .from('document_versions')
    .select('*')
    .eq('photo_id', photoId)
    .eq('version_number', versionNumber)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null
    }
    throw new Error(`Failed to get version: ${error.message}`)
  }

  return data as DocumentVersion
}

/**
 * Get the current version of a document
 * @param photoId - The ID of the photo/document
 * @returns The current DocumentVersion or null if no versions exist
 */
export async function getCurrentVersion(photoId: string): Promise<DocumentVersion | null> {
  const { data, error } = await supabase
    .from('document_versions')
    .select('*')
    .eq('photo_id', photoId)
    .eq('is_current', true)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null
    }
    throw new Error(`Failed to get current version: ${error.message}`)
  }

  return data as DocumentVersion
}

/**
 * Restore a previous version by creating a new version from it
 * @param photoId - The ID of the photo/document
 * @param versionNumber - The version number to restore
 * @param restoredBy - User ID who is restoring the version
 */
export async function restoreVersion(
  photoId: string,
  versionNumber: number,
  restoredBy: string
): Promise<void> {
  // Get the version to restore
  const versionToRestore = await getVersion(photoId, versionNumber)

  if (!versionToRestore) {
    throw new Error(`Version ${versionNumber} not found for photo ${photoId}`)
  }

  // Create a new version with the same content but new version number
  await createVersion(
    photoId,
    versionToRestore.url,
    versionToRestore.file_size,
    versionToRestore.file_hash,
    restoredBy,
    `Restored from version ${versionNumber}`
  )

  // Update the photos table to point to the restored URL
  const { error: updateError } = await supabase
    .from('photos')
    .update({ url: versionToRestore.url })
    .eq('id', photoId)

  if (updateError) {
    throw new Error(`Failed to update photo URL: ${updateError.message}`)
  }
}

/**
 * Delete old versions, keeping only the most recent N versions
 * @param photoId - The ID of the photo/document
 * @param keepCount - Number of recent versions to keep
 */
export async function deleteOldVersions(photoId: string, keepCount: number): Promise<void> {
  // Get all versions for this photo
  const versions = await getVersions(photoId)

  if (versions.length <= keepCount) {
    // Nothing to delete
    return
  }

  // Identify versions to delete (oldest ones beyond keepCount)
  const versionsToDelete = versions.slice(keepCount)
  const idsToDelete = versionsToDelete.map(v => v.id)

  if (idsToDelete.length === 0) {
    return
  }

  // Delete the old versions
  const { error } = await supabase
    .from('document_versions')
    .delete()
    .in('id', idsToDelete)

  if (error) {
    throw new Error(`Failed to delete old versions: ${error.message}`)
  }

  // Note: This does not delete the actual files from R2
  // That should be handled by a separate cleanup job
}

/**
 * Get version history with user information
 * @param photoId - The ID of the photo/document
 * @returns Array of versions with user details
 */
export async function getVersionHistory(photoId: string): Promise<
  Array<DocumentVersion & { user_email?: string; user_name?: string }>
> {
  const { data, error } = await supabase
    .from('document_versions')
    .select(`
      *,
      users!document_versions_changed_by_fkey (
        email,
        name
      )
    `)
    .eq('photo_id', photoId)
    .order('version_number', { ascending: false })

  if (error) {
    throw new Error(`Failed to get version history: ${error.message}`)
  }

  return (data || []).map(version => ({
    ...version,
    user_email: version.users?.email,
    user_name: version.users?.name,
  })) as Array<DocumentVersion & { user_email?: string; user_name?: string }>
}

/**
 * Check if a version is the current one
 * @param photoId - The ID of the photo/document
 * @param versionNumber - The version number to check
 * @returns true if this is the current version
 */
export async function isCurrentVersion(photoId: string, versionNumber: number): Promise<boolean> {
  const currentVersion = await getCurrentVersion(photoId)
  return currentVersion?.version_number === versionNumber
}
