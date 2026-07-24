import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Serve the static chat UI (web/public) from the app itself — same origin as
  // POST /query, so the browser needs no CORS and the one-command run still
  // yields a usable UI at `/`. __dirname is dist/, so ../web/public resolves to
  // web/public at the repo root (and /app/web/public in the container).
  app.useStaticAssets(join(__dirname, '..', 'web', 'public'));
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`rag API listening on :${port} (chat UI at /)`);
}

void bootstrap();
