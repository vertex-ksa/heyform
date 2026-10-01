import * as assert from 'assert'
import mongoose from 'mongoose'
import { SubmissionModel, SubmissionSchema } from '../src/model/submission.model'
import { SubmissionService } from '../src/service/submission.service'

async function run() {
  const uri = process.env.TM_C_APPROVAL_MONGO_URI
  if (!uri || !uri.startsWith('mongodb://127.0.0.1:27119/tm_c_approval_')) {
    throw new Error('This test requires an explicitly isolated tm_c_approval database on port 27119')
  }
  const connection = mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10000 })
  try {
    await connection.asPromise()
  } catch (error) {
    await connection.close()
    throw error
  }
  try {
    const model = connection.model(SubmissionModel.name, SubmissionSchema)
    const service = new SubmissionService(model as any, {} as any, {} as any)
    const form = { id: 'f', teamId: 't' }
    const id = await service.create({ formId: 'f', title: 'Synthetic approval', formVersion: 3,
      formSnapshot: { fields: [{ id: 'answer', kind: 'short_text', title: 'Request' }] },
      answers: [{ id: 'answer', kind: 'short_text', title: 'Request', value: 'Original' }] })
    const request = await service.requestApproval(form, id, 'requester', ['reviewer1', 'reviewer2'], 'request1', 0)
    assert.strictEqual((await service.approvalStatus('f', id, 'requester')).revision, 1)
    await assert.rejects(() => service.approvalStatus('wrong-form', id, 'requester'))
    await assert.rejects(() => service.approvalStatus('f', id, 'outsider'))
    await assert.rejects(() => service.decideApproval('f', id, 'requester', {
      tenantId: 't', requestId: request.requestId, expectedRevision: 1, commandId: 'self', decision: 'APPROVE' }))
    await assert.rejects(() => service.decideApproval('f', id, 'reviewer1', {
      tenantId: 'wrong-tenant', requestId: request.requestId, expectedRevision: 1, commandId: 'wrong-tenant', decision: 'APPROVE' }))
    const results = await Promise.allSettled(['decision1', 'decision-race'].map(commandId =>
      service.decideApproval('f', id, 'reviewer1', { tenantId: 't', requestId: request.requestId, expectedRevision: 1, commandId, decision: 'APPROVE' })))
    assert.strictEqual(results.filter(result => result.status === 'fulfilled').length, 1)
    let status = await service.approvalStatus('f', id, 'requester')
    assert.strictEqual(status.approval.state, 'PENDING')
    assert.strictEqual(status.approval.audit.length, 1)
    const persistedCommand = status.approval.audit[0].commandId
    await service.decideApproval('f', id, 'reviewer1', { tenantId: 't', requestId: request.requestId,
      expectedRevision: 1, commandId: persistedCommand, decision: 'APPROVE' })
    assert.strictEqual((await service.approvalStatus('f', id, 'requester')).approval.audit.length, 1)
    await service.decideApproval('f', id, 'reviewer2', { tenantId: 't', requestId: request.requestId,
      expectedRevision: 2, commandId: 'final', decision: 'APPROVE' })
    status = await service.approvalStatus('f', id, 'requester')
    assert.strictEqual(status.approval.state, 'APPROVED')
    assert.strictEqual(status.approval.submissionRevision, 0)
    assert.strictEqual((await model.findById(id)).contentRevision, 0)
    await service.updateAnswer(id, { id: 'answer', kind: 'short_text', title: 'Request', value: 'Changed', properties: {} } as any)
    status = await service.approvalStatus('f', id, 'requester')
    assert.strictEqual(status.approval.state, 'INVALIDATED')
    assert.strictEqual(status.approval.audit.length, 2)
    assert.strictEqual((await model.findById(id)).contentRevision, 1)
    await assert.rejects(() => service.decideApproval('f', id, 'reviewer2', { tenantId: 't', requestId: request.requestId,
      expectedRevision: status.revision, commandId: 'changed-final', decision: 'APPROVE' }))
    const next = await service.requestApproval(form, id, 'requester', ['reviewer1'], 'request2', status.revision)
    assert.notStrictEqual(next.evidenceHash, request.evidenceHash)
    assert.strictEqual(next.submissionRevision, 1)
    const row = await model.findById(id)
    assert.strictEqual(row.approvalHistory.length, 1)
    await assert.rejects(() => service.requestApproval(form, id, 'requester', ['reviewer2'], 'request1', row.revision))
    const legacy = await service.create({ formId: 'f', title: 'Legacy', answers: [] })
    await assert.rejects(() => service.requestApproval(form, legacy, 'requester', ['reviewer1'], 'legacy', 0))
    await service.maskAsPrivate('f', [id])
    await assert.rejects(() => service.approvalStatus('f', id, 'requester', 't'))
    console.log('Real Mongo approval persistence passed: CAS race, replay, tenant object scope, two-step audit, immutable hash, edit invalidation, retained history, legacy denial')
  } finally {
    // The URI guard limits cleanup to a freshly named synthetic database in our isolated container.
    await connection.dropDatabase()
    await connection.close()
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
