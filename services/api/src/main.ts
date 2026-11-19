import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { RedactingLogger } from './common/logger';
import { loadConfig } from './config';
import { migrate } from './db/migrate';

async function main() {
  const config = loadConfig();
  const logger = new RedactingLogger();
  if (process.env.MIGRATE_ON_START !== 'false') await migrate(config.databaseUrl, (m) => logger.log(m, 'migrate'));
  const app = configureApp(await NestFactory.create(AppModule.forRoot(config), { logger }));
  await app.listen(config.port);
  new Logger('main').log(`api listening on ${config.port} (${config.env})`);
}

main().catch((err) => {
  new RedactingLogger().error(err);
  process.exit(1);
});
