import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database.service';
import { NewUserRecord, UserRepository } from '../domain/ports';

@Injectable()
export class PgUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async createWithProfile(u: NewUserRecord): Promise<void> {
    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO users (id, keycloak_id, email, phone, first_name, last_name, role_code, status)
         VALUES ($1, $1, $2, $3, $4, $5, $6, 'active')`,
        [u.id, u.email, u.phone ?? null, u.firstName, u.lastName, u.role],
      );
      if (u.role === 'client') {
        await c.query('INSERT INTO clients (user_id, client_type, company_name) VALUES ($1,$2,$3)', [
          u.id, u.clientType, u.companyName ?? null,
        ]);
      }
    });
  }
}
