import { AuthUser } from '../../../shared/auth/auth';
import { InvalidStateError, NotFoundError } from '../../../shared/kernel/errors';
import { PayableContract, PaymentRepository, PaymentRow, StripeGateway } from '../domain/ports';
import { CreateContractPaymentCommand, CreateContractPaymentHandler, FundsReleaser, RefundPaymentCommand, RefundPaymentHandler, StripeWebhookService } from './handlers';

const client: AuthUser = { id: 'client-1', roles: ['client'] };
const admin: AuthUser = { id: 'admin-1', roles: ['super_admin'] };

const payable = (over: Partial<PayableContract> = {}): PayableContract => ({
  id: 'ct1', clientId: 'client-1', providerId: 'prov-1', status: 'active', totalCents: 144_600, subtotalCents: 122_250, depositCents: 43_380, workDoneAt: null,
  providerTransfersReady: true, clientEmail: 'k@exemple.fr', clientName: 'Karim B', stripeCustomerId: null, payments: [], ...over,
});
const row = (over: Partial<PaymentRow>): PaymentRow => ({
  id: 'p1', kind: 'deposit', status: 'pending', amountCents: 43_380, feeCents: 3_667, providerCents: 39_713, commissionRateBps: 1000,
  stripePaymentIntentId: 'pi_1', stripeChargeId: null, stripeTransferId: null, ...over,
});

function fakes(contract: PayableContract | null = payable()) {
  const repo = {
    findPayable: jest.fn().mockResolvedValue(contract),
    commissionRateBps: jest.fn().mockResolvedValue(1000),
    saveCustomerId: jest.fn(), insertPayment: jest.fn(), attachIntent: jest.fn(), markFailed: jest.fn(),
    isEventProcessed: jest.fn().mockResolvedValue(false), markEventProcessed: jest.fn(), markPaid: jest.fn(), markPaymentFailed: jest.fn(),
    setTransfersReadyByAccount: jest.fn(), flagDispute: jest.fn(),
    claimForRelease: jest.fn(), markReleased: jest.fn(), unclaim: jest.fn(), staleClaims: jest.fn(),
    beginRefund: jest.fn(), completeRefund: jest.fn(), failRefund: jest.fn(),
  } as unknown as jest.Mocked<PaymentRepository>;
  const stripe = {
    publishableKey: jest.fn().mockReturnValue('pk_test'), ensureCustomer: jest.fn().mockResolvedValue('cus_1'),
    createPaymentIntent: jest.fn().mockResolvedValue({ id: 'pi_new', clientSecret: 'secret_new' }),
    retrievePaymentIntent: jest.fn(), createTransfer: jest.fn().mockResolvedValue('tr_1'), refund: jest.fn().mockResolvedValue('re_1'), verifyWebhook: jest.fn(),
  } as unknown as jest.Mocked<StripeGateway>;
  return { repo, stripe };
}

describe('CreateContractPaymentHandler', () => {
  const run = (f: ReturnType<typeof fakes>, kind: 'deposit' | 'balance' = 'deposit', user = client) =>
    new CreateContractPaymentHandler(f.repo, f.stripe).execute(new CreateContractPaymentCommand(user, 'ct1', kind));

  it('le montant et la commission viennent du serveur (commission 10 % du HT)', async () => {
    const f = fakes();
    const r = await run(f);
    expect(r).toMatchObject({ clientSecret: 'secret_new', publishableKey: 'pk_test', amountCents: 43_380 });
    const inserted = f.repo.insertPayment.mock.calls[0][0];
    expect(inserted).toMatchObject({ kind: 'deposit', amountCents: 43_380, rateBps: 1000 });
    expect(inserted.feeCents + inserted.providerCents).toBe(43_380);
    expect(f.stripe.createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 43_380, transferGroup: 'contract_ct1' }));
  });

  it('un autre client reçoit un 404', async () => {
    await expect(run(fakes(), 'deposit', { id: 'intrus', roles: ['client'] })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuse si le prestataire ne peut pas être payé ou si le contrat n\'est plus actif', async () => {
    await expect(run(fakes(payable({ providerTransfersReady: false })))).rejects.toThrow(/compte de paiement/);
    await expect(run(fakes(payable({ status: 'disputed' })))).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('solde : seulement après l\'intervention ET l\'acompte réglé', async () => {
    await expect(run(fakes(), 'balance')).rejects.toThrow(/intervention terminée/);
    const done = payable({ workDoneAt: new Date() });
    await expect(run(fakes(done), 'balance')).rejects.toThrow(/acompte/);
    const paid = payable({ workDoneAt: new Date(), payments: [row({ status: 'held', stripeChargeId: 'ch_1' })] });
    const f = fakes(paid);
    await run(f, 'balance');
    expect(f.repo.insertPayment.mock.calls[0][0].amountCents).toBe(144_600 - 43_380);
    // le solde reprend le taux figé de l'acompte
    expect(f.repo.commissionRateBps).not.toHaveBeenCalled();
  });

  it('déjà payé : refusé (pas de double paiement)', async () => {
    await expect(run(fakes(payable({ payments: [row({ status: 'held', stripeChargeId: 'ch_1' })] })))).rejects.toThrow(/Déjà réglé/);
  });

  it('paiement abandonné : on reprend la même intention, sans en créer un second', async () => {
    const f = fakes(payable({ payments: [row({})] }));
    f.stripe.retrievePaymentIntent.mockResolvedValue({ status: 'requires_payment_method', clientSecret: 'secret_old' });
    const r = await run(f);
    expect(r.clientSecret).toBe('secret_old');
    expect(f.repo.insertPayment).not.toHaveBeenCalled();
    expect(f.stripe.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('intention annulée côté Stripe : l\'ancienne est close, une nouvelle est créée', async () => {
    const f = fakes(payable({ payments: [row({})] }));
    f.stripe.retrievePaymentIntent.mockResolvedValue({ status: 'canceled', clientSecret: 'x' });
    await run(f);
    expect(f.repo.markFailed).toHaveBeenCalledWith('p1', expect.stringContaining('abandonné'));
    expect(f.repo.insertPayment).toHaveBeenCalled();
  });

  it('échec Stripe à la création : l\'emplacement est libéré pour réessayer', async () => {
    const f = fakes();
    f.stripe.createPaymentIntent.mockRejectedValue(new Error('stripe down'));
    await expect(run(f)).rejects.toThrow('stripe down');
    expect(f.repo.markFailed).toHaveBeenCalledWith(f.repo.insertPayment.mock.calls[0][0].id, expect.any(String));
  });
});

describe('FundsReleaser', () => {
  const item = { id: 'p1', contractId: 'ct1', providerId: 'prov-1', stripeAccountId: 'acct_1', stripeChargeId: 'ch_1', netProviderCents: 39_713 };

  it('verse la part nette, avec une clé d\'idempotence stable liée au paiement', async () => {
    const f = fakes();
    f.repo.claimForRelease.mockResolvedValue([item]);
    await new FundsReleaser(f.repo, f.stripe).releaseContract('ct1');
    expect(f.stripe.createTransfer).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 39_713, destination: 'acct_1', sourceCharge: 'ch_1', idempotencyKey: 'transfer:p1' }));
    expect(f.repo.markReleased).toHaveBeenCalledWith('p1', 'tr_1', 'prov-1', 39_713);
  });

  it('échec Stripe : le paiement redevient « conservé » pour être retenté', async () => {
    const f = fakes();
    f.repo.claimForRelease.mockResolvedValue([item]);
    f.stripe.createTransfer.mockRejectedValue(new Error('account restricted'));
    await new FundsReleaser(f.repo, f.stripe).releaseContract('ct1');
    expect(f.repo.unclaim).toHaveBeenCalledWith('p1');
    expect(f.repo.markReleased).not.toHaveBeenCalled();
  });

  it('rien à verser (déjà pris ou remboursé) : aucun appel Stripe', async () => {
    const f = fakes();
    f.repo.claimForRelease.mockResolvedValue([]);
    await new FundsReleaser(f.repo, f.stripe).releaseContract('ct1');
    expect(f.stripe.createTransfer).not.toHaveBeenCalled();
  });
});

describe('StripeWebhookService', () => {
  it('traite un paiement réussi puis mémorise l\'événement', async () => {
    const f = fakes();
    f.stripe.verifyWebhook.mockReturnValue({ id: 'evt_1', type: 'payment_intent.succeeded', intentId: 'pi_1', chargeId: 'ch_1' });
    await new StripeWebhookService(f.repo, f.stripe).handle(Buffer.from('{}'), 'sig');
    expect(f.repo.markPaid).toHaveBeenCalledWith('pi_1', 'ch_1');
    expect(f.repo.markEventProcessed).toHaveBeenCalledWith('evt_1', 'payment_intent.succeeded');
  });

  it('événement déjà traité : aucun effet', async () => {
    const f = fakes();
    f.stripe.verifyWebhook.mockReturnValue({ id: 'evt_1', type: 'payment_intent.succeeded', intentId: 'pi_1', chargeId: 'ch_1' });
    f.repo.isEventProcessed.mockResolvedValue(true);
    await new StripeWebhookService(f.repo, f.stripe).handle(Buffer.from('{}'), 'sig');
    expect(f.repo.markPaid).not.toHaveBeenCalled();
  });

  it('signature invalide : rien n\'est exécuté', async () => {
    const f = fakes();
    f.stripe.verifyWebhook.mockImplementation(() => { throw Object.assign(new Error('bad sig'), { type: 'StripeSignatureVerificationError' }); });
    await expect(new StripeWebhookService(f.repo, f.stripe).handle(Buffer.from('{}'), 'forged')).rejects.toThrow('bad sig');
    expect(f.repo.markPaid).not.toHaveBeenCalled();
    expect(f.repo.markEventProcessed).not.toHaveBeenCalled();
  });

  it('échec de traitement : l\'événement n\'est PAS mémorisé (Stripe le renverra)', async () => {
    const f = fakes();
    f.stripe.verifyWebhook.mockReturnValue({ id: 'evt_2', type: 'payment_intent.succeeded', intentId: 'pi_1', chargeId: 'ch_1' });
    f.repo.markPaid.mockRejectedValue(new Error('db down'));
    await expect(new StripeWebhookService(f.repo, f.stripe).handle(Buffer.from('{}'), 'sig')).rejects.toThrow('db down');
    expect(f.repo.markEventProcessed).not.toHaveBeenCalled();
  });
});

describe('RefundPaymentHandler', () => {
  const reserved = { payment: { ...row({ status: 'held', stripeChargeId: 'ch_1' }), contractId: 'ct1', providerId: 'prov-1', payerId: 'client-1', refundedCents: 0 }, amountCents: 10_000, providerShare: 9_153, feeShare: 847 };

  it('réserve le montant, rembourse chez Stripe, puis finalise', async () => {
    const f = fakes();
    f.repo.beginRefund.mockResolvedValue(reserved);
    await expect(new RefundPaymentHandler(f.repo, f.stripe).execute(new RefundPaymentCommand(admin, 'p1', 10_000, 'geste commercial'))).resolves.toEqual({ refundedCents: 10_000 });
    expect(f.stripe.refund).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: 'pi_1', amountCents: 10_000 }));
    expect(f.repo.completeRefund).toHaveBeenCalled();
    expect(f.repo.failRefund).not.toHaveBeenCalled();
  });

  it('échec Stripe : le montant réservé est libéré', async () => {
    const f = fakes();
    f.repo.beginRefund.mockResolvedValue(reserved);
    f.stripe.refund.mockRejectedValue(new Error('card closed'));
    await expect(new RefundPaymentHandler(f.repo, f.stripe).execute(new RefundPaymentCommand(admin, 'p1', 10_000))).rejects.toThrow('card closed');
    expect(f.repo.failRefund).toHaveBeenCalled();
    expect(f.repo.completeRefund).not.toHaveBeenCalled();
  });

  it('fonds déjà versés : refusé avant tout appel Stripe', async () => {
    const f = fakes();
    f.repo.beginRefund.mockRejectedValue(new InvalidStateError('fonds déjà versés'));
    await expect(new RefundPaymentHandler(f.repo, f.stripe).execute(new RefundPaymentCommand(admin, 'p1'))).rejects.toThrow(/déjà versés/);
    expect(f.stripe.refund).not.toHaveBeenCalled();
  });
});
