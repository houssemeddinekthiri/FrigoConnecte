import { Body, Controller, Get, HttpCode, Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler, IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';
import type { QueryResultRow } from 'pg';
import type { ContractDocumentDto, ContractDto, PaymentStatus } from '@frigoconnect/contracts';
import { addContractDocumentSchema, listContractsSchema, openDisputeSchema } from '@frigoconnect/contracts';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../../shared/auth/auth';
import { Database } from '../../shared/infrastructure/database/database.service';
import { writeOutbox } from '../../shared/infrastructure/outbox/outbox';
import { InvalidStateError, NotFoundError } from '../../shared/kernel/errors';
import { ZodValidationPipe } from '../../shared/presentation/zod-validation.pipe';
import { actionsFor, assertCanDeclareDone, assertCanValidate, AUTO_VALIDATE_DAYS, autoValidationOutcome, balanceCents, ContractState, PAID_STATUSES, Party } from './domain/contract-rules';

// ---------- Accès aux données (une seule classe : le module reste petit) ----------
interface ContractRow extends ContractState { id: string; clientId: string; providerId: string; requestId: string }

@Injectable()
export class ContractsRepo {
  constructor(private readonly db: Database) {}

  private static readonly STATE = `c.id, c.client_id, c.provider_id, c.request_id, c.status, c.total_cents, c.deposit_cents, c.work_done_at,
    EXISTS (SELECT 1 FROM payments p WHERE p.contract_id = c.id AND p.kind = 'deposit' AND p.status = ANY($PAID::payment_status[])) AS deposit_paid,
    EXISTS (SELECT 1 FROM payments p WHERE p.contract_id = c.id AND p.kind = 'balance' AND p.status = ANY($PAID::payment_status[])) AS balance_paid`;

  private toState(r: QueryResultRow): ContractRow {
    return { id: r.id, clientId: r.client_id, providerId: r.provider_id, requestId: r.request_id, status: r.status, totalCents: r.total_cents, depositCents: r.deposit_cents, workDoneAt: r.work_done_at, depositPaid: r.deposit_paid, balancePaid: r.balance_paid };
  }

  async state(id: string): Promise<ContractRow | null> {
    const [r] = await this.db.query(`SELECT ${ContractsRepo.STATE.replaceAll('$PAID', '$2')} FROM contracts c WHERE c.id = $1`, [id, PAID_STATUSES]);
    return r ? this.toState(r) : null;
  }

  async dueForAutoValidation(): Promise<ContractRow[]> {
    const rows = await this.db.query(
      `SELECT ${ContractsRepo.STATE.replaceAll('$PAID', '$1')} FROM contracts c WHERE c.status = 'active' AND c.work_done_at IS NOT NULL AND c.auto_validate_at <= now()`,
      [PAID_STATUSES],
    );
    return rows.map((r) => this.toState(r));
  }

  async markWorkDone(id: string, providerId: string, clientId: string) {
    await this.db.tx(async (c) => {
      const { rowCount } = await c.query(
        `UPDATE contracts SET work_done_at = now(), auto_validate_at = now() + make_interval(days => $2) WHERE id = $1 AND status = 'active' AND work_done_at IS NULL`,
        [id, AUTO_VALIDATE_DAYS],
      );
      if (!rowCount) throw new InvalidStateError('Intervention déjà déclarée ou contrat inactif');
      await writeOutbox(c, 'contract', id, [{ type: 'contract.work_done', payload: { contractId: id, clientId, providerId, autoValidateDays: AUTO_VALIDATE_DAYS } }]);
    });
  }

  /** Validation (par le client ou d'office) : contrat terminé, demande terminée, compteur du prestataire, et déclenchement du versement. */
  async complete(id: string, auto: boolean) {
    await this.db.tx(async (c) => {
      const { rows } = await c.query(
        `UPDATE contracts SET status = 'completed', client_validated_at = now() WHERE id = $1 AND status = 'active' AND work_done_at IS NOT NULL RETURNING request_id, provider_id, client_id`,
        [id],
      );
      if (!rows.length) throw new InvalidStateError('Ce contrat ne peut plus être validé');
      const k = rows[0];
      // ponytail: miroir SQL de ServiceRequest (awarded|in_progress -> completed), comme à la Phase 10
      await c.query(`UPDATE service_requests SET status = 'completed' WHERE id = $1 AND status IN ('awarded','in_progress')`, [k.request_id]);
      await c.query('UPDATE providers SET completed_missions = completed_missions + 1 WHERE user_id = $1', [k.provider_id]);
      await writeOutbox(c, 'contract', id, [{ type: 'contract.validated', payload: { contractId: id, providerId: k.provider_id, clientId: k.client_id, auto } }]);
    });
  }

  async dispute(id: string, reason: string) {
    await this.db.tx(async (c) => {
      const { rows } = await c.query(`UPDATE contracts SET status = 'disputed' WHERE id = $1 AND status = 'active' RETURNING client_id, provider_id`, [id]);
      if (rows.length) await writeOutbox(c, 'contract', id, [{ type: 'contract.disputed', payload: { contractId: id, clientId: rows[0].client_id, providerId: rows[0].provider_id, source: reason } }]);
    });
  }

  /** Litige ouvert à la main par l'une des parties : les fonds restent conservés jusqu'à la décision de l'administration. */
  async openDispute(id: string, userId: string, reason: string) {
    await this.db.tx(async (c) => {
      const { rows } = await c.query(
        `UPDATE contracts SET status = 'disputed', dispute_reason = $3, disputed_by = $2, disputed_at = now()
          WHERE id = $1 AND status = 'active' AND $2 IN (client_id, provider_id) RETURNING client_id, provider_id`,
        [id, userId, reason],
      );
      if (!rows.length) throw new InvalidStateError('Ce contrat ne peut plus être mis en litige');
      await writeOutbox(c, 'contract', id, [{ type: 'contract.disputed', payload: { contractId: id, clientId: rows[0].client_id, providerId: rows[0].provider_id, source: 'opened_by_party', openedBy: userId } }]);
    });
  }

  async documents(id: string, userId: string): Promise<ContractDocumentDto[]> {
    const rows = await this.db.query(
      `SELECT d.id, d.file_id, d.kind, d.uploaded_by, d.created_at, f.original_name FROM contract_documents d JOIN files f ON f.id = d.file_id WHERE d.contract_id = $1 ORDER BY d.created_at DESC`,
      [id],
    );
    return rows.map((r) => ({ id: r.id, fileId: r.file_id, kind: r.kind, name: r.original_name, mine: r.uploaded_by === userId, createdAt: r.created_at.toISOString() }));
  }

  /** Le fichier doit être celui de l'utilisateur et déjà reçu par le stockage ; un fichier ne se rattache qu'une fois. */
  async addDocument(id: string, userId: string, fileId: string, kind: string) {
    const [f] = await this.db.query(`SELECT 1 FROM files WHERE id = $1 AND uploaded_by = $2 AND status = 'uploaded'`, [fileId, userId]);
    if (!f) throw new NotFoundError('Fichier');
    await this.db.query('INSERT INTO contract_documents (contract_id, file_id, kind, uploaded_by) VALUES ($1,$2,$3,$4) ON CONFLICT (file_id) DO NOTHING', [id, fileId, kind, userId]);
  }

  async list(userId: string, party: Party, requestId?: string): Promise<ContractDto[]> {
    const rows = await this.db.query(
      `SELECT ${ContractsRepo.STATE.replaceAll('$PAID', '$3')}, c.quote_id, c.subtotal_cents, c.auto_validate_at, c.client_validated_at, r.title,
              EXISTS (SELECT 1 FROM reviews rv WHERE rv.contract_id = c.id AND rv.author_id = $1) AS reviewed,
              CASE WHEN c.client_id = $1 THEN pr.company_name ELSE u.first_name || ' ' || left(u.last_name, 1) || '.' END AS counterpart
         FROM contracts c
         JOIN service_requests r ON r.id = c.request_id
         JOIN providers pr ON pr.user_id = c.provider_id
         JOIN users u ON u.id = c.client_id
        WHERE (c.client_id = $1 OR c.provider_id = $1) AND ($2::uuid IS NULL OR c.request_id = $2)
        ORDER BY c.created_at DESC LIMIT 50`,
      [userId, requestId ?? null, PAID_STATUSES],
    );
    if (!rows.length) return [];
    const pays = await this.db.query(`SELECT id, contract_id, kind, status, amount_cents, provider_amount_cents, platform_fee_cents FROM payments WHERE contract_id = ANY($1) AND kind IN ('deposit','balance') AND status <> 'failed' ORDER BY created_at`, [rows.map((r) => r.id)]);
    return rows.map((r) => {
      const s = this.toState(r);
      return {
        id: r.id, requestId: r.request_id, quoteId: r.quote_id, requestTitle: r.title, counterpartName: r.counterpart, status: r.status,
        totalCents: r.total_cents, depositCents: r.deposit_cents, balanceCents: balanceCents(s),
        workDoneAt: r.work_done_at?.toISOString() ?? null, autoValidateAt: r.auto_validate_at?.toISOString() ?? null, clientValidatedAt: r.client_validated_at?.toISOString() ?? null,
        payments: pays.filter((p) => p.contract_id === r.id).map((p) => ({
          id: p.id, kind: p.kind, status: p.status as PaymentStatus, amountCents: p.amount_cents,
          // la ventilation commission / net n'est montrée qu'au prestataire
          providerCents: party === 'provider' ? p.provider_amount_cents : null, feeCents: party === 'provider' ? p.platform_fee_cents : null,
        })),
        actions: { ...actionsFor(s, party), review: r.status === 'completed' && !r.reviewed }, // l'avis est possible une fois le contrat terminé, une fois par partie
      };
    });
  }
}

const partyOf = (c: { clientId: string; providerId: string }, userId: string): Party | null => (c.clientId === userId ? 'client' : c.providerId === userId ? 'provider' : null);

// ---------- Cas d'usage ----------
export class DeclareWorkDoneCommand { constructor(readonly user: AuthUser, readonly id: string) {} }
export class ValidateContractCommand { constructor(readonly user: AuthUser, readonly id: string) {} }
export class OpenDisputeCommand { constructor(readonly user: AuthUser, readonly id: string, readonly reason: string) {} }
export class AddContractDocumentCommand { constructor(readonly user: AuthUser, readonly id: string, readonly fileId: string, readonly kind: string) {} }
export class ListContractsQuery { constructor(readonly user: AuthUser, readonly requestId?: string) {} }
export class GetContractQuery { constructor(readonly user: AuthUser, readonly id: string) {} }

@CommandHandler(DeclareWorkDoneCommand)
class DeclareWorkDoneHandler implements ICommandHandler<DeclareWorkDoneCommand, void> {
  constructor(private readonly repo: ContractsRepo) {}
  async execute({ user, id }: DeclareWorkDoneCommand) {
    const c = await this.repo.state(id);
    if (!c || c.providerId !== user.id) throw new NotFoundError('Contrat');
    assertCanDeclareDone(c);
    await this.repo.markWorkDone(id, c.providerId, c.clientId);
  }
}

@CommandHandler(ValidateContractCommand)
class ValidateContractHandler implements ICommandHandler<ValidateContractCommand, void> {
  constructor(private readonly repo: ContractsRepo) {}
  async execute({ user, id }: ValidateContractCommand) {
    const c = await this.repo.state(id);
    if (!c || c.clientId !== user.id) throw new NotFoundError('Contrat');
    assertCanValidate(c);
    await this.repo.complete(id, false);
  }
}

@CommandHandler(OpenDisputeCommand)
class OpenDisputeHandler implements ICommandHandler<OpenDisputeCommand, void> {
  constructor(private readonly repo: ContractsRepo) {}
  async execute({ user, id, reason }: OpenDisputeCommand) {
    const c = await this.repo.state(id);
    const party = c && partyOf(c, user.id);
    if (!c || !party) throw new NotFoundError('Contrat');
    if (!actionsFor(c, party).dispute) throw new InvalidStateError('Ce contrat ne peut pas être mis en litige maintenant');
    await this.repo.openDispute(id, user.id, reason);
  }
}

@CommandHandler(AddContractDocumentCommand)
class AddContractDocumentHandler implements ICommandHandler<AddContractDocumentCommand, void> {
  constructor(private readonly repo: ContractsRepo) {}
  async execute({ user, id, fileId, kind }: AddContractDocumentCommand) {
    const c = await this.repo.state(id);
    if (!c || !partyOf(c, user.id)) throw new NotFoundError('Contrat');
    await this.repo.addDocument(id, user.id, fileId, kind);
  }
}

@QueryHandler(ListContractsQuery)
class ListContractsHandler implements IQueryHandler<ListContractsQuery, ContractDto[]> {
  constructor(private readonly repo: ContractsRepo) {}
  execute({ user, requestId }: ListContractsQuery) {
    return this.repo.list(user.id, user.roles.includes('provider') ? 'provider' : 'client', requestId);
  }
}

@QueryHandler(GetContractQuery)
class GetContractHandler implements IQueryHandler<GetContractQuery, ContractDto> {
  constructor(private readonly repo: ContractsRepo) {}
  async execute({ user, id }: GetContractQuery) {
    const state = await this.repo.state(id);
    const party = state && partyOf(state, user.id);
    if (!state || !party) throw new NotFoundError('Contrat');
    return (await this.repo.list(user.id, party)).find((c) => c.id === id) ?? Promise.reject(new NotFoundError('Contrat'));
  }
}

// ---------- API ----------
@Controller('contracts')
class ContractsController {
  constructor(private readonly commands: CommandBus, private readonly queries: QueryBus, private readonly repo: ContractsRepo) {}

  @Get()
  @Roles('client', 'provider')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listContractsSchema)) q: z.output<typeof listContractsSchema>) {
    return this.queries.execute(new ListContractsQuery(user, q.requestId));
  }

  @Get(':id')
  @Roles('client', 'provider')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.queries.execute(new GetContractQuery(user, id));
  }

  @Get(':id/documents')
  @Roles('client', 'provider')
  async documents(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.repo.state(id);
    if (!c || !partyOf(c, user.id)) throw new NotFoundError('Contrat');
    return this.repo.documents(id, user.id);
  }

  @Post(':id/documents')
  @Roles('client', 'provider')
  @HttpCode(204)
  async addDocument(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(addContractDocumentSchema)) body: z.output<typeof addContractDocumentSchema>) {
    await this.commands.execute(new AddContractDocumentCommand(user, id, body.fileId, body.kind));
  }

  @Post(':id/work-done')
  @Roles('provider')
  @HttpCode(204)
  async workDone(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.commands.execute(new DeclareWorkDoneCommand(user, id));
  }

  @Post(':id/dispute')
  @Roles('client', 'provider')
  @HttpCode(204)
  async dispute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(openDisputeSchema)) body: z.output<typeof openDisputeSchema>) {
    await this.commands.execute(new OpenDisputeCommand(user, id, body.reason));
  }

  @Post(':id/validate')
  @Roles('client')
  @HttpCode(204)
  async validate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.commands.execute(new ValidateContractCommand(user, id));
  }
}

/** Validation d'office à J+7 (ou litige si le solde n'est pas réglé). Idempotent : chaque transition est conditionnée à l'état. */
@Injectable()
class AutoValidationJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AutoValidationJob.name);
  private timer?: NodeJS.Timeout;
  constructor(@Inject(ContractsRepo) private readonly repo: ContractsRepo) {}

  onModuleInit() {
    // ponytail: toutes les 15 min via setInterval ; BullMQ avec les autres tâches planifiées
    this.timer = setInterval(() => void this.run(), 15 * 60_000);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  async run() {
    try {
      for (const c of await this.repo.dueForAutoValidation()) {
        try {
          if (autoValidationOutcome(c) === 'validate') await this.repo.complete(c.id, true);
          else await this.repo.dispute(c.id, 'balance_unpaid_after_auto_validation_delay');
        } catch (e) {
          this.log.warn(`auto-validation ${c.id} : ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.log.error(e);
    }
  }
}

@Module({
  controllers: [ContractsController],
  providers: [ContractsRepo, DeclareWorkDoneHandler, ValidateContractHandler, OpenDisputeHandler, AddContractDocumentHandler, ListContractsHandler, GetContractHandler, AutoValidationJob],
})
export class ContractsModule {}
