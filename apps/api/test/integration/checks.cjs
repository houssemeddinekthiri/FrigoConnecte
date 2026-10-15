// Tests d'intégration : les VRAIS dépôts de données compilés (dist/) contre un vrai PostgreSQL + PostGIS.
//   npm run build && TEST_DATABASE_URL=postgres://... npm run test:integration -w @frigoconnect/api
// SKIP_POSTGIS=1 ignore les scénarios géographiques (base sans PostGIS).
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const API = path.resolve(__dirname, '../..'); // apps/api
const dist = (p) => path.join(API, 'dist', p);

module.exports = async (client, check) => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.OTP_SECRET = 'x'.repeat(40);
  require('reflect-metadata');
  const { Database } = require(dist('shared/infrastructure/database/database.service.js'));
  const { PgUserRepository } = require(dist('modules/identity/infrastructure/pg-user-repository.js'));
  const { PgQuoteRepository } = require(dist('modules/quotes/infrastructure/pg-quote-repository.js'));
  const { Quote } = require(dist('modules/quotes/domain/quote.js'));
  const { PgPaymentRepository } = require(dist('modules/payments/infrastructure/pg-payment-repository.js'));
  const { planPayments, refundSplit } = require(dist('modules/payments/domain/payment-plan.js'));
  const { ContractsRepo } = require(dist('modules/contracts/contracts.module.js'));
  const { PgMessagingRepository } = require(dist('modules/messaging/infrastructure/pg-messaging-repository.js'));
  const { ReviewsRepo } = require(dist('modules/reviews/reviews.module.js'));
  const { AdminService } = require(dist('modules/admin/admin.service.js'));
  const { NotifyOnEvents } = require(dist('modules/notifications/notifications.module.js'));
  const { OutboxRelay } = require(dist('shared/infrastructure/outbox/outbox.js'));
  const { ProvidersRepo } = require(dist('modules/providers/providers.module.js'));

  const db = new Database();
  const q = async (sql, p = []) => (await client.query(sql, p)).rows;
  const one = async (sql, p = []) => (await q(sql, p))[0];
  const expectThrows = async (fn, re) => { let err; try { await fn(); } catch (e) { err = e; } if (!err) throw new Error('aucune erreur levée'); if (re && !re.test(err.message)) throw new Error(`mauvaise erreur : ${err.message}`); };
  const eq = (a, b, what = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what} attendu ${JSON.stringify(b)}, reçu ${JSON.stringify(a)}`); };

  // ================= Jeu de données =================
  const ID = { client: randomUUID(), prov1: randomUUID(), prov2: randomUUID(), admin: randomUUID(), req: randomUUID() };
  const usersRepo = new PgUserRepository(db);
  await usersRepo.createWithProfile({ id: ID.client, email: 'karim@exemple.fr', firstName: 'Karim', lastName: 'Benali', role: 'client', clientType: 'individual' });
  await usersRepo.createWithProfile({ id: ID.prov1, email: 'froid@exemple.fr', firstName: 'Paul', lastName: 'Martin', role: 'provider', clientType: 'individual' });
  await usersRepo.createWithProfile({ id: ID.prov2, email: 'clim@exemple.fr', firstName: 'Lea', lastName: 'Durand', role: 'provider', clientType: 'individual' });
  await q(`INSERT INTO users (id, keycloak_id, email, first_name, last_name, role_code, status) VALUES ($1,$1,'admin@exemple.fr','Ad','Min','super_admin','active')`, [ID.admin]);
  for (const [id, name, siret, slug] of [[ID.prov1, 'Froid Express', '11111111111111', 'froid-express'], [ID.prov2, 'Clim Service', '22222222222222', 'clim-service']]) {
    await q(`INSERT INTO providers (user_id, company_name, siret, slug, trades, services, base_location, status, stripe_account_id, stripe_transfers_enabled, city)
             VALUES ($1,$2,$3,$4,'{refrigeration}','{breakdown}','POINT(0 0)','approved','acct_'||$4,true,'Lyon')`, [id, name, siret, slug]);
  }
  await q(`INSERT INTO service_requests (id, client_id, service_type, trade, title, description, urgency, status, address, postal_code, city, location, expires_at)
           VALUES ($1,$2,'breakdown','refrigeration','Chambre froide en panne','Le compresseur ne démarre plus','normal','open','1 rue X','69001','Lyon','POINT(0 0)', now() + interval '14 days')`, [ID.req, ID.client]);
  for (const p of [ID.prov1, ID.prov2]) await q('INSERT INTO request_matches (request_id, provider_id, score) VALUES ($1,$2,80)', [ID.req, p]);

  // ================= Journal d'audit en ajout seul =================
  await check('audit_logs : insertion possible', async () => { await q(`INSERT INTO audit_logs (actor_id, action, entity_type) VALUES ($1,'test','test')`, [ID.admin]); });
  await check('audit_logs : UPDATE interdit', () => expectThrows(() => q(`UPDATE audit_logs SET action='x'`), /ajout seul/));
  await check('audit_logs : DELETE interdit', () => expectThrows(() => q('DELETE FROM audit_logs'), /ajout seul/));
  await check('audit_logs : TRUNCATE interdit', () => expectThrows(() => q('TRUNCATE audit_logs'), /ajout seul/));

  // ================= Devis =================
  const quoteRepo = new PgQuoteRepository(db);
  const content = { items: [{ label: 'Compresseur', quantity: 1, unit: 'u', unitPriceCents: 100000, vatRateBps: 2000 }, { label: 'Main d\'œuvre', quantity: 2.5, unit: 'h', unitPriceCents: 6000, vatRateBps: 1000 }], depositPercent: 30, validUntil: '2999-12-31' };
  const q1 = Quote.draft(ID.prov1, ID.req, content);
  const q2 = Quote.draft(ID.prov2, ID.req, { ...content, items: [content.items[0]] });
  await check('devis : brouillon enregistré, numéro DV-AAAA-NNNNNN', async () => {
    await quoteRepo.save(q1, []); await quoteRepo.save(q2, []);
    const c = await quoteRepo.findContext(q1.id);
    if (!/^DV-\d{4}-\d{6}$/.test(c.quote.toSnapshot().number)) throw new Error(c.quote.toSnapshot().number);
    eq(c.quote.toSnapshot().items.length, 2, 'lignes');
    eq(c.providerPayoutsReady, true, 'compte de paiement prêt');
  });
  await check('devis : un 2e brouillon du même prestataire sur la demande est refusé', () => expectThrows(() => quoteRepo.save(Quote.draft(ID.prov1, ID.req, content), []), /déjà un devis en cours/));
  const pdfFile = async (owner, entityId, sha = 'ab'.repeat(32)) => {
    const id = randomUUID();
    await q(`INSERT INTO files (id, uploaded_by, bucket, object_key, original_name, mime_type, size_bytes, checksum_sha256, status, entity_type, entity_id) VALUES ($1,$2,'b',$3,'d.pdf','application/pdf',1000,$4,'uploaded','quote',$5)`, [id, owner, `k/${id}`, sha, entityId]);
    return id;
  };
  await check('devis : envoi atomique (statut, PDF, compteur de la demande, événement)', async () => {
    for (const [quote, prov] of [[q1, ID.prov1], [q2, ID.prov2]]) {
      const ctx = await quoteRepo.findContext(quote.id);
      ctx.quote.send(prov);
      await quoteRepo.commitSend(ctx.quote, await pdfFile(prov, quote.id), [{ type: 'quote.sent', payload: { quoteId: quote.id, requestId: ID.req, clientId: ID.client, providerId: prov, providerName: 'X', totalCents: 1, number: 'N' } }]);
    }
    const r = await one('SELECT status, quotes_count FROM service_requests WHERE id=$1', [ID.req]);
    eq([r.status, r.quotes_count], ['quoted', 2], 'demande');
    eq((await q(`SELECT 1 FROM outbox_events WHERE type='quote.sent'`)).length, 2, 'événements');
  });
  await check('devis : lecture (DTO + listes) avec totaux recalculés', async () => {
    const dto = await quoteRepo.getDto(q1.id);
    eq([dto.subtotalCents, dto.vatCents, dto.totalCents], [115000, 20000 + 1500, 136500], 'totaux');
    eq(dto.status, 'sent');
    eq((await quoteRepo.listForRequest(ID.req, { excludeDraft: true })).length, 2);
    eq((await quoteRepo.listForRequest(ID.req, { providerId: ID.prov1 })).length, 1);
    eq((await quoteRepo.listForProvider(ID.prov2)).length, 1);
  });
  await check('signature : code à usage unique, délai de redemande, 5 essais maximum', async () => {
    eq(await quoteRepo.issueCode(q1.id, 'hash-ok', new Date(Date.now() + 600000)), true, 'premier code');
    eq(await quoteRepo.issueCode(q1.id, 'autre', new Date(Date.now() + 600000)), false, 'redemande immédiate');
    for (let i = 0; i < 5; i++) eq(await quoteRepo.consumeAttempt(q1.id), 'hash-ok', `essai ${i + 1}`);
    eq(await quoteRepo.consumeAttempt(q1.id), null, '6e essai');
    await q(`UPDATE quote_signatures SET code_requested_at = now() - interval '2 minutes' WHERE quote_id=$1`, [q1.id]);
    eq(await quoteRepo.issueCode(q1.id, 'hash-2', new Date(Date.now() + 600000)), true, 'nouveau code après délai');
    eq(await quoteRepo.consumeAttempt(q1.id), 'hash-2', 'essai sur le nouveau code');
  });
  let contractId;
  await check('acceptation : devis signé, contrat créé, autre devis refusé, demande attribuée (1 transaction)', async () => {
    const ctx = await quoteRepo.findContext(q1.id);
    ctx.quote.accept();
    const signed = await pdfFile(ID.prov1, q1.id);
    await quoteRepo.commitAcceptance(ctx.quote, { signerId: ID.client, signerEmail: 'karim@exemple.fr', ip: '203.0.113.7', userAgent: 'jest', pdfSha256: 'ab'.repeat(32), signedPdfFileId: signed }, ID.client, ctx.quote.toSnapshot().sentAt,
      (rejected) => [{ type: 'quote.accepted', payload: { quoteId: q1.id } }, ...rejected.map((id) => ({ type: 'quote.rejected', payload: { quoteId: id, providerId: ID.prov2 } }))]);
    eq((await one('SELECT status FROM quotes WHERE id=$1', [q1.id])).status, 'accepted');
    eq((await one('SELECT status FROM quotes WHERE id=$1', [q2.id])).status, 'rejected', 'autre devis');
    const r = await one('SELECT status, accepted_quote_id FROM service_requests WHERE id=$1', [ID.req]);
    eq([r.status, r.accepted_quote_id], ['awarded', q1.id], 'demande');
    const c = await one('SELECT * FROM contracts WHERE quote_id=$1', [q1.id]);
    contractId = c.id;
    eq([c.status, c.total_cents, c.subtotal_cents, c.deposit_cents], ['active', 136500, 115000, 40950], 'contrat');
    const s = await one('SELECT host(signer_ip) AS ip, signed_at, code_hash FROM quote_signatures WHERE quote_id=$1', [q1.id]);
    eq([s.ip, !!s.signed_at, s.code_hash], ['203.0.113.7', true, null], 'preuve de signature');
    eq((await q(`SELECT 1 FROM outbox_events WHERE type='quote.rejected'`)).length, 1, 'événement de refus automatique');
  });
  await check('acceptation : impossible une 2e fois', () => expectThrows(async () => { const c = await quoteRepo.findContext(q1.id); await quoteRepo.commitAcceptance(Quote.rehydrate({ ...c.quote.toSnapshot(), status: 'sent' }), { signerId: ID.client, signerEmail: 'x', ip: '1.1.1.1', userAgent: '', pdfSha256: 'x', signedPdfFileId: await pdfFile(ID.prov1, q1.id) }, ID.client, null, () => []); }, /ne peut plus être accepté/));
  await check('devis : expiration automatique des devis périmés', async () => {
    const req2 = randomUUID();
    await q(`INSERT INTO service_requests (id, client_id, service_type, trade, title, description, urgency, status, address, postal_code, city, location) VALUES ($1,$2,'breakdown','refrigeration','Autre demande','Description suffisante','normal','quoted','1 rue','69001','Lyon','POINT(0 0)')`, [req2, ID.client]);
    const old = Quote.draft(ID.prov2, req2, { ...content, validUntil: '2999-12-31' });
    await quoteRepo.save(old, []);
    await q(`UPDATE quotes SET status='sent', sent_at=now(), valid_until = current_date - 3 WHERE id=$1`, [old.id]);
    eq(await quoteRepo.expireOverdue(), 1);
    eq((await one('SELECT status FROM quotes WHERE id=$1', [old.id])).status, 'expired');
  });

  // ================= Paiements =================
  const payRepo = new PgPaymentRepository(db);
  let plan, depositId, balanceId;
  await check('paiement : contrat lisible, commission par défaut 10 %', async () => {
    const c = await payRepo.findPayable(contractId);
    eq([c.totalCents, c.subtotalCents, c.depositCents, c.providerTransfersReady, c.clientEmail], [136500, 115000, 40950, true, 'karim@exemple.fr']);
    eq(await payRepo.commissionRateBps(ID.prov1), 1000, 'taux par défaut');
    plan = planPayments(c, 1000);
    eq(plan.length, 2);
  });
  await check('paiement : acompte créé, doublon refusé par l\'index unique', async () => {
    depositId = randomUUID();
    const d = plan[0];
    await payRepo.insertPayment({ id: depositId, contractId, payerId: ID.client, providerId: ID.prov1, kind: 'deposit', amountCents: d.amountCents, feeCents: d.feeCents, providerCents: d.providerCents, rateBps: 1000, idempotencyKey: `pay:${depositId}` });
    await payRepo.attachIntent(depositId, 'pi_dep');
    await expectThrows(() => payRepo.insertPayment({ id: randomUUID(), contractId, payerId: ID.client, providerId: ID.prov1, kind: 'deposit', amountCents: d.amountCents, feeCents: d.feeCents, providerCents: d.providerCents, rateBps: 1000, idempotencyKey: 'dup' }), /existe déjà/);
  });
  await check('paiement : webhook « payé » idempotent, événement émis une seule fois', async () => {
    eq(await payRepo.markPaid('pi_dep', 'ch_dep'), true);
    eq(await payRepo.markPaid('pi_dep', 'ch_dep'), false, 'rejeu');
    eq((await q(`SELECT 1 FROM outbox_events WHERE type='payment.paid'`)).length, 1);
    eq((await one('SELECT status FROM payments WHERE id=$1', [depositId])).status, 'held');
    eq(await payRepo.isEventProcessed('evt_1'), false); await payRepo.markEventProcessed('evt_1', 't'); await payRepo.markEventProcessed('evt_1', 't');
    eq(await payRepo.isEventProcessed('evt_1'), true);
  });
  await check('paiement : remboursement partiel réserve le montant, interdit le sur-remboursement', async () => {
    const split = (p, a) => refundSplit(p, a);
    const refundRow = randomUUID();
    const r = await payRepo.beginRefund(depositId, 10000, refundRow, `refund:${refundRow}`, split);
    eq(r.amountCents, 10000);
    eq(r.providerShare + r.feeShare, 10000, 'répartition');
    await expectThrows(() => payRepo.beginRefund(depositId, plan[0].amountCents, randomUUID(), `r:${randomUUID()}`, split), /remboursable/);
    await payRepo.completeRefund(refundRow, depositId, 're_1', [{ type: 'payment.refunded', payload: { paymentId: depositId, byAdmin: ID.admin, amountCents: 10000, reason: 'geste' } }]);
    eq((await one('SELECT status FROM payments WHERE id=$1', [depositId])).status, 'partially_refunded');
    eq((await q(`SELECT 1 FROM audit_logs WHERE action='payment.refunded'`)).length, 1, 'trace d\'audit du remboursement');
  });
  let netAfterRefund;
  await check('versement : verrou unique, montant net = part prestataire − remboursements', async () => {
    const claimed = await payRepo.claimForRelease(contractId);
    eq(claimed.length, 1);
    netAfterRefund = claimed[0].netProviderCents;
    const sp = refundSplit({ amountCents: plan[0].amountCents, providerCents: plan[0].providerCents }, 10000);
    eq(netAfterRefund, plan[0].providerCents - sp.providerShare, 'net');
    eq((await payRepo.claimForRelease(contractId)).length, 0, 'second worker');
    await expectThrows(() => payRepo.beginRefund(depositId, 100, randomUUID(), `r:${randomUUID()}`, (p, a) => refundSplit(p, a)), /déjà versés|non encaissé/);
    await payRepo.markReleased(depositId, 'tr_1', ID.prov1, netAfterRefund);
    eq((await one('SELECT status, stripe_transfer_id FROM payments WHERE id=$1', [depositId])).status, 'released');
    eq((await q(`SELECT 1 FROM outbox_events WHERE type='payment.released'`)).length, 1);
  });
  await check('versement : un paiement dont le prestataire n\'a pas de compte n\'est PAS verrouillé', async () => {
    await q('UPDATE providers SET stripe_account_id = NULL WHERE user_id=$1', [ID.prov1]);
    balanceId = randomUUID();
    const b = plan[1];
    await payRepo.insertPayment({ id: balanceId, contractId, payerId: ID.client, providerId: ID.prov1, kind: 'balance', amountCents: b.amountCents, feeCents: b.feeCents, providerCents: b.providerCents, rateBps: 1000, idempotencyKey: `pay:${balanceId}` });
    await payRepo.attachIntent(balanceId, 'pi_bal'); await payRepo.markPaid('pi_bal', 'ch_bal');
    eq((await payRepo.claimForRelease(contractId)).length, 0);
    eq((await one('SELECT status FROM payments WHERE id=$1', [balanceId])).status, 'held', 'reste remboursable');
    await q(`UPDATE providers SET stripe_account_id = 'acct_froid-express' WHERE user_id=$1`, [ID.prov1]);
  });
  await check('paiement : ancien paiement échoué libère l\'emplacement unique', async () => {
    const id = randomUUID();
    await q(`UPDATE payments SET status='failed' WHERE id=$1`, [balanceId]);
    await payRepo.insertPayment({ id, contractId, payerId: ID.client, providerId: ID.prov1, kind: 'balance', amountCents: plan[1].amountCents, feeCents: plan[1].feeCents, providerCents: plan[1].providerCents, rateBps: 1000, idempotencyKey: `pay:${id}` });
    await payRepo.attachIntent(id, 'pi_bal2'); await payRepo.markPaid('pi_bal2', 'ch_bal2'); balanceId = id;
  });

  // ================= Contrats =================
  const contracts = new ContractsRepo(db);
  await check('contrat : état + paiements, actions du serveur', async () => {
    const s = await contracts.state(contractId);
    eq([s.depositPaid, s.balancePaid, s.status], [true, true, 'active']);
    const [c] = await contracts.list(ID.client, 'client', ID.req);
    eq(c.actions.validate, false, 'pas encore terminé'); eq(c.payments.every((p) => p.providerCents === null), true, 'commission masquée au client');
    const [p] = await contracts.list(ID.prov1, 'provider');
    eq(p.payments[0].providerCents > 0, true, 'net visible du prestataire'); eq(p.actions.declareDone, true);
  });
  await check('contrat : fin déclarée une seule fois, puis validation = terminé + versement déclenché', async () => {
    await contracts.markWorkDone(contractId, ID.prov1, ID.client);
    await expectThrows(() => contracts.markWorkDone(contractId, ID.prov1, ID.client), /déjà déclarée/);
    await contracts.complete(contractId, false);
    eq((await one('SELECT status FROM contracts WHERE id=$1', [contractId])).status, 'completed');
    eq((await one('SELECT status FROM service_requests WHERE id=$1', [ID.req])).status, 'completed');
    eq((await one('SELECT completed_missions FROM providers WHERE user_id=$1', [ID.prov1])).completed_missions, 1);
    eq((await q(`SELECT 1 FROM outbox_events WHERE type='contract.validated'`)).length, 1);
    await expectThrows(() => contracts.complete(contractId, false), /ne peut plus être validé/);
    const [c] = await contracts.list(ID.client, 'client'); eq(c.actions.review, true, 'avis possible');
  });
  await check('contrat : balayage des contrats à valider d\'office (SQL)', async () => { eq(Array.isArray(await contracts.dueForAutoValidation()), true); });

  // ================= Messagerie =================
  const msg = new PgMessagingRepository(db);
  let conv;
  await check('messagerie : conversation idempotente, règle d\'ouverture, messages et non-lus', async () => {
    const ctx = await msg.openContext(ID.req, ID.prov1);
    eq([ctx.providerMatched, ctx.providerHasQuote, ctx.requestClientId], [true, true, ID.client]);
    conv = await msg.upsertConversation(ID.req, ID.client, ID.prov1);
    eq(await msg.upsertConversation(ID.req, ID.client, ID.prov1), conv, 'idempotent');
    await msg.insertMessage({ conversationId: conv, senderId: ID.prov1, body: 'Bonjour', fileId: null, masked: false });
    await msg.insertMessage({ conversationId: conv, senderId: ID.prov1, body: 'Devis DV-1', fileId: null, quoteId: q1.id, masked: false });
    const list = await msg.listConversations(ID.client);
    eq([list[0].unreadCount, list[0].counterpart.name, list[0].requestTitle], [2, 'Froid Express', 'Chambre froide en panne']);
    const forProvider = await msg.listConversations(ID.prov1);
    eq([forProvider[0].unreadCount, forProvider[0].counterpart.name], [0, 'Karim B.'], 'prestataire : nom abrégé du client');
    await msg.markRead(conv, ID.client);
    eq((await msg.listConversations(ID.client))[0].unreadCount, 0);
    const messages = await msg.listMessages(conv, undefined, 10);
    eq([messages[0].type, messages[0].quoteId], ['quote', q1.id], 'plus récent d\'abord'); eq(messages.length, 2);
    eq(await msg.contactsUnlocked(ID.req, ID.prov1), true, 'contrat = coordonnées autorisées');
    eq(await msg.contactsUnlocked(ID.req, ID.prov2), false);
  });

  // ================= Avis & notes =================
  const reviews = new ReviewsRepo(db);
  await check('avis : publié, note recalculée ; doublon refusé ; suspect en modération', async () => {
    eq((await reviews.create({ id: ID.client, roles: ['client'] }, contractId, 5, 'Excellent travail')).status, 'published');
    const p = await one('SELECT avg_rating, reviews_count FROM providers WHERE user_id=$1', [ID.prov1]);
    eq([Number(p.avg_rating), p.reviews_count], [5, 1], 'note');
    await expectThrows(() => reviews.create({ id: ID.client, roles: ['client'] }, contractId, 4, 'bis'), /déjà donné/);
    eq((await reviews.create({ id: ID.prov1, roles: ['provider'] }, contractId, 4, 'Appelez-moi au 06 12 34 56 78')).status, 'pending_moderation');
  });

  // ================= Notifications & outbox =================
  const emitted = [];
  const notif = new NotifyOnEvents(db, { emitToUser: (u, e) => emitted.push([u, e]) });
  await check('notifications : dédoublonnage des événements rejoués (outbox au moins une fois)', async () => {
    const ev = { type: 'quote.sent', payload: { quoteId: q1.id, requestId: ID.req, clientId: ID.client, providerName: 'Froid Express', totalCents: 136500 } };
    await notif.handle(ev); await notif.handle(ev);
    eq((await q(`SELECT 1 FROM notifications WHERE type='quote.sent' AND user_id=$1`, [ID.client])).length, 1);
    await notif.handle({ type: 'payment.paid', payload: { paymentId: depositId, contractId, providerId: ID.prov1, kind: 'deposit', amountCents: 1000 } });
    await notif.handle({ type: 'payment.paid', payload: { paymentId: depositId, contractId, providerId: ID.prov1, kind: 'deposit', amountCents: 1000 } });
    eq((await q(`SELECT 1 FROM notifications WHERE type='payment.deposit_paid'`)).length, 1);
    await notif.handle({ type: 'matching.provider_matched', payload: { requestId: ID.req, providerId: ID.prov2, score: 80 } });
    await notif.handle({ type: 'matching.provider_matched', payload: { requestId: ID.req, providerId: ID.prov2, score: 80 } });
    eq((await q(`SELECT 1 FROM notifications WHERE type='request.matched'`)).length, 1);
    eq(emitted.length, 3, 'une poussée par notification créée');
  });
  await check('outbox : le relais publie chaque événement une seule fois', async () => {
    const published = [];
    const relay = new OutboxRelay(db, { publish: (e) => published.push(e.type) });
    await relay.tick();
    const n = published.length;
    if (n < 5) throw new Error(`seulement ${n} événements`);
    await relay.tick();
    eq(published.length, n, 'rien de plus au 2e passage');
    eq((await q('SELECT 1 FROM outbox_events WHERE published_at IS NULL')).length, 0);
  });

  // ================= Prestataires : dossier, fiche publique, expiration =================
  const providersRepo = new ProvidersRepo(db);
  await check('fiche publique : données et avis publiés', async () => {
    const p = await providersRepo.publicBySlug('froid-express');
    eq([p.companyName, p.reviewsCount, p.reviews.length, p.reviews[0].author], ['Froid Express', 1, 1, 'Karim B.']);
    eq(await providersRepo.publicBySlug('inconnu'), null);
  });
  await check('alertes d\'expiration : un message par palier', async () => {
    const f = randomUUID();
    await q(`INSERT INTO files (id, uploaded_by, bucket, object_key, original_name, mime_type, size_bytes, status) VALUES ($1,$2,'b',$3,'a.pdf','application/pdf',10,'uploaded')`, [f, ID.prov1, `k/${f}`]);
    await q(`INSERT INTO provider_certifications (provider_id, type, file_id, review_status, expires_on) VALUES ($1,'fluid_handling_cat1',$2,'approved', current_date + 5)`, [ID.prov1, f]);
    eq(await providersRepo.alertExpiringCertifications(), 1, '1re passe (palier 7 j)');
    eq(await providersRepo.alertExpiringCertifications(), 0, '2e passe : déjà notifié');
    await q(`UPDATE provider_certifications SET expires_on = current_date - 1`);
    eq(await providersRepo.alertExpiringCertifications(), 1, 'palier « expiré »');
  });

  // ================= Administration =================
  const idpCalls = [];
  const admin = new AdminService(db, { setEnabled: async (...a) => idpCalls.push(['enabled', ...a]), logout: async (...a) => idpCalls.push(['logout', ...a]) });
  const A = { id: ID.admin, roles: ['super_admin'] };
  await check('admin : statistiques (toutes les requêtes SQL s\'exécutent, chiffres cohérents)', async () => {
    const s = await admin.stats(30);
    eq(s.gmvByDay.length, 30, 'jours');
    const total = s.gmvByDay.reduce((a, d) => a + d.cents, 0);
    eq(total, s.kpis.gmvCents, 'somme par jour = GMV');
    eq(s.kpis.requests >= 2, true); eq(s.kpis.activeProviders, 2); eq(s.kpis.contractsCompleted, 1);
    eq(Math.round(s.kpis.acceptanceRate * 100), 33, 'acceptés / envoyés : 1 sur 3');
    eq(typeof s.kpis.medianFirstQuoteMinutes, 'number');
  });
  await check('admin : validation d\'un dossier (bloquants, examen, approbation, suspension, réintégration)', async () => {
    const p3 = randomUUID();
    await usersRepo.createWithProfile({ id: p3, email: 'nouveau@exemple.fr', firstName: 'Nina', lastName: 'Roux', role: 'provider', clientType: 'individual' });
    await q(`INSERT INTO providers (user_id, company_name, siret, slug, trades, services, base_location, status) VALUES ($1,'Nouveau Froid','33333333333333','nouveau-froid','{refrigeration}','{breakdown}','POINT(0 0)','pending_review')`, [p3]);
    const f = randomUUID(); await q(`INSERT INTO files (id, uploaded_by, bucket, object_key, original_name, mime_type, size_bytes, status) VALUES ($1,$2,'b',$3,'a.pdf','application/pdf',10,'uploaded')`, [f, p3, `k/${f}`]);
    const cert = (await q(`INSERT INTO provider_certifications (provider_id, type, file_id) VALUES ($1,'fluid_handling_cat1',$2) RETURNING id`, [p3, f]))[0].id;
    const list = await admin.providers('pending_review');
    eq(list.find((x) => x.providerId === p3).blockers.length >= 1, true, 'blocages');
    await expectThrows(() => admin.approve(A, p3, '1.1.1.1'), /restent à examiner/);
    await admin.reviewCertification(A, p3, cert, 'approve', undefined, '1.1.1.1');
    await admin.approve(A, p3, '1.1.1.1');
    eq((await one('SELECT status FROM providers WHERE user_id=$1', [p3])).status, 'approved');
    await admin.suspendProvider(A, p3, 'plaintes répétées', '1.1.1.1');
    await admin.reinstateProvider(A, p3, '1.1.1.1');
    const actions = (await q(`SELECT action FROM audit_logs WHERE entity_id=$1 ORDER BY id`, [p3])).map((r) => r.action);
    eq(actions, ['provider.approved', 'provider.suspended', 'provider.reinstated'], 'journal d\'audit');
  });
  await check('admin : utilisateurs (liste, suspension => Keycloak), avis, commissions, audit', async () => {
    eq((await admin.users({ limit: 50, offset: 0 })).length >= 5, true, 'liste');
    eq((await admin.users({ role: 'client', limit: 10, offset: 0, q: 'karim' })).length, 1, 'filtre');
    await admin.setUserSuspended(A, ID.client, true, 'fraude', '1.1.1.1');
    eq(idpCalls.map((c) => c[0]), ['enabled', 'logout']); eq((await one('SELECT status FROM users WHERE id=$1', [ID.client])).status, 'suspended');
    await admin.setUserSuspended(A, ID.client, false, undefined, '1.1.1.1');
    const pending = await admin.reviews();
    eq(pending.length, 1, 'avis à modérer');
    await admin.moderateReview(A, pending[0].id, 'hide', '1.1.1.1');
    await admin.setCommission(A, { providerId: ID.prov1, rateBps: 800, reason: 'offre de lancement' }, '1.1.1.1');
    eq(await payRepo.commissionRateBps(ID.prov1), 800, 'taux propre au prestataire'); eq(await payRepo.commissionRateBps(ID.prov2), 1000, 'les autres gardent le défaut');
    eq((await admin.commissions()).length, 1);
    const audit = await admin.audit({ limit: 100 });
    eq(audit.length >= 8, true, 'entrées d\'audit'); eq(audit[0].id > audit[audit.length - 1].id, true, 'plus récent d\'abord');
    eq((await admin.audit({ limit: 100, entityType: 'commission_rule' })).length, 1, 'filtre audit');
  });
  await check('admin : litiges (contestation bancaire -> litige -> résolution)', async () => {
    await payRepo.flagDispute('ch_dep');
    const d = await admin.disputes();
    eq(d.length, 1); eq(d[0].payments.length >= 1, true);
    await admin.resolveDispute(A, contractId, 'cancel', 'contestation justifiée', '1.1.1.1');
    eq((await one('SELECT status FROM contracts WHERE id=$1', [contractId])).status, 'cancelled'); eq((await admin.disputes()).length, 0);
  });

  if (!process.env.SKIP_POSTGIS) await require('./postgis-block.cjs')({ client, check, db, ID, dist, q, one, eq, expectThrows, usersRepo, providersRepo });
};
