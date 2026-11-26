import { Controller, Get } from '@nestjs/common';
import { CALL_LANGUAGES } from '@tasalli/contracts';
import { Public } from '../common/decorators';

/** The app's language picker reads this, so a language turns on with an API deploy, not an app release. */
@Controller('call-languages')
export class CallLanguagesController {
  @Public()
  @Get()
  list() {
    return CALL_LANGUAGES;
  }
}
