import { createHash, randomUUID } from 'crypto'

export type ApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'INVALIDATED'
export interface SubmissionApproval {
  contractVersion: 'C03/1'
  requestId: string
  environment: 'LOCAL'
  tenantId: string
  formId: string
  submissionId: string
  submissionRevision: number
  formVersion: number
  evidenceHash: string
  policyVersion: 'heyform-sequential/1'
  requesterId: string
  reviewers: string[]
  step: number
  state: ApprovalState
  commandId: string
  commandHash: string
  expiresAt: string
  audit: Array<{ eventId: string; commandId: string; actorId: string; decision: string; reason: string; at: string }>
}

// Typed scalars keep numeric answers distinct from strings and permit exact decimal text in
// the canonical C03 subset. Object key order is stable; array order remains significant.
function typedValue(value: unknown): unknown {
  if (value === null) return ['null']
  if (typeof value === 'string') return ['string', value]
  if (typeof value === 'boolean') return ['boolean', value]
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid numeric evidence')
    return ['number', Object.is(value, -0) ? '-0' : String(value)]
  }
  if (Array.isArray(value)) return ['array', value.map(typedValue)]
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return ['object', Object.keys(value).sort().filter(key => (value as any)[key] !== undefined)
      .map(key => [key, typedValue((value as any)[key])])]
  }
  throw new Error('Invalid evidence value')
}

export function approvalEvidenceHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(typedValue(value)), 'utf8').digest('hex')
}

export function publishedFormSnapshot(form: any) {
  const values = typeof form.toObject === 'function' ? form.toObject({ flattenMaps: true }) : form
  return { fields: values.fields, hiddenFields: values.hiddenFields, logics: values.logics,
    variables: values.variables, translations: values.translations }
}

export function createSubmissionApproval(input: {
  tenantId: string; formId: string; submissionId: string; submissionRevision: number;
  formVersion: number; snapshot: unknown; requesterId: string; reviewers: string[]; commandId: string; commandRevision: number
}): SubmissionApproval {
  if (!input.commandId || input.commandId.length > 128 || input.reviewers.length < 1 || input.reviewers.length > 2 ||
      new Set(input.reviewers).size !== input.reviewers.length || input.reviewers.includes(input.requesterId) ||
      input.reviewers.some(id => !id || id.length > 128)) throw new Error('Invalid independent-reviewer policy')
  const { snapshot, commandRevision, ...binding } = input
  return { ...binding, contractVersion: 'C03/1', environment: 'LOCAL', requestId: randomUUID(),
    evidenceHash: approvalEvidenceHash(snapshot), policyVersion: 'heyform-sequential/1',
    commandHash: approvalEvidenceHash({ reviewers: input.reviewers, revision: commandRevision }),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    step: 0, state: 'PENDING', audit: [] }
}

export function decideSubmissionApproval(approval: SubmissionApproval, input: {
  actorId: string; commandId: string; decision: 'APPROVE' | 'REJECT'; reason?: string;
  currentEvidenceHash: string; currentMember: boolean
}): SubmissionApproval {
  if (!input.currentMember || !approval.reviewers.includes(input.actorId) || input.actorId === approval.requesterId)
    throw new Error('FORBIDDEN')
  if (input.currentEvidenceHash !== approval.evidenceHash) throw new Error('INVALIDATED')
  if (Date.parse(approval.expiresAt) <= Date.now()) throw new Error('EXPIRED')
  if (!input.commandId || input.commandId.length > 128 || !['APPROVE', 'REJECT'].includes(input.decision))
    throw new Error('INVALID_COMMAND')
  const reason = (input.reason || '').trim()
  if (reason.length > 500 || (input.decision === 'REJECT' && !reason)) throw new Error('INVALID_REASON')
  const replay = approval.audit.find(event => event.commandId === input.commandId)
  if (replay) {
    if (replay.actorId !== input.actorId || replay.decision !== input.decision || replay.reason !== reason)
      throw new Error('COMMAND_CONFLICT')
    return approval
  }
  if (approval.state !== 'PENDING' || approval.reviewers[approval.step] !== input.actorId)
    throw new Error('VERSION_CONFLICT')
  const step = input.decision === 'APPROVE' ? approval.step + 1 : approval.step
  return { ...approval, step,
    state: input.decision === 'REJECT' ? 'REJECTED' : step === approval.reviewers.length ? 'APPROVED' : 'PENDING',
    audit: [...approval.audit, { eventId: randomUUID(), commandId: input.commandId, actorId: input.actorId,
      decision: input.decision, reason, at: new Date().toISOString() }] }
}
