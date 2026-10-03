import * as assert from 'assert'
import { approvalEvidenceHash, createSubmissionApproval, decideSubmissionApproval } from '../src/utils/approval'

const snapshot = { formVersion: 1, answers: [{ id: 'a', value: 1.25 }] }
const original = createSubmissionApproval({ tenantId: 't', formId: 'f', submissionId: 's', submissionRevision: 0,
  formVersion: 1, snapshot, requesterId: 'requester', reviewers: ['reviewer1', 'reviewer2'], commandId: 'request', commandRevision: 0 })
const command = { actorId: 'reviewer1', commandId: 'decide1', decision: 'APPROVE' as const,
  currentEvidenceHash: original.evidenceHash, currentMember: true }
assert.strictEqual(approvalEvidenceHash({ a: 1, b: 2 }), approvalEvidenceHash({ b: 2, a: 1 }))
assert.notStrictEqual(approvalEvidenceHash(1.25), approvalEvidenceHash('1.25'))
assert.throws(() => approvalEvidenceHash(NaN))
assert.throws(() => createSubmissionApproval({ ...original, snapshot, commandRevision: 0, reviewers: ['requester'] }))
assert.throws(() => decideSubmissionApproval(original, { ...command, actorId: 'requester' }), /FORBIDDEN/)
assert.throws(() => decideSubmissionApproval(original, { ...command, actorId: 'outsider' }), /FORBIDDEN/)
assert.throws(() => decideSubmissionApproval(original, { ...command, currentMember: false }), /FORBIDDEN/)
assert.throws(() => decideSubmissionApproval({ ...original, expiresAt: new Date(0).toISOString() }, command), /EXPIRED/)
assert.throws(() => decideSubmissionApproval(original, { ...command, currentEvidenceHash: approvalEvidenceHash({ changed: true }) }), /INVALIDATED/)
assert.throws(() => decideSubmissionApproval(original, { ...command, actorId: 'reviewer2' }), /VERSION_CONFLICT/)
const intermediate = decideSubmissionApproval(original, command)
assert.strictEqual(intermediate.state, 'PENDING')
assert.strictEqual(original.audit.length, 0)
assert.strictEqual(decideSubmissionApproval(intermediate, command), intermediate)
assert.throws(() => decideSubmissionApproval(intermediate, { ...command, reason: 'changed' }), /COMMAND_CONFLICT/)
const final = decideSubmissionApproval(intermediate, { ...command, actorId: 'reviewer2', commandId: 'decide2' })
assert.strictEqual(final.state, 'APPROVED')
assert.strictEqual(final.audit.length, 2)
assert.throws(() => decideSubmissionApproval(final, { ...command, commandId: 'decide3' }), /VERSION_CONFLICT/)
assert.throws(() => decideSubmissionApproval(original, { ...command, decision: 'REJECT' }), /INVALID_REASON/)
assert.strictEqual(decideSubmissionApproval(original, { ...command, decision: 'REJECT', reason: 'Please correct the date' }).state, 'REJECTED')
console.log('Approval domain tests passed')
