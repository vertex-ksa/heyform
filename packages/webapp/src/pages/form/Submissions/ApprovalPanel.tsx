import { gql } from '@apollo/client'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { apollo } from '@/utils'
import { parsePlainAnswer } from '@heyform-inc/answer-utils'

import { Button } from '@/components'
import { useUserStore } from '@/store'

import { SubmissionHeaderCell } from './SubmissionCell'

const STATUS = gql`
  query ApprovalStatus($input: SubmissionApprovalStatusInput!) {
    submissionApprovalStatus(input: $input)
  }
`
const MEMBERS = gql`
  query ApprovalMembers($input: ProjectDetailInput!) {
    projectMembers(input: $input) {
      id
      name
    }
  }
`
const REQUEST = gql`
  mutation RequestApproval($input: RequestSubmissionApprovalInput!) {
    requestSubmissionApproval(input: $input)
  }
`
const DECIDE = gql`
  mutation DecideApproval($input: DecideSubmissionApprovalInput!) {
    decideSubmissionApproval(input: $input)
  }
`

export default function ApprovalPanel({
  formId,
  projectId,
  submissionId
}: {
  formId: string
  projectId: string
  submissionId: string
}) {
  const { t: translate, i18n } = useTranslation()
  const t = (key: string) => String(translate(key))
  const { user } = useUserStore()
  const [status, setStatus] = useState<any>()
  const [members, setMembers] = useState<Array<{ id: string; name: string }>>([])
  const [reviewer1, setReviewer1] = useState('')
  const [reviewer2, setReviewer2] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const command = useRef<string>(crypto.randomUUID())
  const approval = status?.approval
  const expired = approval && Date.parse(approval.expiresAt) <= Date.now()
  const canDecide =
    approval?.state === 'PENDING' && !expired && approval.reviewers[approval.step] === user.id
  const canRequest =
    status?.formVersion !== undefined &&
    status?.formVersion !== null &&
    (!approval || ['INVALIDATED', 'REJECTED', 'APPROVED'].includes(approval.state) || expired)
  const policyValid =
    reviewer1 &&
    reviewer1 !== user.id &&
    (!reviewer2 || (reviewer2 !== reviewer1 && reviewer2 !== user.id))

  async function refresh() {
    setLoading(true)
    setError(false)
    try {
      const [result, people] = await Promise.all([
        apollo.query({
          query: STATUS,
          variables: { input: { formId, submissionId } },
          fetchPolicy: 'network-only'
        }),
        apollo.query({
          query: MEMBERS,
          variables: { input: { projectId } },
          fetchPolicy: 'network-only'
        })
      ])
      setStatus(result)
      setMembers(people.filter((member: any) => member.id !== user.id))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [formId, submissionId, projectId])

  async function mutate(decision?: 'APPROVE' | 'REJECT') {
    setLoading(true)
    setError(false)
    try {
      const base = {
        formId,
        submissionId,
        expectedRevision: status.revision,
        commandId: command.current
      }
      await apollo.mutate({
        mutation: decision ? DECIDE : REQUEST,
        variables: {
          input: decision
            ? {
                ...base,
                requestId: approval.requestId,
                decision,
                reason: decision === 'REJECT' ? reason : undefined
              }
            : { ...base, reviewers: [reviewer1, reviewer2].filter(Boolean) }
        }
      })
      await refresh()
      command.current = crypto.randomUUID()
    } catch {
      setError(true)
      setLoading(false)
    }
  }

  const reviewerName = (id: string) =>
    members.find(member => member.id === id)?.name || (id === user.id ? user.name : id)
  const stateLabel =
    expired && ['PENDING', 'APPROVED'].includes(approval?.state)
      ? 'expired'
      : approval?.state.toLowerCase()
  const inputClass =
    'border-accent-light bg-foreground text-primary w-full rounded-md border p-2 text-base focus-visible:outline focus-visible:outline-2'
  return (
    <section
      className="border-accent-light mt-6 space-y-4 border-t pt-5 print:hidden"
      dir={i18n.language.startsWith('ar') ? 'rtl' : 'ltr'}
      aria-busy={loading}
    >
      <h2 className="text-primary text-base font-semibold">{t('approval.title')}</h2>
      {loading && <p role="status">{t('approval.loading')}</p>}
      {error && (
        <p role="alert">
          {t('approval.error')} {t('approval.forbidden')}
        </p>
      )}
      {!error && status && (
        <>
          {status.formVersion == null ? (
            <p>{t('approval.legacy')}</p>
          ) : (
            <p>
              {t('approval.version')}: <bdi>{status.formVersion}</bdi>
            </p>
          )}
          {status.evidence && (
            <details className="border-accent-light rounded-md border p-3" open={canDecide}>
              <summary className="cursor-pointer font-medium focus-visible:outline focus-visible:outline-2">
                {t('approval.evidence')}
              </summary>
              <p className="mt-3 text-sm">{t('approval.evidenceHelp')}</p>
              <dl className="mt-3 space-y-3">
                {status.evidence.answers.map((answer: any) => (
                  <div key={answer.id}>
                    <dt dir="auto" className="break-words font-medium">
                      <SubmissionHeaderCell
                        field={
                          status.evidence.formSnapshot.fields.find(
                            (field: any) => field.id === answer.id
                          ) || answer
                        }
                      />
                    </dt>
                    <dd dir="auto" className="mt-1 whitespace-pre-wrap break-words">
                      {String(parsePlainAnswer(answer) || '')}
                    </dd>
                  </div>
                ))}
              </dl>
              {status.evidence.hiddenFields?.length > 0 && (
                <div className="mt-4">
                  <h3 className="font-medium">{t('approval.hidden')}</h3>
                  <dl className="space-y-2">
                    {status.evidence.hiddenFields.map((field: any) => (
                      <div key={field.id} className="break-words">
                        <dt dir="auto">{field.name}</dt>
                        <dd dir="auto">{String(field.value ?? '')}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              {status.evidence.variables?.length > 0 && (
                <div className="mt-4">
                  <h3 className="font-medium">{t('approval.variables')}</h3>
                  <dl className="space-y-2">
                    {status.evidence.variables.map((field: any) => (
                      <div key={field.id} className="break-words">
                        <dt dir="auto">{field.name}</dt>
                        <dd dir="auto">{String(field.value ?? '')}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </details>
          )}
          {approval ? (
            <>
              <p role="status">{t(`approval.${stateLabel}`)}</p>
              <p>
                {t('approval.expires')}:{' '}
                {new Date(approval.expiresAt).toLocaleString(i18n.language)}
              </p>
              {approval.state === 'PENDING' && !expired && (
                <p>
                  {t('approval.reviewed')}:{' '}
                  <bdi>{reviewerName(approval.reviewers[approval.step])}</bdi>
                </p>
              )}
              {approval.audit.length > 0 && (
                <div>
                  <h3>{t('approval.history')}</h3>
                  <ul className="space-y-2">
                    {approval.audit.map((event: any) => (
                      <li key={event.eventId}>
                        <bdi>{reviewerName(event.actorId)}</bdi>:{' '}
                        {t(
                          event.decision === 'APPROVE'
                            ? 'approval.approveEvent'
                            : 'approval.rejectEvent'
                        )}
                        {event.reason && <p className="break-words">{event.reason}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p>{t('approval.empty')}</p>
          )}
          {canRequest && (
            <>
              <p className="text-secondary text-sm">{t('approval.policy')}</p>
              <label className="block space-y-2">
                <span>{t('approval.reviewer1')}</span>
                <select
                  name="approval-reviewer-first"
                  autoComplete="off"
                  className={inputClass}
                  value={reviewer1}
                  disabled={loading}
                  onChange={e => setReviewer1(e.target.value)}
                >
                  <option value="">{t('approval.choose')}</option>
                  {members.map(member => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2">
                <span>{t('approval.reviewer2')}</span>
                <select
                  name="approval-reviewer-second"
                  autoComplete="off"
                  className={inputClass}
                  value={reviewer2}
                  disabled={loading}
                  onChange={e => setReviewer2(e.target.value)}
                >
                  <option value="">{t('approval.none')}</option>
                  {members
                    .filter(member => member.id !== reviewer1)
                    .map(member => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                </select>
              </label>
              <Button
                className="focus-visible:!ring-brand focus-visible:!ring-2"
                disabled={loading || !policyValid}
                onClick={() => void mutate()}
              >
                {t('approval.request')}
              </Button>
            </>
          )}
          {canDecide && (
            <>
              <label className="block space-y-2">
                <span>{t('approval.reason')}</span>
                <textarea
                  dir="auto"
                  name="approval-rejection-reason"
                  autoComplete="off"
                  className={inputClass}
                  value={reason}
                  maxLength={500}
                  disabled={loading}
                  onChange={e => setReason(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <Button
                  className="focus-visible:!ring-brand focus-visible:!ring-2"
                  disabled={loading}
                  onClick={() => void mutate('APPROVE')}
                >
                  {t('approval.approve')}
                </Button>
                <Button.Ghost
                  className="focus-visible:!ring-brand focus-visible:!ring-2"
                  disabled={loading || !reason.trim()}
                  onClick={() => void mutate('REJECT')}
                >
                  {t('approval.reject')}
                </Button.Ghost>
              </div>
            </>
          )}
        </>
      )}
      <Button.Ghost
        className="focus-visible:!ring-brand focus-visible:!ring-2"
        disabled={loading}
        onClick={() => void refresh()}
      >
        {t('approval.refresh')}
      </Button.Ghost>
    </section>
  )
}
