import { createHmac } from 'node:crypto';
import { AuthUser } from '../../../shared/auth/auth';
import { InvalidStateError, NotFoundError } from '../../../shared/kernel/errors';
import { QuoteContext, QuoteRepository } from '../domain/ports';
import { Quote } from '../domain/quote';
import { AcceptQuoteCommand, AcceptQuoteHandler, InvalidCodeError, RequestAcceptanceCodeCommand, RequestAcceptanceCodeHandler } from './handlers';

process.env.OTP_SECRET = 'x'.repeat(40);
const hash = (id: string, code: string) => createHmac('sha256', process.env.OTP_SECRET!).update(`${id}:${code}`).digest('hex');

const client: AuthUser = { id: 'client-1', roles: ['client'] };
const quote = (status: 'draft' | 'sent' = 'sent') =>
  Quote.rehydrate({
    id: 'q1', number: 'DV-2026-000001', requestId: 'r1', providerId: 'prov-1', status, sentAt: new Date(),
    items: [{ label: 'Compresseur', quantity: 1, unit: 'u', unitPriceCents: 100000, vatRateBps: 2000 }],
    depositPercent: 30, validUntil: '2999-12-31',
  });
const ctx = (over: Partial<QuoteContext> = {}): QuoteContext => ({
  quote: quote(), clientId: 'client-1', clientName: 'Karim B.', clientFullName: 'Karim Benali', clientEmail: 'k@exemple.fr', clientCompany: null,
  providerName: 'Froid Express', provider: { siret: '12345678901234', address: null, postalCode: null, city: null },
  request: { title: 'Panne', address: '1 rue X', postalCode: '69001', city: 'Lyon', serviceType: 'breakdown' },
  pdfFileId: 'f1', pdfSha256: 'ab'.repeat(32), pdfImported: false, providerPayoutsReady: true, ...over,
});

function setup(c: QuoteContext | null = ctx()) {
  const repo = {
    findContext: jest.fn().mockResolvedValue(c),
    issueCode: jest.fn().mockResolvedValue(true),
    consumeAttempt: jest.fn().mockResolvedValue(hash('q1', '123456')),
    commitAcceptance: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<QuoteRepository>;
  const files = { storeBuffer: jest.fn().mockResolvedValue({ fileId: 'signed-pdf', sha256: 'x' }) };
  const email = { send: jest.fn().mockResolvedValue(undefined) };
  return { repo, files, email };
}

describe('AcceptQuoteHandler', () => {
  const run = (h: AcceptQuoteHandler, code = '123456') => h.execute(new AcceptQuoteCommand(client, 'q1', code, '203.0.113.7', 'jest'));

  it('bon code : signe, stocke le PDF signé et valide en une transaction', async () => {
    const { repo, files } = setup();
    await run(new AcceptQuoteHandler(repo, files as never));
    expect(files.storeBuffer).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'DV-2026-000001-signe.pdf', mimeType: 'application/pdf' }));
    const [q, evidence, clientId] = repo.commitAcceptance.mock.calls[0];
    expect(q.status).toBe('accepted');
    expect(evidence).toMatchObject({ signerId: 'client-1', ip: '203.0.113.7', signedPdfFileId: 'signed-pdf', pdfSha256: 'ab'.repeat(32) });
    expect(clientId).toBe('client-1');
  });

  it('devis importé : le PDF fourni reste le document, la signature produit un certificat portant son empreinte', async () => {
    const { repo, files } = setup(ctx({ pdfImported: true }));
    await run(new AcceptQuoteHandler(repo, files as never));
    expect(files.storeBuffer).toHaveBeenCalledTimes(1);
    expect(repo.commitAcceptance.mock.calls[0][1]).toMatchObject({ pdfSha256: 'ab'.repeat(32), signedPdfFileId: 'signed-pdf' });
  });

  it('mauvais code : refusé, rien n\'est stocké ni validé', async () => {
    const { repo, files } = setup();
    await expect(run(new AcceptQuoteHandler(repo, files as never), '000000')).rejects.toBeInstanceOf(InvalidCodeError);
    expect(files.storeBuffer).not.toHaveBeenCalled();
    expect(repo.commitAcceptance).not.toHaveBeenCalled();
  });

  it('code expiré ou 5 essais épuisés : il faut en redemander un', async () => {
    const { repo, files } = setup();
    repo.consumeAttempt.mockResolvedValue(null);
    await expect(run(new AcceptQuoteHandler(repo, files as never))).rejects.toThrow(/nouveau code/);
    expect(repo.commitAcceptance).not.toHaveBeenCalled();
  });

  it('un autre client ne peut pas signer (404), ni sur un brouillon', async () => {
    const other = setup(ctx({ clientId: 'someone-else' }));
    await expect(run(new AcceptQuoteHandler(other.repo, other.files as never))).rejects.toBeInstanceOf(NotFoundError);
    const draft = setup(ctx({ quote: quote('draft') }));
    await expect(run(new AcceptQuoteHandler(draft.repo, draft.files as never))).rejects.toBeInstanceOf(NotFoundError);
    expect(other.repo.consumeAttempt).not.toHaveBeenCalled(); // pas d'essai de code consommé pour un non-autorisé
  });

  it('devis expiré : refusé avant même de toucher au code', async () => {
    const { repo, files } = setup(ctx({ quote: Quote.rehydrate({ ...quote().toSnapshot(), validUntil: '2000-01-01' }) }));
    await expect(run(new AcceptQuoteHandler(repo, files as never))).rejects.toThrow(/expiré/);
    expect(repo.consumeAttempt).not.toHaveBeenCalled();
  });
});

describe('RequestAcceptanceCodeHandler', () => {
  it('envoie le code par email, jamais stocké en clair', async () => {
    const { repo, email } = setup();
    await new RequestAcceptanceCodeHandler(repo, email as never).execute(new RequestAcceptanceCodeCommand(client, 'q1'));
    const stored = repo.issueCode.mock.calls[0][1];
    const mailed = /code de signature : (\d{6})/.exec(email.send.mock.calls[0][0].text)![1];
    expect(stored).toBe(hash('q1', mailed));
    expect(stored).not.toContain(mailed);
    expect(email.send.mock.calls[0][0].to).toBe('k@exemple.fr');
  });

  it('redemande trop tôt : refusée, aucun email', async () => {
    const { repo, email } = setup();
    repo.issueCode.mockResolvedValue(false);
    await expect(new RequestAcceptanceCodeHandler(repo, email as never).execute(new RequestAcceptanceCodeCommand(client, 'q1'))).rejects.toBeInstanceOf(InvalidStateError);
    expect(email.send).not.toHaveBeenCalled();
  });
});
