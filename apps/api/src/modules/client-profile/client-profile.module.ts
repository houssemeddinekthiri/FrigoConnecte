import { Body, Controller, Get, HttpCode, Module, Put } from '@nestjs/common';
import { updateClientProfileSchema, type ClientProfileDto, type UpdateClientProfileInput } from '@frigoconnect/contracts';
import { AuthUser, CurrentUser, Roles } from '../../shared/auth/auth';
import { Database } from '../../shared/infrastructure/database/database.service';
import { InvalidStateError } from '../../shared/kernel/errors';
import { ZodValidationPipe } from '../../shared/presentation/zod-validation.pipe';

/** Compte du client : identité (users) + société et facturation (clients) + logo (users.avatar_file_id). L'email se gère dans Keycloak. */
@Controller('client/profile')
@Roles('client')
class ClientProfileController {
  constructor(private readonly db: Database) {}

  @Get()
  async get(@CurrentUser() user: AuthUser): Promise<ClientProfileDto> {
    const [r] = await this.db.query(
      `SELECT u.email, u.first_name AS "firstName", u.last_name AS "lastName", u.phone, u.avatar_file_id AS "logoFileId", u.created_at AS "memberSince",
              c.client_type AS "clientType", c.company_name AS "companyName", c.siret, c.vat_number AS "vatNumber",
              c.billing_address AS "billingAddress", c.billing_postal_code AS "billingPostalCode", c.billing_city AS "billingCity"
         FROM users u JOIN clients c ON c.user_id = u.id WHERE u.id = $1`,
      [user.id],
    );
    return r as ClientProfileDto;
  }

  @Put()
  @HttpCode(204)
  async update(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(updateClientProfileSchema)) b: UpdateClientProfileInput) {
    await this.db.tx(async (c) => {
      if (b.logoFileId) {
        // le logo doit être une image envoyée et confirmée par ce client
        const { rowCount } = await c.query(`SELECT 1 FROM files WHERE id = $1 AND uploaded_by = $2 AND status = 'uploaded' AND mime_type LIKE 'image/%'`, [b.logoFileId, user.id]);
        if (!rowCount) throw new InvalidStateError('Logo invalide : envoyez une image (JPEG, PNG ou WebP)');
      }
      await c.query('UPDATE users SET first_name = $2, last_name = $3, phone = $4, avatar_file_id = $5 WHERE id = $1', [user.id, b.firstName, b.lastName, b.phone, b.logoFileId]);
      await c.query(
        `UPDATE clients SET client_type = $2, company_name = $3, siret = $4, vat_number = $5, billing_address = $6, billing_postal_code = $7, billing_city = $8 WHERE user_id = $1`,
        [user.id, b.clientType, b.clientType === 'individual' ? null : b.companyName, b.siret, b.vatNumber, b.billingAddress, b.billingPostalCode, b.billingCity],
      );
    });
  }
}

@Module({ controllers: [ClientProfileController] })
export class ClientProfileModule {}
