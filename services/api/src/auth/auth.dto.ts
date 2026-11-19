import { IsString, Matches } from 'class-validator';
import { IsE164Phone } from '../common/validators';

export class OtpRequestDto {
  @IsString()
  @IsE164Phone()
  phone: string;
}

export class OtpVerifyDto {
  @IsString()
  @IsE164Phone()
  phone: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}
