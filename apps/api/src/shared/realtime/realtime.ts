import { Controller, Global, Injectable, Logger, Module, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { jwtVerify, SignJWT } from 'jose';
import { createClient } from 'redis';
import { Server, Socket } from 'socket.io';
import { AuthUser, CurrentUser } from '../auth/auth';

/**
 * Le navigateur n'a jamais le jeton d'accès (BFF, cookie httpOnly). Il demande donc au BFF un TICKET :
 * un JWT HS256 signé, valable 30 s, utilisable uniquement pour le handshake WebSocket. Sans état : pas de Redis requis.
 */
@Injectable()
export class WsTicketService {
  private readonly key: Uint8Array;

  constructor() {
    const secret = process.env.WS_TICKET_SECRET;
    if (!secret || secret.length < 32) throw new Error('WS_TICKET_SECRET manquant ou < 32 caractères');
    this.key = new TextEncoder().encode(secret);
  }

  issue(userId: string) {
    return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setAudience('ws').setIssuedAt().setExpirationTime('30s').sign(this.key);
  }

  async verify(ticket: string): Promise<string> {
    const { payload } = await jwtVerify(ticket, this.key, { audience: 'ws', algorithms: ['HS256'] });
    return payload.sub!;
  }
}

/**
 * Passerelle POUSSÉE uniquement (serveur -> client). Toute écriture passe par l'API REST : validée, limitée en débit,
 * idempotente et testable. Chaque utilisateur rejoint la room `user:{id}` (tous ses appareils reçoivent les événements).
 */
@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN?.split(','), credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger(RealtimeGateway.name);

  constructor(private readonly tickets: WsTicketService) {}

  // Montée en charge : avec REDIS_URL, plusieurs instances API partagent les rooms (un emit atteint le bon socket où qu'il soit).
  async afterInit(server: Server) {
    const url = process.env.REDIS_URL;
    if (!url) return this.log.warn('REDIS_URL absent : temps réel limité à une seule instance');
    const pub = createClient({ url });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    server.adapter(createAdapter(pub, sub));
  }

  async handleConnection(socket: Socket) {
    try {
      const userId = await this.tickets.verify(String(socket.handshake.auth?.ticket ?? ''));
      await socket.join(`user:${userId}`);
    } catch {
      socket.disconnect(true);
    }
  }

  /** Jamais bloquant : un échec de push ne doit pas faire échouer l'action métier (le client rattrape par REST). */
  emitToUser(userId: string, event: string, payload: unknown) {
    try {
      this.server?.to(`user:${userId}`).emit(event, payload);
    } catch (e) {
      this.log.warn(`emit ${event} échoué: ${String(e)}`);
    }
  }
}

@Controller('realtime')
class RealtimeController {
  constructor(private readonly tickets: WsTicketService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('ticket')
  async ticket(@CurrentUser() user: AuthUser) {
    return { ticket: await this.tickets.issue(user.id), expiresIn: 30 };
  }
}

@Global()
@Module({ controllers: [RealtimeController], providers: [WsTicketService, RealtimeGateway], exports: [RealtimeGateway] })
export class RealtimeModule {}
