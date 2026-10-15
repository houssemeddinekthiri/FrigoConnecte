import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody : le corps brut est requis pour vérifier la signature des webhooks Stripe
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.set('trust proxy', 1); // derrière Nginx : vraie IP client pour le rate limiting
  app.use(helmet());
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(','), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
