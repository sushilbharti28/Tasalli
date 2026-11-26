import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CALL_LANGUAGES as CALL_LANGUAGE_INFO } from '@tasalli/contracts';
import { IsE164Phone, IsIanaTimeZone, IsNotBlank } from '../common/validators';

export const CALL_LANGUAGES = ['hi', 'en', 'bn', 'mr', 'ta', 'te'] as const;
export type CallLanguage = (typeof CALL_LANGUAGES)[number];
/** Languages new people can be set to: those marked available in packages/contracts (GET /call-languages serves the same list). */
export const SUPPORTED_NEW_LANGUAGES: readonly CallLanguage[] = CALL_LANGUAGE_INFO.filter((l) => l.status === 'available').map((l) => l.code);
export const CAN_READ = ['yes', 'no', 'not_sure'] as const;

export class PersonCreateDto {
  @IsBoolean() isSelf: boolean;
  @IsString() @IsNotBlank() @MaxLength(40) nickname: string;
  /** Required (v1.6): calls greet the parent by its first word, never by the nickname. */
  @IsString() @IsNotBlank() @MaxLength(80) fullName: string;
  /** Required unless isSelf (then the OTP-verified account number is used and this is ignored). */
  @ValidateIf((o: PersonCreateDto) => o.isSelf !== true)
  @IsString()
  @IsE164Phone()
  phone?: string;
  @IsIn(CALL_LANGUAGES) language: CallLanguage;
  @IsOptional() @IsString() @IsIanaTimeZone() timeZone?: string;
  @IsOptional() @IsIn(CAN_READ) canReadStrip?: (typeof CAN_READ)[number];
}

export class PersonUpdateDto {
  @IsOptional() @IsString() @IsNotBlank() @MaxLength(40) nickname?: string;
  @IsOptional() @IsString() @IsNotBlank() @MaxLength(80) fullName?: string;
  @IsOptional() @IsIn(CALL_LANGUAGES) language?: CallLanguage;
  @IsOptional() @IsString() @IsIanaTimeZone() timeZone?: string;
  @IsOptional() @IsBoolean() paused?: boolean;
  @IsOptional() @IsIn(CAN_READ) canReadStrip?: (typeof CAN_READ)[number];
}
