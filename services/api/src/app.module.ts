import { DynamicModule, Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import Redis from 'ioredis';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { FakeOtpSender, OTP_SENDER } from './auth/otp-sender';
import { OtpStore, REDIS } from './auth/otp-store';
import { SessionService } from './auth/session.service';
import { BILLING_PROVIDER, FakeBillingProvider } from './billing/billing-provider';
import { BillingWebhookController } from './billing/billing-webhook.controller';
import { SubscriptionController } from './billing/subscription.controller';
import { TestCallController } from './calls/test-call.controller';
import { CLOCK, SystemClock } from './common/clock';
import { AppConfig, CONFIG, loadConfig } from './config';
import { Db } from './db/db.service';
import { ApiEventsWorker } from './doses/api-events.worker';
import { DoseGenerator } from './doses/dose-generator.service';
import { DosesController } from './doses/doses.controller';
import { DosesService } from './doses/doses.service';
import { HealthController } from './health/health.controller';
import { MEDICINE_NAME_SOURCE, SeedMedicineNameSource } from './medicines/medicine-names';
import { MedicinesController } from './medicines/medicines.controller';
import { MedicinesService } from './medicines/medicines.service';
import { FakeScriptPreviewer, SCRIPT_PREVIEWER } from './medicines/script-previewer';
import { PeopleController } from './people/people.controller';
import { PeopleService } from './people/people.service';
import { EventsService } from './queues/events.service';
import { BullJobPublisher, JOB_PUBLISHER } from './queues/job-publisher';
import { MeController } from './users/me.controller';
import { UsersService } from './users/users.service';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig = loadConfig()): DynamicModule {
    const providers: Provider[] = [
      { provide: CONFIG, useValue: config },
      { provide: CLOCK, useClass: SystemClock },
      { provide: REDIS, useFactory: () => new Redis(config.redisUrl, { lazyConnect: false }) },
      { provide: JOB_PUBLISHER, useClass: BullJobPublisher },
      // Fakes only (founder rule: no paid services). Real ones implement the same interfaces.
      { provide: OTP_SENDER, useClass: FakeOtpSender },
      { provide: BILLING_PROVIDER, useClass: FakeBillingProvider },
      { provide: SCRIPT_PREVIEWER, useClass: FakeScriptPreviewer },
      { provide: MEDICINE_NAME_SOURCE, useClass: SeedMedicineNameSource },
      { provide: APP_GUARD, useClass: AuthGuard },
      Db, AuditService, OtpStore, SessionService, UsersService, EventsService,
      PeopleService, MedicinesService, DoseGenerator, DosesService, ApiEventsWorker,
    ];
    return {
      module: AppModule,
      controllers: [
        HealthController, AuthController, MeController, PeopleController, MedicinesController,
        DosesController, TestCallController, SubscriptionController, BillingWebhookController,
      ],
      providers,
    };
  }
}
