/** Isolated native HTTP/GraphQL acceptance; no external providers or dispatch. */
import * as assert from 'assert'
import { writeFileSync } from 'fs'
import mongoose from 'mongoose'
import { E2EClient } from './helpers/client'
import { signUpUser } from './helpers/fixtures'
import { seedProjectMember, seedTeamMember } from './helpers/seed'
import { CREATE_TEAM_GQL, TEAMS_GQL, CREATE_FORM_GQL, FORM_DETAIL_GQL, UPDATE_FORM_SCHEMAS_GQL,
  PUBLISH_FORM_GQL, OPEN_FORM_GQL, COMPLETE_SUBMISSION_GQL, SUBMISSIONS_GQL, UPDATE_SUBMISSION_ANSWER_GQL } from './helpers/gql'

async function main() {
  const base = process.env.TM_C_APPROVAL_API_URL
  const uri = process.env.TM_C_APPROVAL_MONGO_URI
  if (base !== 'http://127.0.0.1:19157' || !uri?.startsWith('mongodb://127.0.0.1:27119/tm_c_approval_')) {
    throw new Error('Explicit isolated C API/Mongo endpoints required')
  }
  const run = Date.now()
  const owner = await signUpUser(base, { name: 'C Synthetic Requester', email: `c-owner-${run}@example.test` })
  const reviewer1 = await signUpUser(base, { name: 'C Synthetic Reviewer 1', email: `c-review1-${run}@example.test` })
  const reviewer2 = await signUpUser(base, { name: 'C Synthetic Reviewer 2', email: `c-review2-${run}@example.test` })
  const outsider = await signUpUser(base, { name: 'C Synthetic Outsider', email: `c-outside-${run}@example.test` })
  const teamId = await owner.client.gqlOk<string>('createTeam', CREATE_TEAM_GQL,
    { input: { name: 'C Synthetic Approval Workspace', projectName: 'C Synthetic Approval Project' } })
  const teams = await owner.client.gqlOk<any[]>('teams', TEAMS_GQL)
  const projectId = teams.find(t => t.id === teamId).projects[0].id
  for (const actor of [reviewer1, reviewer2]) {
    await seedTeamMember({ teamId, memberId: actor.id, role: 2 }, { mongoUri: uri })
    await seedProjectMember({ projectId, memberId: actor.id }, { mongoUri: uri })
  }
  const formId = await owner.client.gqlOk<string>('createForm', CREATE_FORM_GQL,
    { input: { projectId, name: 'Synthetic two-step request', interactiveMode: 1, kind: 1 } })
  const detail = await owner.client.gqlOk<any>('formDetail', FORM_DETAIL_GQL, { input: { formId } })
  const drafts = [{ id: 'request', kind: 'short_text', title: ['What needs review?'], validations: { required: false } },
    { id: 'thanks', kind: 'thank_you', title: ['Saved'], validations: { required: false } }]
  const updated = await owner.client.gqlOk<any>('updateFormSchemas', UPDATE_FORM_SCHEMAS_GQL,
    { input: { formId, drafts, version: detail.version } })
  await owner.client.gqlOk('publishForm', PUBLISH_FORM_GQL, { input: { formId, drafts, version: updated.version } })
  const respondent = new E2EClient({ baseUrl: base })
  const published = await respondent.gqlOk<any>('publicForm', `query publicForm($input:FormDetailInput!){publicForm(input:$input){id version schemaHash}}`, { input: { formId } })
  const openToken = await respondent.gqlOk<string>('openForm', OPEN_FORM_GQL,
    { input: { formId, version: published.version, schemaHash: published.schemaHash } })
  await respondent.gqlOk('completeSubmission', COMPLETE_SUBMISSION_GQL,
    { input: { formId, answers: { request: 'Synthetic material request' }, hiddenFields: [], openToken } })
  const staleToken = await respondent.gqlOk<string>('openForm', OPEN_FORM_GQL,
    { input: { formId, version: published.version, schemaHash: published.schemaHash } })
  const changedDrafts = drafts.map(field => field.id === 'request' ? { ...field, title: ['Changed at identical version'] } : field)
  await owner.client.gqlOk('publishForm', PUBLISH_FORM_GQL,
    { input: { formId, drafts: changedDrafts, version: published.version } })
  assert.ok((await respondent.gql('completeSubmission', COMPLETE_SUBMISSION_GQL,
    { input: { formId, answers: { request: 'Stale displayed schema' }, hiddenFields: [], openToken: staleToken } })).errors.length,
    'Same-version material schema change must reject stale displayed token')
  await owner.client.gqlOk('publishForm', PUBLISH_FORM_GQL,
    { input: { formId, drafts, version: published.version } })
  const listed = await owner.client.gqlOk<any>('submissions', SUBMISSIONS_GQL, { input: { formId } })
  assert.strictEqual(listed.total, 1, 'Stale displayed-schema rejection must not create a submission')
  const submissionId = listed.submissions[0].id
  const statusGql = `query submissionApprovalStatus($input:SubmissionApprovalStatusInput!){submissionApprovalStatus(input:$input)}`
  const requestGql = `mutation requestSubmissionApproval($input:RequestSubmissionApprovalInput!){requestSubmissionApproval(input:$input)}`
  const decideGql = `mutation decideSubmissionApproval($input:DecideSubmissionApprovalInput!){decideSubmissionApproval(input:$input)}`
  const statusInput = { formId, submissionId }
  assert.ok((await outsider.client.gql('submissionApprovalStatus', statusGql, { input: statusInput })).errors.length)
  assert.ok((await respondent.gql('submissionApprovalStatus', statusGql, { input: statusInput })).errors.length)
  assert.ok((await owner.client.gql('requestSubmissionApproval', requestGql, { input: { ...statusInput, expectedRevision: 0, commandId: 'self-request', reviewers: [owner.id] } })).errors.length)
  const requestInput = { ...statusInput, expectedRevision: 0, commandId: 'request-1', reviewers: [reviewer1.id, reviewer2.id] }
  const requested = await owner.client.gqlOk<any>('requestSubmissionApproval', requestGql, { input: requestInput })
  assert.deepStrictEqual(requested, await owner.client.gqlOk('requestSubmissionApproval', requestGql, { input: requestInput }))
  const status = await owner.client.gqlOk<any>('submissionApprovalStatus', statusGql, { input: statusInput })
  const requestId = status.approval.requestId
  await seedTeamMember({ teamId, memberId: outsider.id, role: 2 }, { mongoUri: uri })
  await seedProjectMember({ projectId, memberId: outsider.id }, { mongoUri: uri })
  assert.ok((await outsider.client.gql('submissionApprovalStatus', statusGql, { input: statusInput })).errors.length,
    'Current project member outside requester/reviewer scope must not read approval evidence')
  const decisionInput = { ...statusInput, expectedRevision: 1, commandId: 'review-1', requestId, decision: 'APPROVE' }
  assert.ok((await owner.client.gql('decideSubmissionApproval', decideGql, { input: decisionInput })).errors.length)
  assert.ok((await reviewer2.client.gql('decideSubmissionApproval', decideGql, { input: decisionInput })).errors.length)
  const first = await reviewer1.client.gqlOk<any>('decideSubmissionApproval', decideGql, { input: decisionInput })
  assert.deepStrictEqual(first, await reviewer1.client.gqlOk('decideSubmissionApproval', decideGql, { input: decisionInput }))
  const conn = await mongoose.createConnection(uri!, { serverSelectionTimeoutMS: 10000 }).asPromise()
  try {
    await conn.collection('projectmembermodels').deleteOne({ projectId, memberId: reviewer2.id })
    const finalInput = { ...decisionInput, expectedRevision: 2, commandId: 'review-2' }
    assert.ok((await reviewer2.client.gql('decideSubmissionApproval', decideGql, { input: finalInput })).errors.length)
    await seedProjectMember({ projectId, memberId: reviewer2.id }, { mongoUri: uri })
    await reviewer2.client.gqlOk('decideSubmissionApproval', decideGql, { input: finalInput })
    const persisted = await owner.client.gqlOk<any>('submissionApprovalStatus', statusGql, { input: statusInput })
    assert.strictEqual(persisted.approval.state, 'APPROVED')
    assert.strictEqual(persisted.approval.audit.length, 2)
    assert.strictEqual(persisted.approval.submissionRevision, 0)
    const row = await conn.collection('submissionmodels').findOne({ _id: new mongoose.Types.ObjectId(submissionId) } as any)
    assert.strictEqual(row!.contentRevision, 0)
    assert.strictEqual(row!.formVersion, published.version)
    assert.ok(row!.formSnapshot.fields)
    await owner.client.gqlOk('updateSubmissionAnswer', UPDATE_SUBMISSION_ANSWER_GQL,
      { input: { formId, submissionId, answer: { id: 'request', kind: 'short_text', value: 'Changed by native HTTP answer edit' } } })
    const invalidated = await owner.client.gqlOk<any>('submissionApprovalStatus', statusGql, { input: statusInput })
    assert.strictEqual(invalidated.approval.state, 'INVALIDATED')
    const edited = await conn.collection('submissionmodels').findOne({ _id: new mongoose.Types.ObjectId(submissionId) } as any)
    assert.strictEqual(edited!.contentRevision, 1)
    assert.strictEqual(invalidated.approval.audit.length, 2)
    const legacyToken = await respondent.gqlOk<string>('openForm', OPEN_FORM_GQL, { input: { formId } })
    await respondent.gqlOk('completeSubmission', COMPLETE_SUBMISSION_GQL,
      { input: { formId, answers: { request: 'Legacy client ordinary submission' }, hiddenFields: [], openToken: legacyToken } })
    const legacyRow = await conn.collection('submissionmodels').findOne({ formId, formVersion: { $exists: false } })
    assert.ok(legacyRow, 'Legacy clients retain ordinary public submission compatibility')
    assert.strictEqual(legacyRow!.formSnapshot, undefined)
    assert.ok((await owner.client.gql('requestSubmissionApproval', requestGql,
      { input: { formId, submissionId: String(legacyRow!._id), expectedRevision: 0, commandId: 'legacy-approval-denied', reviewers: [reviewer1.id] } })).errors.length,
      'Legacy displayed-schema evidence remains approval-ineligible')
    console.log('Native HTTP GraphQL PASS: displayed-schema submission snapshot, real sessions, object scopes, independent ordered reviewers, removed membership, replay and persisted two-step receipt')
    if (process.env.TM_C_APPROVAL_FIXTURE_PATH) writeFileSync(process.env.TM_C_APPROVAL_FIXTURE_PATH,
      JSON.stringify({ teamId, projectId, formId, submissionId, owner, reviewer1, reviewer2 }, (key, value) => key === 'client' ? undefined : value, 2))
  } finally { await conn.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })



