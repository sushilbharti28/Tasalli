import { Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { AppConfig, CONFIG } from '../config';
import { Public } from '../common/decorators';
import { normalizeE164 } from '../common/phone';
import { UsersService } from '../users/users.service';
import { OtpRequestDto, OtpVerifyDto } from './auth.dto';
import { OTP_SENDER, OtpSender } from './otp-sender';
import { OtpStore } from './otp-store';
import { SessionService } from './session.service';

@Controller('auth/otp')
export class AuthController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
    private readonly store: OtpStore,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post('request')
  @HttpCode(204)
  async request(@Body() dto: OtpRequestDto): Promise<void> {
    const phone = normalizeE164(dto.phone)!;
    if (!(await this.store.allowRequest(phone))) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = this.config.otpFixedCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.store.save(phone, code);
    const existing = await this.users.findByPhone(phone);
    await this.sender.send(phone, code, (existing?.locale as 'en' | 'hi') ?? 'en');
  }

  @Public()
  @Post('verify')
  @HttpCode(200)
  async verify(@Body() dto: OtpVerifyDto) {
    const phone = normalizeE164(dto.phone)!;
    if (!(await this.store.verify(phone, dto.code))) throw new UnauthorizedException('Wrong or expired code');
    const user = await this.users.findOrCreate(phone);
    return { token: this.sessions.issue(user.id), user: this.users.toApi(user) };
  }
}
