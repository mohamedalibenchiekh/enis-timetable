import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';

// Optional .env file (DATABASE_URL, PORT…) in the working directory.
try { process.loadEnvFile(path.join(process.cwd(), '.env')); } catch { /* no .env */ }

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  // Local desktop app: only reachable from this machine.
  app.enableCors({ origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] });

  // In production the exported Next.js site is served by the API itself (same origin → no CORS).
  const webDir = process.env.WEB_DIR ?? path.join(__dirname, '..', '..', 'web', 'out');
  if (fs.existsSync(path.join(webDir, 'index.html'))) app.useStaticAssets(webDir);

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '127.0.0.1');
  console.log(`API ready on http://127.0.0.1:${port}`);
}
bootstrap().catch((e) => {
  console.error('API failed to start:', e?.message ?? e);
  process.exit(1);
});
