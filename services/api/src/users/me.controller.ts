import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { IsIanaTimeZone, IsNotBlank } from '../common/validators';
import { Db } from '../db/db.service';
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
    private readonly db: Db,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return this.users.toApi(await this.users.get(user.id));
  }

  @Patch('me')
  async update(@CurrentUser() user: AuthUser, @Body() dto: UserUpdateDto) {
    return this.users.toApi(await this.users.update(user.id, dto));
  }

  /** Push tokens live in the devices table. A token seen again (or on a new account) just moves and refreshes. */
  @Post('devices')
  @HttpCode(204)
  async registerDevice(@CurrentUser() user: AuthUser, @Body() dto: DeviceDto): Promise<void> {
    await this.db.query(
      `insert into devices (user_id, push_token) values ($1, $2)
       on conflict (push_token) do update set user_id = excluded.user_id, last_seen_at = now()`,
      [user.id, dto.token],
    );
  }
}
