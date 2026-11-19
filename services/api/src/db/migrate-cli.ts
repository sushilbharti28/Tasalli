import { Logger } from '@nestjs/common';
import { loadConfig } from '../config';
import { migrate } from './migrate';

const logger = new Logger('migrate');
migrate(loadConfig().databaseUrl, (m) => logger.log(m))
  .then((applied) => logger.log(applied.length ? `done (${applied.length} applied)` : 'up to date'))
  .catch((err) => {
    logger.error((err as Error).message);
    process.exit(1);
  });
