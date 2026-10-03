import { ForbiddenException } from '@nestjs/common'
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql'
import GraphQLJSON from 'graphql-type-json'
import { Auth, Form, FormGuard, User } from '@decorator'
import { FormModel, UserModel } from '@model'
import { ProjectService, SubmissionService, TeamService } from '@service'
import { SubmissionApprovalCommandStatusInput, DecideSubmissionApprovalInput, RequestSubmissionApprovalInput, SubmissionApprovalStatusInput } from '../../common/graphql/approval.graphql'

@Resolver()
@Auth()
export class SubmissionApprovalResolver {
  constructor(private readonly submissions: SubmissionService, private readonly teams: TeamService,
    private readonly projects: ProjectService) {}

  private assertEnabled() {
    // Initial native packet is local-only until persistence, peer and rendered acceptance pass.
    if (process.env.FORM_APPROVAL_LOCAL_ENABLED !== 'true' || process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Approval workflow is not enabled in this environment')
    }
  }

  private async assertMember(form: FormModel, userId: string) {
    const [team, project] = await Promise.all([
      this.teams.findMemberById(form.teamId, userId), this.projects.findMemberById(form.projectId, userId)
    ])
    if (!team || !project) throw new ForbiddenException('Reviewer must have current form access')
  }

  @Query(returns => GraphQLJSON)
  @FormGuard()
  async submissionApprovalStatus(@Form() form: FormModel, @User() user: UserModel,
    @Args('input') input: SubmissionApprovalStatusInput) {
    this.assertEnabled()
    return this.submissions.approvalStatus(form.id, input.submissionId, user.id, form.teamId)
  }

  @Query(returns => GraphQLJSON)
  @FormGuard()
  async submissionApprovalCommandStatus(@Form() form: FormModel, @User() user: UserModel,
    @Args('input') input: SubmissionApprovalCommandStatusInput) {
    this.assertEnabled()
    await this.assertMember(form, user.id)
    return this.submissions.approvalCommandStatus(form, input.submissionId, user.id, input)
  }

  @Mutation(returns => GraphQLJSON)
  @FormGuard()
  async requestSubmissionApproval(@Form() form: FormModel, @User() user: UserModel,
    @Args('input') input: RequestSubmissionApprovalInput) {
    this.assertEnabled()
    for (const reviewer of input.reviewers) await this.assertMember(form, reviewer)
    return this.submissions.requestApproval(form, input.submissionId, user.id, input.reviewers,
      input.commandId, input.expectedRevision)
  }

  @Mutation(returns => GraphQLJSON)
  @FormGuard()
  async decideSubmissionApproval(@Form() form: FormModel, @User() user: UserModel,
    @Args('input') input: DecideSubmissionApprovalInput) {
    this.assertEnabled()
    await this.assertMember(form, user.id)
    return this.submissions.decideApproval(form.id, input.submissionId, user.id, { ...input, tenantId: form.teamId })
  }
}
