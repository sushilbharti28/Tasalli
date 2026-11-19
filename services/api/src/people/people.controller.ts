import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators';
import { UuidParam } from '../common/uuid.pipe';
import { PersonCreateDto, PersonUpdateDto } from './people.dto';
import { PeopleService, personToApi } from './people.service';

@Controller('people')
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return (await this.people.list(user.id)).map(personToApi);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: PersonCreateDto) {
    return personToApi(await this.people.create(user, dto));
  }

  @Get(':personId')
  async get(@CurrentUser() user: AuthUser, @Param('personId', UuidParam) personId: string) {
    return personToApi(await this.people.get(user.id, personId));
  }

  @Patch(':personId')
  async update(@CurrentUser() user: AuthUser, @Param('personId', UuidParam) personId: string, @Body() dto: PersonUpdateDto) {
    return personToApi(await this.people.update(user, personId, dto));
  }

  @Delete(':personId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('personId', UuidParam) personId: string): Promise<void> {
    await this.people.remove(user, personId);
  }

  @Post(':personId/consent-call')
  @HttpCode(202)
  async consentCall(@CurrentUser() user: AuthUser, @Param('personId', UuidParam) personId: string) {
    await this.people.retryConsentCall(user, personId);
    return { status: 'queued' };
  }
}
