import 'reflect-metadata';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parse } from 'dotenv';
import { DataSource } from 'typeorm';
import { ConversationContinuity1792108800000 } from '../src/chat/migrations/1792108800000-ConversationContinuity';

async function main() {
  const [file, database, ...extra] = process.argv.slice(2);
  if (!file || !isAbsolute(file) || !database || extra.length || (statSync(file).mode & 0o077)) throw Error('EXPLICIT_PRIVATE_ENV_AND_DATABASE_REQUIRED');
  const env = parse(readFileSync(file));
  if (env.DB_NAME !== database || env.DB_HOST !== '127.0.0.1' || env.DB_PORT !== '55432' || env.DB_SYNCHRONIZE !== 'false' || !env.DB_PASSWORD || !['development','test'].includes(env.NODE_ENV)) throw Error('DESTINATION_MISMATCH');
  if (database !== 'dara_phase_a_native_20261010_204435' && !/^dara_b2_test_[a-z0-9_]+$/.test(database)) throw Error('UNAPPROVED_DATABASE');
  const ds = new DataSource({ type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT), username: env.DB_USER, password: env.DB_PASSWORD, database, entities: [], synchronize: false, migrationsRun: false, migrations: [ConversationContinuity1792108800000], migrationsTableName: 'chat_migrations', logging: false });
  await ds.initialize();
  try {
    const [target] = await ds.query('SELECT current_database() database, current_user username');
    if (target.database !== database || target.username !== env.DB_USER) throw Error('DATABASE_IDENTITY_MISMATCH');
    console.log(JSON.stringify({ target, host: env.DB_HOST, port: env.DB_PORT, synchronize: false }));
    const migrations = await ds.runMigrations({ transaction: 'all' });
    console.log(JSON.stringify({ applied: migrations.map(m => m.name), identitySchemaChanged: false }));
  } finally { await ds.destroy(); }
}
main().catch(() => { console.error('CHAT_MIGRATION_FAILED: inspect approved destination/configuration; no secrets printed'); process.exitCode = 1; });
