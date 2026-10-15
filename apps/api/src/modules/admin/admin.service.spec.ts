import { AuthUser } from '../../shared/auth/auth';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../../shared/kernel/errors';
import { IdentityProvider } from '../identity/domain/ports';
import { AdminService } from './admin.service';

const admin: AuthUser = { id: 'admin-1', roles: ['super_admin'] };

/** Base simulée : `tx` exécute la fonction avec un client dont les réponses dépendent du SQL ; on enregistre tout ce qui est écrit. */
function setup(answers: Array<[RegExp, unknown[]]>) {
  const writes: string[] = [];
  const client = {
    query: jest.fn(async (sql: string, _params?: unknown[]) => {
      const hit = answers.find(([re]) => re.test(sql));
      if (!/^\s*SELECT/i.test(sql)) writes.push(sql.replace(/\s+/g, ' ').trim().slice(0, 60));
      const rows = (hit?.[1] ?? []) as unknown[];
      return { rows, rowCount: rows.length };
    }),
  };
  const db = { tx: jest.fn(async (fn: (c: typeof client) => unknown) => fn(client)), query: jest.fn().mockResolvedValue([]) };
  const idp = { setEnabled: jest.fn().mockResolvedValue(undefined), logout: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<IdentityProvider>;
  return { svc: new AdminService(db as never, idp), writes, idp, client };
}
const audited = (w: string[]) => w.some((s) => s.startsWith('INSERT INTO audit_logs'));

describe('AdminService — utilisateurs', () => {
  it('ne peut pas se suspendre soi-même', async () => {
    const { svc, idp } = setup([]);
    await expect(svc.setUserSuspended(admin, 'admin-1', true, 'x', '1.2.3.4')).rejects.toBeInstanceOf(ForbiddenError);
    expect(idp.setEnabled).not.toHaveBeenCalled();
  });

  it('ne peut pas suspendre un autre administrateur', async () => {
    const { svc, idp, writes } = setup([[/FROM users/, [{ role_code: 'super_admin', status: 'active' }]]]);
    await expect(svc.setUserSuspended(admin, 'admin-2', true, 'x', '1.2.3.4')).rejects.toBeInstanceOf(ForbiddenError);
    expect(idp.setEnabled).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('suspension : statut + audit dans la transaction, puis Keycloak désactivé et sessions coupées', async () => {
    const { svc, idp, writes } = setup([[/FROM users/, [{ role_code: 'client', status: 'active' }]]]);
    await svc.setUserSuspended(admin, 'u1', true, 'fraude', '1.2.3.4');
    expect(writes.some((s) => s.startsWith('UPDATE users SET status'))).toBe(true);
    expect(audited(writes)).toBe(true);
    expect(idp.setEnabled).toHaveBeenCalledWith('u1', false);
    expect(idp.logout).toHaveBeenCalledWith('u1');
  });

  it('rejouée (déjà suspendu) : pas de doublon d\'audit, mais Keycloak est resynchronisé', async () => {
    const { svc, idp, writes } = setup([[/FROM users/, [{ role_code: 'client', status: 'suspended' }]]]);
    await svc.setUserSuspended(admin, 'u1', true, 'fraude', '1.2.3.4');
    expect(audited(writes)).toBe(false);
    expect(idp.setEnabled).toHaveBeenCalledWith('u1', false);
  });

  it('réactivation : rouvre la connexion sans couper de session', async () => {
    const { svc, idp } = setup([[/FROM users/, [{ role_code: 'client', status: 'suspended' }]]]);
    await svc.setUserSuspended(admin, 'u1', false, undefined, '1.2.3.4');
    expect(idp.setEnabled).toHaveBeenCalledWith('u1', true);
    expect(idp.logout).not.toHaveBeenCalled();
  });

  it('utilisateur inconnu : 404', async () => {
    const { svc } = setup([]);
    await expect(svc.setUserSuspended(admin, 'ghost', true, 'x', '1.2.3.4')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('AdminService — validation des prestataires', () => {
  const lock = [/FOR UPDATE/, [{ status: 'pending_review', trades: ['refrigeration'] }]] as [RegExp, unknown[]];
  const fluidCert = { type: 'fluid_handling_cat1', review_status: 'approved', expires_on: null };

  it('refuse l\'approbation tant qu\'un document reste à examiner : rien n\'est écrit', async () => {
    const { svc, writes } = setup([lock, [/FROM provider_certifications/, [fluidCert, { ...fluidCert, type: 'rge', review_status: 'pending' }]]]);
    await expect(svc.approve(admin, 'p1', '1.2.3.4')).rejects.toThrow(/restent à examiner/);
    expect(writes).toEqual([]);
  });

  it('refuse sans attestation de capacité valide (froid)', async () => {
    const { svc, writes } = setup([lock, [/FROM provider_certifications/, []]]);
    await expect(svc.approve(admin, 'p1', '1.2.3.4')).rejects.toBeInstanceOf(InvalidStateError);
    expect(writes).toEqual([]);
  });

  it('dossier complet : statut, audit et notification dans la même transaction', async () => {
    const { svc, writes } = setup([lock, [/FROM provider_certifications/, [fluidCert]]]);
    await svc.approve(admin, 'p1', '1.2.3.4');
    expect(writes.some((s) => s.startsWith('UPDATE providers SET status'))).toBe(true);
    expect(audited(writes)).toBe(true);
    expect(writes.some((s) => s.startsWith('INSERT INTO outbox_events'))).toBe(true);
  });

  it('un refus exige un dossier en attente', async () => {
    const { svc } = setup([[/FOR UPDATE/, [{ status: 'approved', trades: ['heating'] }]]]);
    await expect(svc.reject(admin, 'p1', 'documents illisibles', '1.2.3.4')).rejects.toBeInstanceOf(InvalidStateError);
  });
});

describe('AdminService — litiges et commissions', () => {
  it('clôturer un litige en « terminé » exige que le travail ait été déclaré', async () => {
    const { svc, writes } = setup([[/FROM contracts/, [{ request_id: 'r', provider_id: 'p', client_id: 'c', work_done_at: null }]]]);
    await expect(svc.resolveDispute(admin, 'ct1', 'complete', 'examen du dossier', '1.2.3.4')).rejects.toThrow(/jamais déclaré/);
    expect(writes).toEqual([]);
  });

  it('résolution « terminé » : déclenche le versement via contract.validated et laisse une trace', async () => {
    const { svc, writes, client } = setup([[/FROM contracts/, [{ request_id: 'r', provider_id: 'p', client_id: 'c', work_done_at: new Date() }]]]);
    await svc.resolveDispute(admin, 'ct1', 'complete', 'travail constaté par photos', '1.2.3.4');
    const outbox = client.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO outbox_events'));
    expect(outbox?.[1]).toEqual(expect.arrayContaining(['contract.validated']));
    expect(audited(writes)).toBe(true);
  });

  it('un contrat qui n\'est pas en litige ne peut pas être « résolu »', async () => {
    const { svc } = setup([]);
    await expect(svc.resolveDispute(admin, 'ct1', 'cancel', 'xxxxx', '1.2.3.4')).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('changement de commission : tracé avec son motif', async () => {
    const { svc, client } = setup([[/INSERT INTO commission_rules/, [{ id: 'rule-1' }]]]);
    await svc.setCommission(admin, { rateBps: 800, reason: 'offre de lancement' }, '1.2.3.4');
    const audit = client.query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO audit_logs'));
    expect(String(audit?.[1]?.[4])).toContain('offre de lancement');
    expect(audit?.[1]?.[1]).toBe('commission.changed');
  });
});

describe('AdminService — fiche utilisateur', () => {
  const svcWith = (answers: Array<[RegExp, unknown[]]>) => {
    const db = { query: jest.fn(async (sql: string) => answers.find(([re]) => re.test(sql))?.[1] ?? []) };
    return new AdminService(db as never, {} as IdentityProvider);
  };

  it('utilisateur inconnu : introuvable', async () => {
    await expect(svcWith([]).userDetail('u1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('assemble identité, compteurs, contrats et historique d\'audit', async () => {
    const svc = svcWith([
      [/FROM users WHERE id/, [{ id: 'u1', email: 'a@b.fr' }]],
      [/count\(\*\) FROM service_requests/, [{ requests: 2, contracts: 1, paid: '12000', reviews: 3 }]],
      [/FROM contracts c/, [{ id: 'c1' }]],
      [/FROM audit_logs/, [{ id: 9, action: 'user.suspended' }]],
    ]);
    const d = await svc.userDetail('u1');
    expect(d.stats).toEqual({ requests: 2, contracts: 1, paidCents: 12000, reviews: 3 });
    expect(d.contracts).toHaveLength(1);
    expect(d.audit[0].action).toBe('user.suspended');
  });
});
