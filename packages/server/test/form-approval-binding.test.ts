import * as assert from 'assert'

// Synthetic local key only. No provider or shared data is touched.
process.env.FORM_ENCRYPTION_KEY = 'tm-c-form-schema-binding-synthetic-only'
const { CompleteSubmissionResolver } = require('../src/resolver/endpoint/complete-submission.resolver')
const { OpenFormResolver } = require('../src/resolver/endpoint/open-form.resolver')
const { PublicFormResolver } = require('../src/resolver/form/form-detail.resolver')
const { FormService } = require('../src/service/form.service')
const { approvalEvidenceHash, publishedFormSnapshot } = require('../src/utils/approval')
const { aesDecryptObject } = require('../src/utils/crypto')
const { CaptchaKindEnum, FieldKindEnum } = require('@heyform-inc/shared-types-enums')

async function run() {
  const source: any = { id: 'f', _id: 'f', teamId: 't', projectId: 'p', name: 'Synthetic', version: 7,
    fields: [{ id: 'a', kind: FieldKindEnum.SHORT_TEXT, title: 'Original', validations: { required: true }, properties: {} }],
    hiddenFields: [], logics: [], variables: [], translations: {}, settings: { active: true, allowArchive: true, captchaKind: CaptchaKindEnum.NONE } }
  const fresh = () => { const row = JSON.parse(JSON.stringify(source)); row.toObject = () => JSON.parse(JSON.stringify(source)); return row }
  const forms = new FormService({ findById: async () => fresh() } as any, { findById: async () => ({ removeBranding: false }) } as any, {} as any, {} as any)
  const publicForm = await new PublicFormResolver(forms).publicForm({ formId: 'f' })
  assert.strictEqual(publicForm.version, 7)
  assert.strictEqual(publicForm.schemaHash, approvalEvidenceHash(publishedFormSnapshot(source)))
  const open = new OpenFormResolver(forms, { updateTotalVisits: async () => undefined } as any)
  const encrypted = await open.openForm({ formId: 'f', version: publicForm.version, schemaHash: publicForm.schemaHash })
  const token = aesDecryptObject(encrypted, process.env.FORM_ENCRYPTION_KEY)
  assert.strictEqual(token.displayedSchemaBound, true)
  let stored: any
  let writes = 0
  const complete = (openToken: any) => new CompleteSubmissionResolver({ decryptToken: () => openToken,
    assertOpenToken: () => Math.floor(Date.now()/1000), verifySpam: async () => false } as any,
    forms, { createWithinQuota: async (row: any) => { stored = row; writes++; return 's' } } as any,
    {} as any, { addQueue: () => undefined } as any, { addQueue: () => undefined } as any, {} as any)
  const submit = (resolver: any) => resolver.completeSubmission({ ip: '203.0.113.10', userAgent: {}, lang: 'en' }, 'anon',
    { formId: 'f', answers: { a: 'Answer' }, hiddenFields: [], openToken: 'synthetic' })
  await submit(complete(token))
  assert.strictEqual(stored.formVersion, 7)
  assert.strictEqual(stored.formSnapshot.fields[0].title, 'Original')
  source.fields[0].title = 'Changed with same native version'
  await assert.rejects(() => open.openForm({ formId: 'f', version: 7, schemaHash: publicForm.schemaHash }))
  await assert.rejects(() => submit(complete(token)))
  assert.strictEqual(writes, 1)
  source.fields[0].title = 'Original'
  source.translations = { ar: { a: { title: 'Changed translation' } } }
  await assert.rejects(() => submit(complete(token)))
  assert.strictEqual(writes, 1)
  const legacyEncrypted = await open.openForm({ formId: 'f' })
  const legacyToken = aesDecryptObject(legacyEncrypted, process.env.FORM_ENCRYPTION_KEY)
  assert.strictEqual(legacyToken.displayedSchemaBound, false)
  await submit(complete(legacyToken))
  assert.strictEqual(stored.formSnapshot, undefined)
  assert.strictEqual(stored.formVersion, undefined)
  await submit(complete({ formId: 'f', timestamp: Math.floor(Date.now()/1000) }))
  assert.strictEqual(stored.formSnapshot, undefined)
  source.version = 0
  const zeroVersion = await new PublicFormResolver(forms).publicForm({ formId: 'f' })
  assert.strictEqual(zeroVersion.version, 0)
  await open.openForm({ formId: 'f', version: 0, schemaHash: zeroVersion.schemaHash })
  console.log('Public masking/resolver/token/completion source checks passed: version/hash propagation, same-version material change denial before writes, legacy approval ineligibility')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
