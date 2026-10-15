import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { PoolClient } from 'pg';
import { DomainEvent } from '../../kernel/aggregate-root';
import { Database } from '../database/database.service';

/** Événement transporté entre modules. Les consommateurs filtrent sur `type`. */
export class IntegrationEvent {
  constructor(readonly type: string, readonly payload: Record<string, unknown>) {}
}

/** À appeler dans la MÊME transaction que l'écriture de l'agrégat. */
export async function writeOutbox(client: PoolClient, aggregateType: string, aggregateId: string, events: DomainEvent[]) {
  for (const e of events) {
    await client.query(
      'INSERT INTO outbox_events (aggregate_type, aggregate_id, type, payload) VALUES ($1,$2,$3,$4)',
      [aggregateType, aggregateId, e.type, JSON.stringify(e.payload)],
    );
  }
}

// ponytail: polling 1 s, livraison at-least-once en processus. Passer à Redis Streams + consumer groups si plusieurs instances/consommateurs lents.
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly db: Database, private readonly bus: EventBus) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.db.tx(async (c) => {
        const { rows } = await c.query(
          'SELECT id, type, payload FROM outbox_events WHERE published_at IS NULL ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED',
        );
        for (const r of rows) this.bus.publish(new IntegrationEvent(r.type, r.payload));
        if (rows.length) await c.query('UPDATE outbox_events SET published_at = now() WHERE id = ANY($1)', [rows.map((r) => r.id)]);
      });
    } catch (e) {
      this.log.error(e);
    } finally {
      this.busy = false;
    }
  }
}

@Module({ providers: [OutboxRelay] })
export class OutboxModule {}
