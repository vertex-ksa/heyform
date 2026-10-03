import {
  Answer,
  SubmissionCategoryEnum,
  SubmissionStatusEnum
} from '@heyform-inc/shared-types-enums'
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'

import { FormService } from './form.service'
import { RedisService } from './redis.service'
import { date, helper } from '@heyform-inc/utils'
import { SubmissionModel } from '@model'
import { getUpdateQuery } from '@utils'
import { reconcileApprovalCommand } from '../utils/approval-recovery'
import { approvalEvidenceHash, createSubmissionApproval, decideSubmissionApproval } from '../utils/approval'

const { isValid } = helper

interface FindSubmissionOptions {
  formId: string
  category?: SubmissionCategoryEnum
  labelId?: string
  page?: number
  limit?: number
}

interface UpdateCategoryOptions {
  formId: string
  submissionIds: string[]
  category: SubmissionCategoryEnum
}

@Injectable()
export class SubmissionService {
  constructor(
    @InjectModel(SubmissionModel.name)
    private readonly submissionModel: Model<SubmissionModel>,
    private readonly formService: FormService,
    private readonly redisService: RedisService
  ) {}

  async findById(id: string): Promise<SubmissionModel | null> {
    return this.submissionModel.findById(id)
  }

  async findByFormId(formId: string, submissionId: string): Promise<SubmissionModel | null> {
    return this.submissionModel.findOne({
      _id: submissionId,
      formId
    })
  }

  async findAll({
    formId,
    category,
    labelId,
    page = 1,
    limit = 30
  }: FindSubmissionOptions): Promise<SubmissionModel[]> {
    const conditions: Record<string, any> = {
      formId,
      status: SubmissionStatusEnum.PUBLIC
    }

    if (helper.isValid(category)) {
      conditions.category = category
    }

    if (helper.isValid(labelId)) {
      conditions.labels = labelId
    }

    return this.submissionModel
      .find(conditions)
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({
        _id: -1
      })
  }

  async countAllWithFieldId(formId: string, fieldId: string): Promise<number> {
    return this.submissionModel.countDocuments({
      formId,
      'answers.id': fieldId,
      status: SubmissionStatusEnum.PUBLIC
    })
  }

  async findAllWithFieldId(
    formId: string,
    fieldId: string,
    page = 1,
    limit = 30
  ): Promise<SubmissionModel[]> {
    const answers = {
      $elemMatch: {
        id: fieldId as string
      }
    }
    const projections = {
      id: 1,
      answers,
      endAt: 1
    }
    const conditions: Record<string, any> = {
      formId,
      answers,
      status: SubmissionStatusEnum.PUBLIC
    }

    return this.submissionModel
      .find(conditions)
      .select(projections)
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({
        endAt: -1
      })
  }

  async findAllGroupInFieldIds(
    formId: string,
    fieldIds: string[],
    limit = 10
  ): Promise<SubmissionModel[]> {
    if (helper.isEmpty(fieldIds)) {
      return []
    }

    return this.submissionModel.aggregate([
      {
        $unwind: '$answers'
      },
      {
        $match: {
          formId,
          'answers.id': {
            $in: fieldIds
          }
        }
      },
      { $sort: { endAt: -1 } },
      { $limit: limit * fieldIds.length },
      {
        $group: {
          _id: '$answers.id',
          answers: {
            $push: {
              submissionId: '$_id',
              kind: '$answers.kind',
              value: '$answers.value',
              endAt: '$endAt'
            }
          }
        }
      },
      {
        $project: {
          answers: { $slice: ['$answers', limit] }
        }
      }
    ])
  }

  public async count({ formId, category, labelId }: FindSubmissionOptions): Promise<number> {
    const conditions: Record<string, any> = {
      formId,
      status: SubmissionStatusEnum.PUBLIC
    }

    if (helper.isValid(category)) {
      conditions.category = category
    }

    if (helper.isValid(labelId)) {
      conditions.labels = labelId
    }
    return this.submissionModel.countDocuments(conditions)
  }

  public async countInForm(formId: string): Promise<number> {
    return this.submissionModel.countDocuments({
      formId
    })
  }

  public async countAllInTeam(teamId: string): Promise<number> {
    const forms = await this.formService.findAllInTeam(teamId)

    if (isValid(forms)) {
      return this.countAll(
        forms.map(f => f._id),
        {
          createdAt: {
            $gte: date().startOf('month').toDate()
          }
        }
      )
    }

    return 0
  }

  public countAll(formIds: string[], filters: Record<string, any> = {}): Promise<number> {
    return this.submissionModel.countDocuments({
      formId: {
        $in: formIds
      },
      ...filters
    })
  }

  public async countInForms(formIds: string[]): Promise<any> {
    return this.submissionModel
      .aggregate<SubmissionModel>([
        {
          $match: {
            formId: {
              $in: formIds
            }
          }
        },
        {
          $group: {
            _id: `$formId`,
            count: {
              $sum: 1
            }
          }
        }
      ])
      .exec()
  }

  public async countInTeams(teamIds: string[]): Promise<any> {
    return this.submissionModel
      .aggregate<SubmissionModel>([
        {
          $match: {
            teamId: {
              $in: teamIds
            }
          }
        },
        {
          $group: {
            _id: `$formId`,
            count: {
              $sum: 1
            }
          }
        }
      ])
      .exec()
  }

  public async create(submission: SubmissionModel | any): Promise<string> {
    const result = await this.submissionModel.create(submission)
    return result.id
  }

  public async createWithinQuota(
    submission: SubmissionModel | any,
    quotaLimit?: number
  ): Promise<string> {
    if (!Number.isSafeInteger(quotaLimit) || quotaLimit! < 1) {
      return this.create(submission)
    }

    // Serialize the authoritative Mongo count and insert. Unlike a second counter, this cannot
    // drift when submissions are deleted, imported, or a write fails after reserving a slot.
    return this.redisService.withLock(`submission-quota:${submission.formId}`, '30s', async () => {
      const count = await this.countInForm(submission.formId)

      if (count >= quotaLimit!) {
        throw new BadRequestException(
          'The submission quota exceeds, new submissions are no longer accepted'
        )
      }

      return this.create(submission)
    })
  }

  public async maskAsPrivate(formId: string, submissionIds?: string[]): Promise<boolean> {
    const conditions: any = {
      formId
    }

    if (submissionIds) {
      conditions._id = {
        $in: submissionIds
      }
    }

    const result = await this.submissionModel.updateOne(conditions, {
      status: SubmissionStatusEnum.PRIVATE
    })
    return result.matchedCount > 0
  }

  public async deleteByIds(formId: string, submissionIds?: string[]): Promise<boolean> {
    const conditions: any = {
      formId
    }

    if (submissionIds) {
      conditions._id = {
        $in: submissionIds
      }
    }

    const result = await this.submissionModel.deleteMany(conditions)
    return (result.deletedCount ?? 0) > 0
  }

  public async deleteAll(formId: string | string[]): Promise<boolean> {
    const conditions: Record<string, any> = {
      formId
    }

    if (helper.isValidArray(formId)) {
      conditions.formId = {
        $in: formId as string[]
      }
    }

    const result = await this.submissionModel.deleteMany(conditions)
    return (result.deletedCount ?? 0) > 0
  }

  public async updateCategory({
    formId,
    submissionIds,
    category
  }: UpdateCategoryOptions): Promise<boolean> {
    const result = await this.submissionModel.updateMany(
      {
        formId,
        _id: {
          $in: submissionIds
        }
      },
      {
        category
      }
    )
    return result.matchedCount > 0
  }

  async findByIds(formId: string, submissionIds: string[]): Promise<SubmissionModel[]> {
    const conditions: Record<string, any> = {
      formId,
      _id: {
        $in: submissionIds
      },
      status: SubmissionStatusEnum.PUBLIC
    }
    return this.submissionModel.find(conditions)
  }

  async findAllByForm(formId: string): Promise<SubmissionModel[]> {
    let submissions = []
    const limit = 1000
    const submissionCount = await this.count({
      formId
    })

    if (submissionCount < limit) {
      submissions = await this.findAll({
        formId,
        page: 1,
        limit
      })
    } else {
      const promises = []
      const max = Math.ceil(submissionCount / limit)

      for (let i = 1; i <= max; i++) {
        promises.push(
          this.findAll({
            formId,
            page: i,
            limit
          })
        )
      }

      const result = await Promise.all(promises)
      submissions = result.reduce((prev, next) => [...prev, ...next], [])
    }

    return submissions
  }

  async createAnswer(submissionId: string, answer: Answer): Promise<boolean> {
    const result = await this.submissionModel.updateOne(
      {
        _id: submissionId
      },
      {
        $push: {
          answers: answer
        },
        $inc: { revision: 1, contentRevision: 1 },
        $set: { 'approval.state': 'INVALIDATED' }
      }
    )
    return result.acknowledged
  }

  async updateAnswer(submissionId: string, answer: Answer): Promise<boolean> {
    const updates = {
      kind: answer.kind,
      properties: answer.properties,
      value: answer.value
    }

    const result = await this.submissionModel.updateOne(
      {
        _id: submissionId,
        'answers.id': answer.id
      },
      {
        $set: { ...getUpdateQuery(updates, 'answers.$', false), 'approval.state': 'INVALIDATED' },
        $inc: { revision: 1, contentRevision: 1 }
      }
    )
    return result.acknowledged
  }

  private approvalSnapshot(submission: SubmissionModel) {
    if (submission.formVersion === undefined || !submission.formSnapshot) {
      throw new BadRequestException('Legacy submission has no immutable form snapshot')
    }
    return { contentRevision: submission.contentRevision || 0, formVersion: submission.formVersion, formSnapshot: submission.formSnapshot,
      answers: submission.answers, hiddenFields: submission.hiddenFields, variables: submission.variables }
  }

  private revisionFilter(revision: number) {
    return revision === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision }
  }

  async requestApproval(form: any, submissionId: string, actorId: string, reviewers: string[], commandId: string, expectedRevision: number) {
    const submission = await this.findByFormId(form.id, submissionId)
    if (!submission || submission.status !== SubmissionStatusEnum.PUBLIC) throw new ForbiddenException('FORBIDDEN')
    const commandHash = approvalEvidenceHash({ reviewers, revision: expectedRevision })
    if (submission.approvalHistory?.some(previous => previous.commandId === commandId)) {
      throw new ConflictException('COMMAND_CONFLICT')
    }
    if (submission.approval?.commandId === commandId) {
      if (submission.approval.commandHash !== commandHash || submission.approval.requesterId !== actorId) {
        throw new ConflictException('COMMAND_CONFLICT')
      }
      return submission.approval
    }
    if ((submission.revision || 0) !== expectedRevision || (submission.approval?.state === 'PENDING' && Date.parse(submission.approval.expiresAt) > Date.now())) {
      throw new ConflictException('VERSION_CONFLICT')
    }
    if ((submission.approvalHistory?.length || 0) >= 20) throw new BadRequestException('Approval history limit reached')
    let approval
    try {
      approval = createSubmissionApproval({ tenantId: form.teamId, formId: form.id, submissionId,
        submissionRevision: submission.contentRevision || 0, commandRevision: expectedRevision, formVersion: submission.formVersion,
        snapshot: this.approvalSnapshot(submission), requesterId: actorId, reviewers, commandId })
    } catch (error) {
      throw new BadRequestException(error.message)
    }
    const updates: any = { $set: { approval }, $inc: { revision: 1 } }
    if (submission.approval?.requestId) updates.$push = { approvalHistory: submission.approval }
    const result = await this.submissionModel.findOneAndUpdate({ _id: submissionId, formId: form.id,
      ...this.revisionFilter(expectedRevision) }, updates, { new: true })
    if (!result) throw new ConflictException('VERSION_CONFLICT')
    return result.approval
  }

  async approvalStatus(formId: string, submissionId: string, actorId: string, tenantId?: string) {
    const submission = await this.findByFormId(formId, submissionId)
    if (!submission || submission.status !== SubmissionStatusEnum.PUBLIC) throw new ForbiddenException('FORBIDDEN')
    const approval = submission.approval?.requestId ? submission.approval : null
    if (approval && tenantId && approval.tenantId !== tenantId) throw new ForbiddenException('FORBIDDEN')
    if (approval && approval.requesterId !== actorId && !approval.reviewers.includes(actorId)) {
      throw new ForbiddenException('FORBIDDEN')
    }
    return { revision: submission.revision || 0, formVersion: submission.formVersion, approval,
      evidence: submission.formSnapshot ? this.approvalSnapshot(submission) : null }
  }

  async approvalCommandStatus(form: any, submissionId: string, actorId: string, input: any) {
    const submission = await this.findByFormId(form.id, submissionId)
    if (!submission || submission.status !== SubmissionStatusEnum.PUBLIC) throw new ForbiddenException('FORBIDDEN')
    return reconcileApprovalCommand([...(submission.approvalHistory || []), ...(submission.approval?.requestId ? [submission.approval] : [])],
      form.teamId, form.id, submissionId, actorId, input, submission.revision || 0)
  }

  async decideApproval(formId: string, submissionId: string, actorId: string, input: {
    commandId: string; requestId: string; expectedRevision: number; decision: 'APPROVE' | 'REJECT'; reason?: string; tenantId: string
  }) {
    const submission = await this.findByFormId(formId, submissionId)
    const original = submission?.approval
    if (submission?.status !== SubmissionStatusEnum.PUBLIC) throw new ForbiddenException('FORBIDDEN')
    if (!original?.requestId || !original.reviewers.includes(actorId)) throw new ForbiddenException('FORBIDDEN')
    if (original.tenantId !== input.tenantId) throw new ForbiddenException('FORBIDDEN')
    if (original.requestId !== input.requestId) throw new ConflictException('VERSION_CONFLICT')
    let approval
    try {
      approval = decideSubmissionApproval(original, { actorId, commandId: input.commandId, commandRevision: input.expectedRevision,
        decision: input.decision, reason: input.reason,
        currentEvidenceHash: approvalEvidenceHash(this.approvalSnapshot(submission)), currentMember: true })
    } catch (error) {
      if (error.message === 'FORBIDDEN') throw new ForbiddenException('FORBIDDEN')
      throw new ConflictException(error.message)
    }
    if (approval === original) return original
    if ((submission.revision || 0) !== input.expectedRevision) throw new ConflictException('VERSION_CONFLICT')
    const result = await this.submissionModel.findOneAndUpdate({ _id: submissionId, formId,
      ...this.revisionFilter(input.expectedRevision), 'approval.requestId': input.requestId,
      'approval.state': 'PENDING' }, { $set: { approval }, $inc: { revision: 1 } }, { new: true })
    if (!result) throw new ConflictException('VERSION_CONFLICT')
    return result.approval
  }

  async analytic(formId: string, startAt: number, endAt: number) {
    return this.submissionModel.aggregate([
      {
        $match: {
          formId: formId,
          startAt: { $gte: startAt },
          endAt: { $lte: endAt }
        }
      },
      {
        $group: {
          _id: null,
          avgAverageTime: {
            $avg: { $subtract: ['$endAt', '$startAt'] }
          },
          avgSubmissionCount: { $sum: 1 }
        }
      }
    ])
  }
}
