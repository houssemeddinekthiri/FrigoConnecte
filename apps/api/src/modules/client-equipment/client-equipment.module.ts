import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createEquipmentSchema, type CreateEquipmentInput, type EquipmentDto } from '@frigoconnect/contracts';
import { AuthUser, CurrentUser, Roles } from '../../shared/auth/auth';
import { Database } from '../../shared/infrastructure/database/database.service';
import { ZodValidationPipe } from '../../shared/presentation/zod-validation.pipe';

/** CRUD volontairement direct (pas de règle métier) : chaque requête est filtrée par client_id = utilisateur connecté. */
@Controller('client-equipment')
@Roles('client')
export class ClientEquipmentController {
  constructor(private readonly db: Database) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<EquipmentDto[]> {
    return this.db.query<EquipmentDto>(
      `SELECT e.id, e.label, e.trade, e.details, e.address, e.postal_code AS "postalCode", e.city, e.created_at AS "createdAt",
              (SELECT max(r.updated_at) FROM service_requests r WHERE r.client_equipment_id = e.id AND r.status = 'completed') AS "lastServiceAt"
         FROM client_equipment e WHERE e.client_id = $1 ORDER BY e.created_at DESC LIMIT 100`,
      [user.id],
    );
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createEquipmentSchema)) b: CreateEquipmentInput) {
    const [row] = await this.db.query(
      `INSERT INTO client_equipment (client_id, label, trade, details, address, postal_code, city, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [user.id, b.label, b.trade, b.details ?? null, b.address, b.postalCode, b.city, b.location.lat, b.location.lng],
    );
    return { id: row.id as string };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.query('DELETE FROM client_equipment WHERE id = $1 AND client_id = $2', [id, user.id]);
  }
}

@Module({ controllers: [ClientEquipmentController] })
export class ClientEquipmentModule {}
