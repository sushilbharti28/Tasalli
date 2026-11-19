import { Body, Controller, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import Redis from 'ioredis';
import { AuthUser, CurrentUser } from '../common/decorators';
import { IsIanaTimeZone, IsNotBlank } from '../common/validators';
import { REDIS } from '../auth/otp-store';
import { UsersService } from './users.service';

export class UserUpdateDto {
  @IsOptional() @IsString() @IsNotBlank() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @IsIanaTimeZone() timeZone?: string;
  @IsOptional() @IsIn(['en', 'hi']) locale?: 'en' | 'hi';
}

export class DeviceDto {
  @IsString() @IsNotBlank() @MaxLength(4096) token: string;
}

@Controller()
export class MeController {
  constructor(
    private readonly users: UsersService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return this.users.toApi(await this.users.get(user.id));
  }

  @Patch('me')
  async update(@CurrentUser() user: AuthUser, @Body() dto: UserUpdateDto) {
    return this.users.toApi(await this.users.update(user.id, dto));
  }

  /**
   * Push tokens. schema.sql has no devices table, so tokens are kept in a Redis set
   * per user (key tasalli:devices:<userId>) until one is added (contract change requested).
   */
  @Post('devices')
  @HttpCode(204)
  async registerDevice(@CurrentUser() user: AuthUser, @Body() dto: DeviceDto): Promise<void> {
    await this.redis.sadd(`tasalli:devices:${user.id}`, dto.token);
  }
}
