import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Matches } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { UuidParam } from '../common/uuid.pipe';
import { DosesService } from './doses.service';

export class DoseRangeQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' }) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' }) to: string;
}

@Controller()
export class DosesController {
  constructor(private readonly doses: DosesService) {}

  @Get('people/:personId/doses')
  list(@CurrentUser() user: AuthUser, @Param('personId', UuidParam) personId: string, @Query() q: DoseRangeQuery) {
    return this.doses.list(user, personId, q.from, q.to);
  }

  @Post('doses/:doseId/mark-taken')
  @HttpCode(200)
  markTaken(@CurrentUser() user: AuthUser, @Param('doseId', UuidParam) doseId: string) {
    return this.doses.markTaken(user, doseId);
  }

  @Get('doses/:doseId/calls')
  calls(@CurrentUser() user: AuthUser, @Param('doseId', UuidParam) doseId: string) {
    return this.doses.calls(user, doseId);
  }
}
