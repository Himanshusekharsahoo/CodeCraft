import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const rootDir = path.resolve(__dirname, '../../');
const rootEnvLocal = loadEnvFile(path.join(rootDir, '.env.local'));
const rootEnv = loadEnvFile(path.join(rootDir, '.env'));
const serverEnvLocal = loadEnvFile(path.join(__dirname, '../.env.local'));
const serverEnv = loadEnvFile(path.join(__dirname, '../.env'));

const mergedEnv = {
  ...rootEnv,
  ...rootEnvLocal,
  ...serverEnv,
  ...serverEnvLocal,
  ...process.env,
};

const isRunningTest =
  process.env.NODE_ENV !== 'production' &&
  (process.env.NODE_ENV === 'test' ||
   process.env.COLLAB_TEST === 'true' ||
   mergedEnv.COLLAB_TEST === 'true' ||
   process.argv.some((arg) => arg.includes('test')));

export const config = {
  port: parseInt(mergedEnv.COLLAB_PORT || mergedEnv.PORT || '1234', 10),
  host: mergedEnv.COLLAB_HOST || '0.0.0.0',
  firebase: {
    apiKey: mergedEnv.NEXT_PUBLIC_FIREBASE_API_KEY || mergedEnv.FIREBASE_API_KEY || '',
    authDomain: mergedEnv.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || mergedEnv.FIREBASE_AUTH_DOMAIN || '',
    projectId: mergedEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID || mergedEnv.FIREBASE_PROJECT_ID || '',
    databaseURL: mergedEnv.NEXT_PUBLIC_FIREBASE_DATABASE_URL || mergedEnv.FIREBASE_DATABASE_URL || '',
    storageBucket: mergedEnv.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || mergedEnv.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: mergedEnv.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || mergedEnv.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: mergedEnv.NEXT_PUBLIC_FIREBASE_APP_ID || mergedEnv.FIREBASE_APP_ID || '',
  },
  persistence: {
    debounceMs: parseInt(mergedEnv.PERSISTENCE_DEBOUNCE_MS || '3500', 10),
    maxQuietPeriodMs: 10000,
  },
  allowedOrigins: mergedEnv.ALLOWED_ORIGINS
    ? mergedEnv.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['*'],
  isDev: mergedEnv.NODE_ENV !== 'production',
  isTest: isRunningTest,
  internalSecret: mergedEnv.COLLAB_INTERNAL_SECRET || mergedEnv.INTERNAL_SERVICE_KEY || 'cc-collab-internal-service-secret',
  // CC-017: Explicit defensive WebSocket resource and payload bounds
  limits: {
    maxPayloadBytes: 2 * 1024 * 1024, // 2MB max WebSocket message payload
    maxTotalConnections: 500, // Maximum concurrent connections per process
    maxClientsPerRoom: 50, // Maximum concurrent participants per collaborative room
    heartbeatIntervalMs: 30000, // 30-second ping interval to prune stale/dropped sockets
    maxMessagesPerSecond: 100, // Abusive burst rate ceiling per socket
  },
};
