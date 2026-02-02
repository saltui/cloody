import { supabase } from './supabase'

// Interfaces matching DB schema
export interface RetentionPolicy {
  id: string
  org_id: string
  name: string
  retention_days: number
  action: 'archive' | 'delete' | 'review'
  requires_approval: boolean
  created_at: string
  updated_at: string
}

export interface DisposalRequest {
  id: string
  photo_id: string
  policy_id: string
  requested_by: string
  requested_at: string
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'completed'
  approved_by?: string
  approved_at?: string
  rejected_by?: string
  rejected_at?: string
  completed_at?: string
  certificate_id?: string
}

export interface Photo {
  id: string
  org_id: string
  retention_policy_id?: string
  retention_expires_at?: string
  [key: string]: any
}

/**
 * Create a new retention policy
 */
export async function createPolicy(
  orgId: string,
  name: string,
  retentionDays: number,
  action: 'archive' | 'delete' | 'review',
  requiresApproval: boolean
): Promise<RetentionPolicy> {
  const { data, error } = await supabase
    .from('retention_policies')
    .insert({
      org_id: orgId,
      name,
      retention_days: retentionDays,
      action,
      requires_approval: requiresApproval
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Get all retention policies for an organization
 */
export async function getPolicies(orgId: string): Promise<RetentionPolicy[]> {
  const { data, error } = await supabase
    .from('retention_policies')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

/**
 * Apply a retention policy to a document and set expiration date
 */
export async function applyPolicyToDocument(
  photoId: string,
  policyId: string
): Promise<void> {
  // Get the policy to calculate expiration
  const { data: policy, error: policyError } = await supabase
    .from('retention_policies')
    .select('retention_days')
    .eq('id', policyId)
    .single()

  if (policyError) throw policyError

  // Calculate expiration date
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + policy.retention_days)

  // Update the photo
  const { error: updateError } = await supabase
    .from('photos')
    .update({
      retention_policy_id: policyId,
      retention_expires_at: expiresAt.toISOString()
    })
    .eq('id', photoId)

  if (updateError) throw updateError
}

/**
 * Get documents that will expire within a specified number of days
 */
export async function getExpiringDocuments(
  orgId: string,
  daysAhead: number
): Promise<Photo[]> {
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + daysAhead)

  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('org_id', orgId)
    .not('retention_expires_at', 'is', null)
    .lte('retention_expires_at', futureDate.toISOString())
    .order('retention_expires_at', { ascending: true })

  if (error) throw error
  return data || []
}

/**
 * Create a disposal request for a document
 */
export async function requestDisposal(
  photoId: string,
  requestedBy: string,
  reason: string
): Promise<DisposalRequest> {
  // Get the photo's policy
  const { data: photo, error: photoError } = await supabase
    .from('photos')
    .select('retention_policy_id')
    .eq('id', photoId)
    .single()

  if (photoError) throw photoError
  if (!photo.retention_policy_id) {
    throw new Error('Photo does not have a retention policy applied')
  }

  const { data, error } = await supabase
    .from('disposal_requests')
    .insert({
      photo_id: photoId,
      policy_id: photo.retention_policy_id,
      requested_by: requestedBy,
      reason,
      status: 'pending'
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Approve a disposal request
 */
export async function approveDisposal(
  requestId: string,
  approvedBy: string
): Promise<void> {
  const { error } = await supabase
    .from('disposal_requests')
    .update({
      status: 'approved',
      approved_by: approvedBy,
      approved_at: new Date().toISOString()
    })
    .eq('id', requestId)
    .eq('status', 'pending')

  if (error) throw error
}

/**
 * Reject a disposal request
 */
export async function rejectDisposal(
  requestId: string,
  rejectedBy: string
): Promise<void> {
  const { error } = await supabase
    .from('disposal_requests')
    .update({
      status: 'rejected',
      rejected_by: rejectedBy,
      rejected_at: new Date().toISOString()
    })
    .eq('id', requestId)
    .eq('status', 'pending')

  if (error) throw error
}

/**
 * Process expired documents according to their retention policies
 * This is a helper function for cron jobs
 */
export async function processExpiredDocuments(
  orgId: string
): Promise<{ archived: number; deleted: number; pending: number }> {
  const now = new Date().toISOString()

  // Get all expired documents with their policies
  const { data: expiredPhotos, error: fetchError } = await supabase
    .from('photos')
    .select(`
      id,
      retention_policy_id,
      retention_policies (
        id,
        action,
        requires_approval
      )
    `)
    .eq('org_id', orgId)
    .not('retention_expires_at', 'is', null)
    .lte('retention_expires_at', now)

  if (fetchError) throw fetchError

  let archived = 0
  let deleted = 0
  let pending = 0

  for (const photo of expiredPhotos || []) {
    const policy = photo.retention_policies as any

    if (!policy) continue

    if (policy.requires_approval) {
      // Check if there's an approved disposal request
      const { data: request, error: requestError } = await supabase
        .from('disposal_requests')
        .select('*')
        .eq('photo_id', photo.id)
        .eq('status', 'approved')
        .single()

      if (requestError || !request) {
        pending++
        continue
      }
    }

    // Execute the action
    if (policy.action === 'archive') {
      const { error: archiveError } = await supabase
        .from('photos')
        .update({ archived: true })
        .eq('id', photo.id)

      if (!archiveError) archived++
    } else if (policy.action === 'delete') {
      const { error: deleteError } = await supabase
        .from('photos')
        .delete()
        .eq('id', photo.id)

      if (!deleteError) deleted++
    } else if (policy.action === 'review') {
      pending++
    }
  }

  return { archived, deleted, pending }
}

/**
 * Generate a disposal certificate for a completed disposal request
 */
export async function generateDisposalCertificate(
  requestId: string
): Promise<{ certificateId: string; content: string }> {
  // Get the disposal request details
  const { data: request, error: requestError } = await supabase
    .from('disposal_requests')
    .select(`
      *,
      photos (
        id,
        filename,
        org_id
      ),
      retention_policies (
        name,
        action
      )
    `)
    .eq('id', requestId)
    .single()

  if (requestError) throw requestError

  if (request.status !== 'approved' && request.status !== 'completed') {
    throw new Error('Can only generate certificates for approved or completed requests')
  }

  // Generate certificate ID
  const certificateId = `CERT-${Date.now()}-${requestId.slice(0, 8)}`

  // Generate certificate content
  const photo = request.photos as any
  const policy = request.retention_policies as any

  const content = `
CERTIFICATE OF DISPOSAL
========================

Certificate ID: ${certificateId}
Date Issued: ${new Date().toISOString()}

Document Details:
- Document ID: ${photo.id}
- Filename: ${photo.filename}
- Organization ID: ${photo.org_id}

Retention Policy:
- Policy Name: ${policy.name}
- Action: ${policy.action}

Disposal Request:
- Request ID: ${requestId}
- Requested By: ${request.requested_by}
- Requested At: ${request.requested_at}
- Reason: ${request.reason}
- Approved By: ${request.approved_by}
- Approved At: ${request.approved_at}

This certifies that the above document has been disposed of in accordance
with the organization's retention policy and applicable regulations.

========================
`.trim()

  // Update the request with certificate information
  const { error: updateError } = await supabase
    .from('disposal_requests')
    .update({
      certificate_id: certificateId,
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', requestId)

  if (updateError) throw updateError

  return { certificateId, content }
}
