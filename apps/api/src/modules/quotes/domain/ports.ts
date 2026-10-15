import type { QuoteDto } from '@frigoconnect/contracts';
import { DomainEvent } from '../../../shared/kernel/aggregate-root';
import { Quote } from './quote';

export interface RequestForQuote {
  clientId: string;
  status: string;
  matched: boolean; // le prestataire figure dans request_matches
}

/** Tout ce qu'il faut pour autoriser une action et produire le PDF, en une lecture. */
export interface QuoteContext {
  quote: Quote;
  clientId: string;
  clientName: string; // "Prénom N." avant contrat
  clientFullName: string; // nom complet, pour la signature et le PDF
  clientEmail: string;
  clientCompany: string | null;
  providerName: string;
  provider: { siret: string; address: string | null; postalCode: string | null; city: string | null };
  request: { title: string; address: string; postalCode: string; city: string; serviceType: string };
  pdfFileId: string | null;
  pdfSha256: string | null;
  /** PDF fourni par le prestataire (et non généré par la plateforme). */
  pdfImported: boolean;
  /** Compte Stripe du prestataire prêt à recevoir des versements : sans lui, un devis accepté ne pourrait pas être réglé. */
  providerPayoutsReady: boolean;
}

export interface SignatureEvidence {
  signerId: string;
  signerEmail: string;
  ip: string;
  userAgent: string;
  pdfSha256: string;
  signedPdfFileId: string;
}

export interface QuoteRepository {
  getRequestForQuote(requestId: string, providerId: string): Promise<RequestForQuote | null>;
  /** Crée ou met à jour (numéro attribué à la création). `withItems=false` : n'écrit pas les lignes. */
  save(quote: Quote, events: DomainEvent[], withItems?: boolean): Promise<void>;
  findContext(id: string): Promise<QuoteContext | null>;
  /** Envoi : statut + PDF + compteur de la demande, atomiquement. Échoue si la demande est clôturée. */
  commitSend(quote: Quote, pdfFileId: string, events: DomainEvent[]): Promise<void>;

  /** Brouillon seulement : le PDF importé remplace celui que la plateforme génère à l'envoi. */
  setImportedPdf(quoteId: string, fileId: string): Promise<void>;

  /** Code à usage unique. false = redemandé trop tôt (60 s). */
  issueCode(quoteId: string, codeHash: string, expiresAt: Date): Promise<boolean>;
  /** Consomme UNE tentative de façon atomique et renvoie le hash attendu (null = expiré, déjà signé ou 5 essais épuisés). */
  consumeAttempt(quoteId: string): Promise<string | null>;
  /** Acceptation : devis, signature, contrat, autres devis refusés, demande attribuée, événements. Une seule transaction. */
  commitAcceptance(quote: Quote, evidence: SignatureEvidence, clientId: string, providerSignedAt: Date | null, events: (otherRejected: string[]) => DomainEvent[]): Promise<void>;

  getDto(id: string): Promise<QuoteDto | null>;
  listForRequest(requestId: string, filter: { providerId?: string; excludeDraft?: boolean }): Promise<QuoteDto[]>;
  listForProvider(providerId: string): Promise<QuoteDto[]>;
  getRequestClientId(requestId: string): Promise<string | null>;
  /** Marque expirés les devis envoyés dont la date de validité est passée. Retourne le nombre. */
  expireOverdue(): Promise<number>;
}
export const QUOTE_REPOSITORY = Symbol('QUOTE_REPOSITORY');
