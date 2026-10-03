import { approvalEvidenceHash, SubmissionApproval } from './approval'

/** Exact persisted command lookup. Never derives a command outcome from aggregate approval state. */
export function reconcileApprovalCommand(approvals: SubmissionApproval[], tenantId: string, formId: string,
  submissionId: string, actorId: string, input: any, revision: number) {
  const matches = approvals.filter(a => a.commandId === input.commandId || a.audit.some(e => e.commandId === input.commandId))
  if (matches.length > 1) return { state: 'unresolved' }
  if (!matches.length) return { state: revision === input.expectedRevision ? 'not_found' : 'stale' }
  const receipt = matches[0]
  if (receipt.tenantId !== tenantId || receipt.formId !== formId || receipt.submissionId !== submissionId) return { state: 'unresolved' }
  if (input.action === 'REQUEST') {
    if (receipt.commandId !== input.commandId || receipt.requesterId !== actorId || !Array.isArray(input.reviewers) ||
      receipt.commandHash !== approvalEvidenceHash({ reviewers: input.reviewers, revision: input.expectedRevision })) return { state: 'unresolved' }
  } else if (input.action === 'DECIDE') {
    const event = receipt.audit.find(e => e.commandId === input.commandId)
    if (receipt.requestId !== input.requestId || !event || event.actorId !== actorId || event.decision !== input.decision ||
      event.reason !== (input.reason || '').trim() || event.commandRevision !== input.expectedRevision) return { state: 'unresolved' }
  } else return { state: 'unresolved' }
  return { state: 'acknowledged', receipt, commandRevision: input.expectedRevision }
}
