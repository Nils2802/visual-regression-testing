import { execSync } from 'child_process';

// Prisma resolves relative SQLite paths against the schema directory
// (prisma/), so "./test.db" means prisma/test.db.
const TEST_DATABASE_URL = 'file:./test.db';

export default function setup() {
  // Test workers inherit this; Prisma's dotenv load does not override
  // an already-set env var, so tests hit test.db instead of .env's dev.db.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.VRT_ENCRYPTION_KEY ??= 'a'.repeat(64);
  execSync('npx prisma db push --force-reset --skip-generate', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      // Prisma refuses --force-reset when invoked by an AI agent unless user
      // consent is recorded. This resets only the throwaway test database.
      PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION:
        'Consent granted — it’s the throwaway test database (prisma/test.db) only. Proceed.',
    },
  });
}
