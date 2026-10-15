import { Inject, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { commandHandlers, queryHandlers } from './application/handlers';
import { QUOTE_REPOSITORY, QuoteRepository } from './domain/ports';
import { FilesModule } from '../files/files.module';
import { PgQuoteRepository } from './infrastructure/pg-quote-repository';
import { QuotesController } from './presentation/quotes.controller';

/** Marque expirés les devis dont la date de validité est passée. Idempotent : sûr avec plusieurs instances. */
@Injectable()
class QuoteExpiryJob implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(@Inject(QUOTE_REPOSITORY) private readonly repo: QuoteRepository) {}

  onModuleInit() {
    // ponytail: setInterval simple ; passer à une tâche BullMQ planifiée avec les autres jobs récurrents
    this.timer = setInterval(() => void this.repo.expireOverdue().catch(() => undefined), 3_600_000);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}

@Module({
  imports: [FilesModule],
  controllers: [QuotesController],
  providers: [...commandHandlers, ...queryHandlers, { provide: QUOTE_REPOSITORY, useClass: PgQuoteRepository }, QuoteExpiryJob],
})
export class QuotesModule {}
