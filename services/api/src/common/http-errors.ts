import { ConflictException } from '@nestjs/common';

/** 409 with a machine-readable code the app can switch on. */
export function conflict(code: string, message: string) {
  return new ConflictException({ statusCode: 409, code, message });
}
