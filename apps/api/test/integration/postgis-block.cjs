// Scénarios géographiques (PostGIS réel). Chargé par checks.cjs ; ignoré avec SKIP_POSTGIS=1.
const path = require('node:path');
const { randomUUID } = require('node:crypto');

module.exports = async ({ client, check, db, ID, dist, q, one, eq, expectThrows, usersRepo, providersRepo }) => {
  const { ServiceRequest } = require(dist('modules/service-requests/domain/service-request.js'));
  const { PgServiceRequestRepository, PgServiceRequestReadModel } = require(dist('modules/service-requests/infrastructure/pg-repositories.js'));
  const { PgMatchingRepository } = require(dist('modules/matching/infrastructure/pg-matching-repository.js'));
  const { rank } = require(dist('modules/matching/domain/scoring.js'));

  const srRepo = new PgServiceRequestRepository(db);
  const srRead = new PgServiceRequestReadModel(db);
  const matching = new PgMatchingRepository(db);
  const LYON = { lat: 45.7578, lng: 4.832 };
  const near = (a, b, eps = 1e-5) => Math.abs(a - b) < eps;

  await check('PostGIS : extension installée', async () => {
    const r = await one('SELECT postgis_version() AS v');
    if (!r.v) throw new Error('postgis_version vide');
  });

  let requestId;
  await check('demande : enregistrement, relecture des coordonnées (geography), annulation', async () => {
    const r = ServiceRequest.create(ID.client, {
      serviceType: 'breakdown', trade: 'refrigeration', title: 'Panne de chambre froide', description: 'Le compresseur ne démarre plus',
      urgency: 'emergency', address: '1 place Bellecour', postalCode: '69002', city: 'Lyon', location: LYON,
    });
    await srRepo.save(r);
    requestId = r.id;
    const back = await srRepo.findById(r.id);
    if (!back || !near(back.toSnapshot().location.lat, LYON.lat) || !near(back.toSnapshot().location.lng, LYON.lng)) throw new Error(`coordonnées : ${JSON.stringify(back?.toSnapshot().location)}`);
    const d = await srRead.getDetails(r.id);
    if (!near(d.location.lat, LYON.lat)) throw new Error('lecture détaillée');
    eq((await srRead.listByClient(ID.client, { limit: 20 })).some((x) => x.id === r.id), true, 'liste du client');
    eq((await q(`SELECT 1 FROM outbox_events WHERE type='service_request.created' AND aggregate_id=$1`, [r.id])).length, 1, 'événement émis dans la même transaction');
    back.cancel(ID.client);
    await srRepo.save(back);
    eq((await one('SELECT status FROM service_requests WHERE id=$1', [r.id])).status, 'cancelled');
  });

  await check('matching géographique : le rayon PROPRE au prestataire exclut, le tri est par distance', async () => {
    await q(`UPDATE providers SET base_location = ST_SetSRID(ST_MakePoint(4.832, 45.7578), 4326)::geography, service_radius_km = 30 WHERE user_id = $1`, [ID.prov1]);
    // Paris : à ~390 km, donc DANS la boîte de 500 km de l'index mais hors de son rayon de 30 km
    await q(`UPDATE providers SET base_location = ST_SetSRID(ST_MakePoint(2.3522, 48.8566), 4326)::geography, service_radius_km = 30 WHERE user_id = $1`, [ID.prov2]);
    const target = { lat: 45.76, lng: 4.84 };
    const filter = { serviceType: 'breakdown', trade: 'refrigeration' };
    let c = await matching.findCandidates(target, filter, new Date(), 50);
    eq(c.map((x) => x.providerId), [ID.prov1], 'seul Lyon');
    if (!(c[0].distanceKm > 0 && c[0].distanceKm < 5)) throw new Error(`distance ${c[0].distanceKm}`);
    if (!Array.isArray(c[0].trades) || !Array.isArray(c[0].services)) throw new Error('trades/services doivent être des tableaux');
    // Paris avec un rayon de 500 km : les deux, le plus proche d'abord
    await q('UPDATE providers SET service_radius_km = 500 WHERE user_id = $1', [ID.prov2]);
    c = await matching.findCandidates(target, filter, new Date(), 50);
    eq(c.map((x) => x.providerId), [ID.prov1, ID.prov2], 'tri par distance');
    if (!(c[1].distanceKm > 350 && c[1].distanceKm < 450)) throw new Error(`distance Paris ${c[1].distanceKm}`);
  });

  await check('matching : classement puis enregistrement idempotent (aucun doublon, événements émis une fois)', async () => {
    await q(`DELETE FROM provider_certifications`);
    for (const p of [ID.prov1, ID.prov2]) {
      const f = randomUUID();
      await q(`INSERT INTO files (id, uploaded_by, bucket, object_key, original_name, mime_type, size_bytes, status) VALUES ($1,$2,'b',$3,'a.pdf','application/pdf',10,'uploaded')`, [f, p, `k/${f}`]);
      await q(`INSERT INTO provider_certifications (provider_id, type, file_id, review_status) VALUES ($1,'fluid_handling_cat1',$2,'approved')`, [p, f]);
    }
    const req2 = randomUUID();
    await q(`INSERT INTO service_requests (id, client_id, service_type, trade, title, description, urgency, status, address, postal_code, city, location) VALUES ($1,$2,'breakdown','refrigeration','Autre panne','Description suffisante','normal','open','1 rue','69001','Lyon', ST_SetSRID(ST_MakePoint(4.84, 45.76), 4326)::geography)`, [req2, ID.client]);
    const at = new Date();
    const cands = await matching.findCandidates({ lat: 45.76, lng: 4.84 }, { serviceType: 'breakdown', trade: 'refrigeration' }, at, 50);
    const ranked = rank(cands, { serviceType: 'breakdown', trade: 'refrigeration', urgency: 'normal', at }, 10);
    eq(ranked.length, 2, 'les deux sont éligibles avec attestation valide');
    if (!(ranked[0].score >= ranked[1].score && ranked[0].score > 0 && ranked[0].score <= 100)) throw new Error('scores');
    await matching.saveMatches(req2, ranked);
    await matching.saveMatches(req2, ranked); // rejeu
    eq((await q('SELECT 1 FROM request_matches WHERE request_id=$1', [req2])).length, 2, 'lignes');
    eq((await q(`SELECT 1 FROM outbox_events WHERE type='matching.provider_matched' AND aggregate_id=$1`, [req2])).length, 2, 'événements : 2, pas 4');
    eq((await matching.inbox(ID.prov1)).some((i) => i.requestId === req2), true, 'boîte de réception du prestataire');
  });

  await check('index GiST : la requête géographique est SERVIE par l\'index partiel (prouvé sans concurrents)', async () => {
    // Sur quelques lignes, le planificateur préfère un autre index partiel moins cher : cela ne prouve rien sur le GiST.
    // On retire les concurrents DANS une transaction annulée (le DDL est transactionnel) : s'il reste utilisable, il sera choisi.
    await client.query('BEGIN');
    try {
      await client.query('DROP INDEX providers_rating_idx, providers_status_idx');
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query(`EXPLAIN SELECT 1 FROM providers p WHERE p.status = 'approved' AND ST_DWithin(p.base_location, ST_SetSRID(ST_MakePoint(4.84, 45.76), 4326)::geography, 500000)`);
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      if (!/providers_location_gix/.test(plan)) throw new Error(`index non utilisé :\n${plan}`);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  await check('prestataire : profil créé avec ses coordonnées, SIRET unique, champs figés après soumission', async () => {
    const id = randomUUID();
    await usersRepo.createWithProfile({ id, email: 'chaud@exemple.fr', firstName: 'Hugo', lastName: 'Petit', role: 'provider', clientType: 'individual' });
    const profile = { companyName: 'Chaud Froid', siret: '44444444444444', trades: ['heating'], services: ['maintenance'], yearsExperience: 5, emergencyAvailable: false, address: '2 rue Neuve', postalCode: '69003', city: 'Lyon', location: { lat: 45.75, lng: 4.85 }, serviceRadiusKm: 25 };
    await providersRepo.upsertProfile(id, profile);
    const me = await providersRepo.mine(id);
    eq([me.status, me.trades, me.services], ['draft', ['heating'], ['maintenance']], 'tableaux');
    if (!near(me.location.lat, 45.75) || !near(me.location.lng, 4.85)) throw new Error(`coordonnées ${JSON.stringify(me.location)}`);
    if (!/^chaud-froid-[0-9a-f]{4}$/.test(me.slug)) throw new Error(`slug ${me.slug}`);
    await providersRepo.upsertProfile(id, { ...profile, siret: '55555555555555', city: 'Villeurbanne' }); // brouillon : modifiable
    await q(`UPDATE providers SET status = 'pending_review' WHERE user_id = $1`, [id]);
    await expectThrows(() => providersRepo.upsertProfile(id, { ...profile, siret: '66666666666666' }), /ne peuvent plus être modifiés/);
    await providersRepo.upsertProfile(id, { ...profile, siret: '55555555555555', headline: 'Chauffage et pompes à chaleur' }); // champs non figés : modifiable
    await expectThrows(async () => { await providersRepo.upsertProfile(randomUUID(), { ...profile, siret: '11111111111111' }); }, /déjà enregistré|users/);
  });
};
