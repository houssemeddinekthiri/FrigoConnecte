import { Controller, Get, Module } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../../shared/auth/auth';
import { Database } from '../../shared/infrastructure/database/database.service';

/** Coffre du client : devis signés + paiements encaissés (pour la comptabilité). Lecture seule, filtrée par client. */
@Controller('client/documents')
@Roles('client')
class ClientDocumentsController {
  constructor(private readonly db: Database) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const [quotes, payments] = await Promise.all([
      this.db.query(
        `SELECT q.id, q.number, q.signed_pdf_file_id AS "fileId", CASE WHEN q.pdf_imported THEN q.pdf_file_id END AS "originalFileId", q.decided_at AS date, q.total_cents AS "totalCents",
                r.title AS "requestTitle", pr.company_name AS "providerName"
           FROM quotes q JOIN service_requests r ON r.id = q.request_id JOIN providers pr ON pr.user_id = q.provider_id
          WHERE r.client_id = $1 AND q.status = 'accepted' AND q.signed_pdf_file_id IS NOT NULL
          ORDER BY q.decided_at DESC LIMIT 200`,
        [user.id],
      ),
      this.db.query(
        `SELECT p.id, p.paid_at AS date, p.kind, p.status, p.amount_cents AS "amountCents",
                r.title AS "requestTitle", pr.company_name AS "providerName"
           FROM payments p JOIN contracts c ON c.id = p.contract_id JOIN service_requests r ON r.id = c.request_id
           JOIN providers pr ON pr.user_id = p.provider_id
          WHERE c.client_id = $1 AND p.paid_at IS NOT NULL
          ORDER BY p.paid_at DESC LIMIT 500`,
        [user.id],
      ),
    ]);
    return { quotes, payments };
  }
}

@Module({ controllers: [ClientDocumentsController] })
export class ClientDocumentsModule {}
