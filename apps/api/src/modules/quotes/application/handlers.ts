import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler, IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { CreateQuoteInput, QuoteContentInput, QuoteDto } from '@frigoconnect/contracts';
import { AuthUser } from '../../../shared/auth/auth';
import { EmailSender } from '../../../shared/email/email';
import { DomainError, ForbiddenError, InvalidStateError, NotFoundError } from '../../../shared/kernel/errors';
import { FilesService } from '../../files/files.module';
import { QUOTE_REPOSITORY, QuoteContext, QuoteRepository } from '../domain/ports';
import { Quote } from '../domain/quote';
import { QuotePdfData, renderQuotePdf, renderSignatureCertificate } from '../infrastructure/pdf-renderer';

const CODE_TTL_MS = 10 * 60_000;

/**
 * Test local seulement : DEV_FIXED_CODE (6 chiffres) remplace le code aléatoire et est renvoyé à l'écran (pas d'email).
 * Ignoré tant que la clé Stripe n'est pas une clé de TEST : impossible à activer par erreur en production.
 */
export const devFixedCode = () => {
  const c = process.env.DEV_FIXED_CODE;
  return c && /^\d{6}$/.test(c) && (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_test_') ? c : null;
};

// ---------- helpers ----------
const providerOf = (ctx: QuoteContext | null, user: AuthUser): QuoteContext => {
  if (!ctx || ctx.quote.toSnapshot().providerId !== user.id) throw new NotFoundError('Devis'); // 404 : ne révèle pas l'existence
  return ctx;
};
const clientOf = (ctx: QuoteContext | null, user: AuthUser): QuoteContext => {
  if (!ctx || ctx.clientId !== user.id || ctx.quote.status === 'draft') throw new NotFoundError('Devis'); // un brouillon n'existe pas pour le client
  return ctx;
};

function pdfData(ctx: QuoteContext, signature?: QuotePdfData['signature']): QuotePdfData {
  const s = ctx.quote.toSnapshot();
  const t = ctx.quote.totals();
  return {
    number: s.number!, issuedAt: s.sentAt ?? new Date(), validUntil: s.validUntil,
    provider: { name: ctx.providerName, ...ctx.provider },
    client: { name: ctx.clientFullName, company: ctx.clientCompany },
    intervention: ctx.request,
    items: s.items.map((i, k) => ({ ...i, unit: i.unit, lineSubtotalCents: t.lineSubtotals[k] })),
    totals: t, depositPercent: s.depositPercent, depositCents: t.depositCents,
    estimatedStart: s.estimatedStart ?? null, estimatedDurationHours: s.estimatedDurationHours ?? null, notes: s.notes ?? null, signature,
  };
}

const otpHash = (quoteId: string, code: string) => {
  const secret = process.env.OTP_SECRET;
  if (!secret || secret.length < 32) throw new Error('OTP_SECRET manquant ou < 32 caractères');
  return createHmac('sha256', secret).update(`${quoteId}:${code}`).digest('hex');
};

// ---------- Prestataire : créer / modifier / envoyer / retirer ----------
export class CreateQuoteCommand { constructor(readonly user: AuthUser, readonly input: CreateQuoteInput) {} }
export class UpdateQuoteCommand { constructor(readonly user: AuthUser, readonly id: string, readonly content: QuoteContentInput) {} }
export class SendQuoteCommand { constructor(readonly user: AuthUser, readonly id: string) {} }
export class ImportQuotePdfCommand { constructor(readonly user: AuthUser, readonly id: string, readonly fileId: string) {} }
export class WithdrawQuoteCommand { constructor(readonly user: AuthUser, readonly id: string) {} }

@CommandHandler(CreateQuoteCommand)
export class CreateQuoteHandler implements ICommandHandler<CreateQuoteCommand, string> {
  constructor(@Inject(QUOTE_REPOSITORY) private readonly repo: QuoteRepository) {}

  async execute({ user, input }: CreateQuoteCommand) {
    const { requestId, ...content } = input;
    const req = await this.repo.getRequestForQuote(requestId, user.id);
    if (!req) throw new NotFoundError('Demande');
    if (!req.matched) throw new ForbiddenError('Cette demande ne vous a pas été proposée');
    if (!['open', 'quoted'].includes(req.status)) throw new InvalidStateError('Cette demande n\'accepte plus de devis');
    const quote = Quote.draft(user.id, requestId, content);
    await this.repo.save(quote, []);
    return quote.id;
  }
}

@CommandHandler(UpdateQuoteCommand)
export class UpdateQuoteHandler implements ICommandHandler<UpdateQuoteCommand, void> {
  constructor(@Inject(QUOTE_REPOSITORY) private readonly repo: QuoteRepository) {}

  async execute({ user, id, content }: UpdateQuoteCommand) {
    const { quote } = providerOf(await this.repo.findContext(id), user);
    quote.replaceContent(user.id, content);
    await this.repo.save(quote, []);
  }
}

@CommandHandler(ImportQuotePdfCommand)
export class ImportQuotePdfHandler implements ICommandHandler<ImportQuotePdfCommand, void> {
  constructor(@Inject(QUOTE_REPOSITORY) private readonly repo: QuoteRepository, private readonly files: FilesService) {}

  async execute({ user, id, fileId }: ImportQuotePdfCommand) {
    const { quote } = providerOf(await this.repo.findContext(id), user);
    if (quote.status !== 'draft') throw new InvalidStateError('Seul un brouillon peut recevoir un PDF');
    await this.files.claimPdf(user.id, fileId, { type: 'quote', id });
    await this.repo.setImportedPdf(id, fileId);
  }
}

@CommandHandler(SendQuoteCommand)
export class SendQuoteHandler implements ICommandHandler<SendQuoteCommand, void> {
  constructor(@Inject(QUOTE_REPOSITORY) private readonly repo: QuoteRepository, private readonly files: FilesService) {}

  async execute({ user, id }: SendQuoteCommand) {
    const ctx = providerOf(await this.repo.findContext(id), user);
    if (!ctx.providerPayoutsReady) throw new InvalidStateError('Configurez votre compte de paiement (onglet Accueil) avant d\'envoyer un devis');
    ctx.quote.send(user.id); // valide l'état et la date ; ne persiste pas encore
    const s = ctx.quote.toSnapshot();
    // Le PDF est fixé UNE fois (importé par le prestataire, sinon généré et stocké ici) : c'est lui que le client verra et dont l'empreinte sera signée.
    const fileId = ctx.pdfImported && ctx.pdfFileId
      ? ctx.pdfFileId
      : (await this.files.storeBuffer({ ownerId: user.id, fileName: `${s.number}.pdf`, mimeType: 'application/pdf', buffer: await renderQuotePdf(pdfData(ctx)), entity: { type: 'quote', id } })).fileId;
    await this.repo.commitSend(ctx.quote, fileId, [
      { type: 'quote.sent', payload: { quoteId: id, number: s.number, requestId: s.requestId, clientId: ctx.clientId, providerId: user.id, providerName: ctx.providerName, totalCents: ctx.quote.totals().totalCents } },
    ]);
  }
}

@CommandHandler(WithdrawQuoteCommand)
export class WithdrawQuoteHandler implements ICommandHandler<WithdrawQuoteCommand, void> {
  constructor(@Inject(QUOTE_REPOSITORY) private readonly repo: QuoteRepository) {}

  async execute({ user, id }: WithdrawQuoteCommand) {
    const { quote } = providerOf(await this.repo.findContext(id), user);
    quote.withdraw(user.id);
    await this.repo.save(quote, [], false);
  }
}

// ---------- Client : refuser / signer ----------
export class RejectQuoteCommand { constructor(readonly user: AuthUser, readonly id: string, readonly reason?: string) {} }
export class RequestAcceptanceCodeCommand { constructor(readonly user: AuthUser, readonly id: string) {} }
export class AcceptQuoteCommand { constructor(readonly user: AuthUser, readonly id: string, readonly code: string, readonly ip: string, readonly userAgent: string) {} }

@CommandHandler(RejectQuoteCommand)
export class RejectQuoteHandler implements ICommandHandler<RejectQuoteCommand, void> {
  constructor(@Inject(QUOTE_REPOSITORY) private readonly repo: QuoteRepository) {}

  async execute({ user, id, reason }: RejectQuoteCommand) {
    const ctx = clientOf(await this.repo.findContext(id), user);
    ctx.quote.reject();
    const s = ctx.quote.toSnapshot();
    await this.repo.save(ctx.quote, [{ type: 'quote.rejected', payload: { quoteId: id, number: s.number, requestId: s.requestId, providerId: s.providerId, reason: reason ?? null } }], false);
  }
}

@CommandHandler(RequestAcceptanceCodeCommand)
export class RequestAcceptanceCodeHandler implements ICommandHandler<RequestAcceptanceCodeCommand, { devCode: string | null }> {
  constructor(@Inject(QUOTE_REPOSITORY) private readonly repo: QuoteRepository, private readonly email: EmailSender) {}

  async execute({ user, id }: RequestAcceptanceCodeCommand) {
    const ctx = clientOf(await this.repo.findContext(id), user);
    ctx.quote.assertAcceptable(); // inutile d'envoyer un code pour un devis expiré ou déjà tranché
    const devCode = devFixedCode();
    const code = devCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    const ok = await this.repo.issueCode(id, otpHash(id, code), new Date(Date.now() + CODE_TTL_MS));
    if (!ok) throw new InvalidStateError('Un code vient d\'être envoyé : patientez une minute avant d\'en demander un nouveau');
    if (devCode) return { devCode };
    await this.email.send({
      to: ctx.clientEmail,
      subject: `Votre code de signature — devis ${ctx.quote.toSnapshot().number}`,
      text: `Votre code de signature : ${code}\n\nIl est valable 10 minutes et sert à accepter le devis ${ctx.quote.toSnapshot().number} de ${ctx.providerName}.\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : rien ne sera signé.`,
    });
    return { devCode: null };
  }
}

/** Code incorrect : 400 (pas 409), le client peut réessayer dans la limite de 5 essais. */
export class InvalidCodeError extends DomainError {
  constructor() { super('Code incorrect', 'INVALID_CODE'); }
}

@CommandHandler(AcceptQuoteCommand)
export class AcceptQuoteHandler implements ICommandHandler<AcceptQuoteCommand, void> {
  constructor(@Inject(QUOTE_REPOSITORY) private readonly repo: QuoteRepository, private readonly files: FilesService) {}

  async execute({ user, id, code, ip, userAgent }: AcceptQuoteCommand) {
    const ctx = clientOf(await this.repo.findContext(id), user);
    ctx.quote.assertAcceptable();
    if (!ctx.pdfSha256) throw new InvalidStateError('Devis sans document : impossible de signer');

    // Une tentative est consommée AVANT la comparaison (atomique) : pas de force brute en parallèle.
    const expected = await this.repo.consumeAttempt(id);
    if (!expected) throw new InvalidStateError('Code expiré ou trop d\'essais : demandez un nouveau code');
    const given = otpHash(id, code);
    if (expected.length !== given.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(given))) throw new InvalidCodeError();

    const s = ctx.quote.toSnapshot();
    const signedAt = new Date();
    const signature = { signedAt, signerName: ctx.clientFullName, signerEmail: ctx.clientEmail, ip, pdfSha256: ctx.pdfSha256 };
    const buffer = ctx.pdfImported ? await renderSignatureCertificate({ number: s.number!, providerName: ctx.providerName, signature }) : await renderQuotePdf(pdfData(ctx, signature));
    // ponytail: si la transaction échoue après ce stockage, un PDF orphelin reste dans MinIO (nettoyage périodique à prévoir).
    const { fileId } = await this.files.storeBuffer({ ownerId: s.providerId, fileName: `${s.number}-signe.pdf`, mimeType: 'application/pdf', buffer, entity: { type: 'quote', id } });

    ctx.quote.accept(signedAt);
    await this.repo.commitAcceptance(
      ctx.quote,
      { signerId: user.id, signerEmail: ctx.clientEmail, ip, userAgent, pdfSha256: ctx.pdfSha256, signedPdfFileId: fileId },
      ctx.clientId,
      s.sentAt, // l'envoi du devis vaut engagement et signature du prestataire
      (rejectedIds) => [
        { type: 'quote.accepted', payload: { quoteId: id, number: s.number, requestId: s.requestId, clientId: ctx.clientId, providerId: s.providerId, totalCents: ctx.quote.totals().totalCents } },
        ...rejectedIds.map((qid) => ({ type: 'quote.rejected', payload: { quoteId: qid, requestId: s.requestId, reason: 'Un autre devis a été retenu', auto: true } })),
      ],
    );
  }
}

// ---------- Lectures ----------
export class GetQuoteQuery { constructor(readonly user: AuthUser, readonly id: string) {} }
export class ListQuotesQuery { constructor(readonly user: AuthUser, readonly requestId: string) {} }
export class ListMyQuotesQuery { constructor(readonly user: AuthUser) {} }

@QueryHandler(GetQuoteQuery)
export class GetQuoteHandler implements IQueryHandler<GetQuoteQuery, QuoteDto> {
  constructor(@Inject(QUOTE_REPOSITORY) private readonly repo: QuoteRepository) {}

  async execute({ user, id }: GetQuoteQuery) {
    const dto = await this.repo.getDto(id);
    if (!dto) throw new NotFoundError('Devis');
    const isProvider = dto.providerId === user.id;
    const isClient = dto.status !== 'draft' && (await this.repo.getRequestClientId(dto.requestId)) === user.id;
    if (!isProvider && !isClient && !user.roles.includes('super_admin')) throw new NotFoundError('Devis');
    return dto;
  }
}

@QueryHandler(ListQuotesQuery)
export class ListQuotesHandler implements IQueryHandler<ListQuotesQuery, QuoteDto[]> {
  constructor(@Inject(QUOTE_REPOSITORY) private readonly repo: QuoteRepository) {}

  async execute({ user, requestId }: ListQuotesQuery) {
    if (user.roles.includes('provider')) return this.repo.listForRequest(requestId, { providerId: user.id });
    if ((await this.repo.getRequestClientId(requestId)) !== user.id) throw new NotFoundError('Demande');
    return this.repo.listForRequest(requestId, { excludeDraft: true });
  }
}

@QueryHandler(ListMyQuotesQuery)
export class ListMyQuotesHandler implements IQueryHandler<ListMyQuotesQuery, QuoteDto[]> {
  constructor(@Inject(QUOTE_REPOSITORY) private readonly repo: QuoteRepository) {}
  execute({ user }: ListMyQuotesQuery) {
    return this.repo.listForProvider(user.id);
  }
}

export const commandHandlers = [
  CreateQuoteHandler, UpdateQuoteHandler, ImportQuotePdfHandler, SendQuoteHandler, WithdrawQuoteHandler,
  RejectQuoteHandler, RequestAcceptanceCodeHandler, AcceptQuoteHandler,
];
export const queryHandlers = [GetQuoteHandler, ListQuotesHandler, ListMyQuotesHandler];
