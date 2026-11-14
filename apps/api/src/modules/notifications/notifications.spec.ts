import { renderEmail } from '../../shared/email/email';
import { hrefFor } from './notifications.module';

describe('hrefFor', () => {
  it('envoie le client sur sa demande, sinon sur ses paiements', () => {
    expect(hrefFor('quote.sent', { requestId: 'r1' }, true)).toBe('/client/demandes/r1');
    expect(hrefFor('contract.work_done', { contractId: 'c1' }, true)).toBe('/client/paiements');
  });

  it('envoie le prestataire sur la page de la famille d\'événement', () => {
    expect(hrefFor('quote.accepted', {}, false)).toBe('/prestataire/contrats');
    expect(hrefFor('quote.rejected', {}, false)).toBe('/prestataire/devis');
    expect(hrefFor('payment.released', {}, false)).toBe('/prestataire/factures');
    expect(hrefFor('provider.rejected', {}, false)).toBe('/prestataire/profil');
    expect(hrefFor('review.received', {}, false)).toBeUndefined();
  });
});

describe('renderEmail', () => {
  it('échappe le contenu et garde le lien dans les deux versions', () => {
    const { text, html } = renderEmail({ title: 'Devis <b>reçu</b>', body: 'Froid & Cie', cta: { label: 'Ouvrir', url: 'https://x.test/client' } });
    expect(html).not.toContain('<b>reçu</b>');
    expect(html).toContain('Froid &#38; Cie');
    expect(html).toContain('href="https://x.test/client"');
    expect(text).toContain('Ouvrir : https://x.test/client');
  });
});
