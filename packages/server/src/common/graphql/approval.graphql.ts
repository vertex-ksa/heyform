import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator'
import { Field, InputType } from '@nestjs/graphql'
import { FormDetailInput } from './form.graphql'

@InputType()
export class SubmissionApprovalInput extends FormDetailInput {
  @Field()
  @IsString()
  @Length(1, 128)
  submissionId: string

  @Field()
  @IsInt()
  @Min(0)
  expectedRevision: number

  @Field()
  @IsString()
  @Length(1, 128)
  commandId: string
}

@InputType()
export class RequestSubmissionApprovalInput extends SubmissionApprovalInput {
  @Field(type => [String])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsString({ each: true })
  @Length(1, 128, { each: true })
  reviewers: string[]
}

@InputType()
export class DecideSubmissionApprovalInput extends SubmissionApprovalInput {
  @Field()
  @IsString()
  @Length(1, 128)
  requestId: string

  @Field()
  @IsIn(['APPROVE', 'REJECT'])
  decision: 'APPROVE' | 'REJECT'

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}

@InputType()
export class SubmissionApprovalStatusInput extends FormDetailInput {
  @Field()
  @IsString()
  @Length(1, 128)
  submissionId: string
}
