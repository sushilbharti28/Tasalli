import { NotFoundException, ParseUUIDPipe } from '@nestjs/common';

/** Bad ids are reported as 404, the same as ids that belong to another family. */
export const UuidParam = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException() });
