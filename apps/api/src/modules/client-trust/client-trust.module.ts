import { Controller, Get, Module, Param, ParseUUIDPipe } from '@nestjs/common';
import type { ClientTrustDto, RequestContextDto } from '@frigoconnect/contracts';
import { AuthUser, CurrentUser, Roles } from '../../shared/auth/auth';
import { Database } from '../../shared/infrastructure/database/database.service';
import { NotFoundError } from '../../shared/kernel/errors';
import { clientTrust } from './client-trust';

const FACTS_SQL = `
  SELECT (SELECT count(*)::int FROM contracts c WHERE c.client_id = u.id AND c.status = 'completed') AS "completedMissions",
         (SELECT count(*)::int FROM contracts c WHERE c.client_id = u.id AND (c.status = 'disputed' OR c.disputed_by = u.id)) AS disputes,
         (SELECT count(*)::int FROM payments p WHERE p.payer_id = u.id AND p.status = 'failed') AS "failedPayments",
         GREATEST(0, (extract(epoch FROM now() - u.created_at) / 2629800)::int) AS "memberMonths",
         u.phone IS NOT NULL AS "hasPhone", (cl.company_name IS NOT NULL AND cl.siret IS NOT NULL) AS "hasCompany"
    FROM users u JOIN clients cl ON cl.user_id = u.id WHERE u.id = $1`;

@Controller()
class ClientTrustController {
  constructor(private readonly db: Database) {}

  private async trustOf(clientId: string): Promise<ClientTrustDto> {
    const [facts] = await this.db.query(FACTS_SQL, [clientId]);
    if (!facts) throw new NotFoundError('Client');
    return clientTrust(facts as never);
  }

  /** Le client voit son propre score et comment le faire progresser. */
  @Get('client/trust')
  @Roles('client')
  mine(@CurrentUser() user: AuthUser) {
    return this.trustOf(user.id);
  }

  /** Le prestataire mis en relation (ou ayant déjà chiffré) voit le budget et le niveau de confiance du client — jamais son identité ni son score. */
  @Get('provider/requests/:id/context')
  @Roles('provider')
  async context(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<RequestContextDto> {
    const [r] = await this.db.query(
      `SELECT r.client_id AS "clientId", r.budget_min_cents AS "budgetMinCents", r.budget_max_cents AS "budgetMaxCents"
         FROM service_requests r
        WHERE r.id = $1 AND (EXISTS (SELECT 1 FROM request_matches m WHERE m.request_id = r.id AND m.provider_id = $2)
                          OR EXISTS (SELECT 1 FROM quotes q WHERE q.request_id = r.id AND q.provider_id = $2))`,
      [id, user.id],
    );
    if (!r) throw new NotFoundError('Demande');
    const { score: _s, tips: _t, ...trust } = await this.trustOf(r.clientId);
    return { budgetMinCents: r.budgetMinCents, budgetMaxCents: r.budgetMaxCents, trust };
  }
}

@Module({ controllers: [ClientTrustController] })
export class ClientTrustModule {}
