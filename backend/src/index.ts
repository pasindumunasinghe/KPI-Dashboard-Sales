import { config } from './config';
import { pool } from './db/pool';
import { runMigrations } from './db/migrate';
import { createApp } from './app';
import { ensureAdminUser, seedDatasets } from './seed';

async function main() {
  await runMigrations();
  await ensureAdminUser();

  const app = createApp();
  const server = app.listen(config.port, () => console.log(`API listening on :${config.port}`));

  if (config.seedOnStart) {
    // Runs in the background so the API (and its health check) is up immediately.
    seedDatasets().catch((err) => console.error('Seeding failed', err));
  }

  const shutdown = () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
