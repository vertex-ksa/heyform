/** Native opt-out rollback retains evidence and ordinary submission behavior. */
import * as assert from 'assert'
import { readFileSync } from 'fs'
import mongoose from 'mongoose'
import { E2EClient } from './helpers/client'
import { LOGIN_GQL, OPEN_FORM_GQL, COMPLETE_SUBMISSION_GQL, SUBMISSIONS_GQL } from './helpers/gql'

async function main() {
  const uri = process.env.TM_C_APPROVAL_MONGO_URI
  const fixturePath = process.env.TM_C_APPROVAL_FIXTURE_PATH
  if (!uri?.startsWith('mongodb://127.0.0.1:27119/tm_c_approval_') || !fixturePath?.startsWith('D:\\Technominds-Execution-Evidence-20261001\\C\\')) {
    throw new Error('Explicit isolated C database and fixture required')
  }
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8').replace(/^\uFEFF/, ''))
  const client = new E2EClient({ baseUrl: 'http://127.0.0.1:19158' })
  await client.gqlOk('login', LOGIN_GQL, { input: { email: fixture.owner.email, password: fixture.owner.password } })
  const conn = await mongoose.createConnection(uri!, { serverSelectionTimeoutMS: 10000 }).asPromise()
  try {
    const id = new mongoose.Types.ObjectId(fixture.submissionId)
    const before = await conn.collection('submissionmodels').findOne({ _id: id })
    assert.ok(before?.approval && before.formSnapshot, 'Existing immutable approval evidence must be present before rollback')
    const input = { formId: fixture.formId, submissionId: fixture.submissionId }
    const status = await client.gql('submissionApprovalStatus', `query submissionApprovalStatus($input:SubmissionApprovalStatusInput!){submissionApprovalStatus(input:$input)}`, { input })
    assert.match(status.errors[0]?.message || '', /not enabled/i)
    const request = await client.gql('requestSubmissionApproval', `mutation requestSubmissionApproval($input:RequestSubmissionApprovalInput!){requestSubmissionApproval(input:$input)}`,
      { input: { ...input, expectedRevision: before!.revision, commandId: 'disabled-request', reviewers: [fixture.reviewer1.id] } })
    assert.match(request.errors[0]?.message || '', /not enabled/i)
    const decision = await client.gql('decideSubmissionApproval', `mutation decideSubmissionApproval($input:DecideSubmissionApprovalInput!){decideSubmissionApproval(input:$input)}`,
      { input: { ...input, expectedRevision: before!.revision, commandId: 'disabled-decision', requestId: before!.approval.requestId, decision: 'APPROVE' } })
    assert.match(decision.errors[0]?.message || '', /not enabled/i)
    const respondent = new E2EClient({ baseUrl: 'http://127.0.0.1:19158' })
    const token = await respondent.gqlOk<string>('openForm', OPEN_FORM_GQL, { input: { formId: fixture.formId } })
    await respondent.gqlOk('completeSubmission', COMPLETE_SUBMISSION_GQL,
      { input: { formId: fixture.formId, answers: { request: 'Native opt-out ordinary submit' }, hiddenFields: [], openToken: token } })
    const list = await client.gqlOk<any>('submissions', SUBMISSIONS_GQL, { input: { formId: fixture.formId } })
    assert.ok(list.total >= 3, 'Ordinary native submission/listing remains available with approval off')
    const after = await conn.collection('submissionmodels').findOne({ _id: id })
    assert.strictEqual(JSON.stringify(after), JSON.stringify(before), 'Flag rollback must retain exact source and approval audit data')
    console.log('Native flag rollback PASS: real login, all approval entry points denied, ordinary submission/listing works, exact immutable approval/snapshot/audit retained')
  } finally { await conn.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

