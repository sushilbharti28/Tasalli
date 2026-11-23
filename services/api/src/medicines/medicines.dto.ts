import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches,
  Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { IsNotBlank } from '../common/validators';

export const KINDS = ['tablet', 'capsule', 'syrup', 'other'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class AppearanceDto {
  @IsOptional() @IsString() @MaxLength(30) colourPrimary?: string;
  @IsOptional() @IsString() @MaxLength(30) colourSecondary?: string;
  @IsOptional() @IsIn(['round', 'oval', 'long', 'square']) shape?: string;
  @IsOptional() @IsIn(['very_small', 'small', 'large']) size?: string;
  @IsOptional() @IsIn(['plain', 'line', 'letters', 'unknown']) marking?: string;
  @IsOptional() @IsIn(['strip', 'loose', 'bottle']) keptIn?: string;
  @IsOptional() @IsString() @MaxLength(30) packColour?: string;
  @IsOptional() @IsString() @MaxLength(30) printColour?: string;
  @IsOptional() @IsString() @MaxLength(30) capColour?: string;
}

export class ScheduleInputDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'localTime must be HH:MM (24 hour)' }) localTime: string;
  /** Verbatim as the family entered it (safety rule 1): never parsed or changed. */
  @IsString() @IsNotBlank() @MaxLength(60) amountText: string;
  @IsIn(['before', 'after', 'with', 'any']) food: 'before' | 'after' | 'with' | 'any';
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  daysOfWeek?: number[];
  @IsOptional() @Matches(DATE, { message: 'startDate must be YYYY-MM-DD' }) startDate?: string;
  @IsOptional() @Matches(DATE, { message: 'endDate must be YYYY-MM-DD' }) endDate?: string | null;
}

export class MedicineCreateDto {
  @IsIn(KINDS) kind: (typeof KINDS)[number];
  @IsString() @IsNotBlank() @MaxLength(80) stripName: string;
  /** "5 mg" as printed; never parsed (safety rule 1). */
  @IsOptional() @IsString() @MaxLength(40) strengthText?: string;
  @IsString() @IsNotBlank() @MinLength(1) @MaxLength(60) spokenName: string;
  @IsOptional() @ValidateNested() @Type(() => AppearanceDto) appearance?: AppearanceDto;
  @IsOptional() @IsInt() @Min(1) @Max(99) numberLabel?: number | null;
  @IsOptional() @IsBoolean() sayPrintedName?: boolean;
  @IsOptional() @IsString() @MaxLength(200) extraInstruction?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => ScheduleInputDto)
  schedules: ScheduleInputDto[];
}

/** Appearance fields that make no sense for a kind are rejected rather than silently stored. */
/**
 * v1.6: the look fields the reminder call describes must be there (the app's add-medicine form already asks for them).
 * Mirrors apps/mobile/src/features/medicine/draft.ts (steps "looks" and "kept"). A strip also needs its colour.
 */
export const REQUIRED_FOR_KIND: Record<(typeof KINDS)[number], (keyof AppearanceDto)[]> = {
  tablet: ['colourPrimary', 'shape', 'size', 'keptIn'],
  capsule: ['colourPrimary', 'size', 'keptIn'],
  syrup: ['keptIn', 'packColour'],
  other: [],
};

export const NOT_FOR_KIND: Record<(typeof KINDS)[number], (keyof AppearanceDto)[]> = {
  tablet: ['colourSecondary', 'capColour'],
  capsule: ['capColour'],
  syrup: ['colourPrimary', 'colourSecondary', 'shape', 'size', 'marking'],
  other: [],
};
