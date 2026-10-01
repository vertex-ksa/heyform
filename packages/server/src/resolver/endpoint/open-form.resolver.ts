import { BadRequestException, UseGuards } from '@nestjs/common'

import { FORM_ENCRYPTION_KEY } from '@environments'
import { OpenFormInput } from '@graphql'
import { EndpointAnonymousIdGuard } from '@guard'
import { timestamp } from '@heyform-inc/utils'
import { Args, Query, Resolver } from '@nestjs/graphql'
import { FormAnalyticService, FormService } from '@service'
import { aesEncryptObject, assertFormIsAcceptingSubmissions } from '@utils'

@Resolver()
@UseGuards(EndpointAnonymousIdGuard)
export class OpenFormResolver {
  constructor(
    private readonly formService: FormService,
    private readonly formAnalyticService: FormAnalyticService
  ) {}

  @Query(returns => String)
  async openForm(@Args('input') input: OpenFormInput): Promise<string> {
    const form = await this.formService.findById(input.formId)

    if (!form) {
      throw new BadRequestException('The form does not exist')
    }

    if (form.suspended) {
      throw new BadRequestException('The form is suspended')
    }

    if (form.settings.active !== true) {
      throw new BadRequestException('The form does not active')
    }

    assertFormIsAcceptingSubmissions(form.settings, timestamp())
    if (input.version !== undefined && input.version !== form.version) {
      throw new BadRequestException('The form changed. Reload the form before submitting.')
    }

    // Update form visit number
    await this.formAnalyticService.updateTotalVisits(form.id)

    return aesEncryptObject(
      {
        formId: form.id,
        formVersion: form.version,
        timestamp: timestamp()
      },
      FORM_ENCRYPTION_KEY
    )
  }
}
