import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

const [envPath, ...extra] = process.argv.slice(2);
if (!envPath || extra.length || (statSync(envPath).mode & 0o077)) throw new Error('Usage: npm run test:continuity -- /absolute/private/test.env (0600)');
const config = dotenv.parse(readFileSync(envPath));
if (config.NODE_ENV !== 'test' || config.DB_HOST !== '127.0.0.1' || !/^dara_b2_test_[a-z0-9_]+$/.test(config.DB_NAME || '') || !/^dara_b2_[a-z0-9_]+$/.test(config.DB_USER || '') || config.DB_SYNCHRONIZE !== 'false') throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');
// Only explicit DB settings reach this run. No real provider/identity secrets.
const env = { PATH: process.env.PATH, NODE_ENV: 'test', DB_HOST: config.DB_HOST, DB_PORT: config.DB_PORT, DB_NAME: config.DB_NAME, DB_USER: config.DB_USER, DB_PASSWORD: config.DB_PASSWORD, DB_SYNCHRONIZE: 'false' };
const result = spawnSync(process.execPath, [resolve('node_modules/jest/bin/jest.js'), '--runInBand', '--runTestsByPath', 'src/chat/continuity.spec.ts'], { env, stdio: 'inherit' });
process.exitCode = result.status || (result.error ? 1 : 0);
