import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Shared by main.ts and the API tests so both run the same validation. */
export function configureApp(app: INestApplication) {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Never echo submitted values (they may contain phone numbers) in error messages.
      validationError: { target: false, value: false },
    }),
  );
  app.enableShutdownHooks();
  return app;
}
