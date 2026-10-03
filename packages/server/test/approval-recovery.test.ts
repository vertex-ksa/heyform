import * as assert from 'assert'
import { createSubmissionApproval, decideSubmissionApproval } from '../src/utils/approval'
import { reconcileApprovalCommand } from '../src/utils/approval-recovery'
const a=createSubmissionApproval({tenantId:'t',formId:'f',submissionId:'s',submissionRevision:0,formVersion:1,snapshot:{answers:[]},requesterId:'actor',reviewers:['reviewer'],commandId:'request',commandRevision:4})
const request={action:'REQUEST',commandId:'request',expectedRevision:4,reviewers:['reviewer']}
const read=(rows:any[],actor:string,input:any,revision=6)=>reconcileApprovalCommand(rows,'t','f','s',actor,input,revision)
assert.strictEqual(read([a],'actor',request).state,'acknowledged')
for(const change of [{expectedRevision:5},{reviewers:['other']}])assert.strictEqual(read([a],'actor',{...request,...change}).state,'unresolved')
assert.strictEqual(read([a],'other',request).state,'unresolved')
assert.strictEqual(read([a,a],'actor',request).state,'unresolved')
assert.strictEqual(read([],'actor',request,4).state,'not_found')
assert.strictEqual(read([],'actor',request,5).state,'stale')
const decided=decideSubmissionApproval(a,{actorId:'reviewer',commandId:'decision',commandRevision:5,decision:'APPROVE',currentEvidenceHash:a.evidenceHash,currentMember:true})
const decision={action:'DECIDE',commandId:'decision',requestId:a.requestId,expectedRevision:5,decision:'APPROVE',reason:''}
assert.strictEqual(read([decided],'reviewer',decision).state,'acknowledged')
for(const change of [{requestId:'other'},{expectedRevision:6},{reason:'other'},{decision:'REJECT'}])assert.strictEqual(read([decided],'reviewer',{...decision,...change}).state,'unresolved')
assert.strictEqual(read([decided],'actor',decision).state,'unresolved')
const legacy={...decided,audit:decided.audit.map(({commandRevision,...rest})=>rest)}
assert.strictEqual(read([legacy],'reviewer',decision).state,'unresolved')
assert.throws(()=>decideSubmissionApproval(legacy,{actorId:'reviewer',commandId:'decision',commandRevision:5,decision:'APPROVE',currentEvidenceHash:a.evidenceHash,currentMember:true}),/COMMAND_CONFLICT/)
assert.throws(()=>decideSubmissionApproval(decided,{actorId:'reviewer',commandId:'decision',commandRevision:6,decision:'APPROVE',currentEvidenceHash:a.evidenceHash,currentMember:true}),/COMMAND_CONFLICT/)
assert.strictEqual(read([decided,{...a,requestId:'later',commandId:'later-command'}],'reviewer',decision).state,'acknowledged')
assert.strictEqual(read([{...decided,state:'INVALIDATED'}],'reviewer',decision).state,'acknowledged')
assert.strictEqual(read([{...decided,tenantId:'other'}],'reviewer',decision).state,'unresolved')
console.log('Approval exact command recovery tests passed')
