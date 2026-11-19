import { registerDecorator, ValidationOptions } from 'class-validator';
import { normalizeE164 } from './phone';
import { isValidTimeZone } from './timezone';

export function IsE164Phone(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isE164Phone',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be a valid phone number in E.164 form (+91...)`, ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && normalizeE164(v) !== null },
    });
}

export function IsIanaTimeZone(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isIanaTimeZone',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be an IANA time zone such as Asia/Kolkata`, ...options },
      validator: { validate: (v: unknown) => isValidTimeZone(v) },
    });
}

/** Rejects strings that are empty or only whitespace, but never alters the text (safety rule 1). */
export function IsNotBlank(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isNotBlank',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must not be blank`, ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && v.trim().length > 0 },
    });
}
