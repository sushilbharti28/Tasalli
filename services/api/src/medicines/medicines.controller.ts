import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { UuidParam } from '../common/uuid.pipe';
import { MEDICINE_NAME_SOURCE, MedicineNameSource } from './medicine-names';
import { KINDS, MedicineCreateDto } from './medicines.dto';
import { MedicinesService } from './medicines.service';

export class MedicineNameQuery {
  @IsString() @MinLength(2) @MaxLength(40) q: string;
  @IsOptional() @IsIn(KINDS) kind?: (typeof KINDS)[number];
}

@Controller()
export class MedicinesController {
  constructor(
    private readonly medicines: MedicinesService,
    @Inject(MEDICINE_NAME_SOURCE) private readonly names: MedicineNameSource,
  ) {}

  @Get('people/:personId/medicines')
  list(@CurrentUser() user: AuthUser, @Param('personId', UuidParam) personId: string) {
    return this.medicines.list(user, personId);
  }

  @Post('people/:personId/medicines')
  create(@CurrentUser() user: AuthUser, @Param('personId', UuidParam) personId: string, @Body() dto: MedicineCreateDto) {
    return this.medicines.create(user, personId, dto);
  }

  @Patch('medicines/:medicineId')
  update(@CurrentUser() user: AuthUser, @Param('medicineId', UuidParam) medicineId: string, @Body() dto: MedicineCreateDto) {
    return this.medicines.update(user, medicineId, dto);
  }

  @Delete('medicines/:medicineId')
  @HttpCode(204)
  async stop(@CurrentUser() user: AuthUser, @Param('medicineId', UuidParam) medicineId: string): Promise<void> {
    await this.medicines.stop(user, medicineId);
  }

  @Get('medicines/:medicineId/preview')
  preview(@CurrentUser() user: AuthUser, @Param('medicineId', UuidParam) medicineId: string) {
    return this.medicines.preview(user, medicineId);
  }

  @Get('medicine-names')
  searchNames(@Query() query: MedicineNameQuery) {
    return this.names.search(query.q, query.kind, 20);
  }
}
