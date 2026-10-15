export interface DomainEvent {
  readonly type: string; // ex: 'service_request.created'
  readonly payload: Record<string, unknown>;
}

export abstract class AggregateRoot {
  private events: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.events.push(event);
  }

  pullEvents(): DomainEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
