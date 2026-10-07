import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
if (typeof process.getuid==='function' && process.getuid()===0) throw new Error('Run as the ordinary project owner, not root.')
const dir=path.resolve('identity-private')
fs.mkdirSync(dir,{recursive:true,mode:0o700})
const file=path.join(dir,'.env.identity.local')
const key=()=>crypto.randomBytes(32).toString('base64url')
const content=`# PRIVATE DEVELOPMENT ONLY. Not a production configuration.
NODE_ENV=development
APP_HOST=127.0.0.1
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=myuser
DB_NAME=mydb
DB_PASSWORD=REPLACE_WITH_EXISTING_LOCAL_DATABASE_PASSWORD
DB_SYNCHRONIZE=false
AUTH_JWT_SECRET=${key()}
AUTH_TOKEN_PEPPER=${key()}
AUTH_WEB_ORIGINS=http://localhost:8081,http://127.0.0.1:8081
AUTH_ALLOW_INSECURE_DEV=true
AUTH_OTP_MODE=development_test
AUTH_DEV_OTP=${String(crypto.randomInt(0,1000000)).padStart(6,'0')}
# Optional. Enable ONLY for trusted local /test_nest smoke calls, then configure
# X-DARA-Smoke-Key on both n8n HTTP nodes. Never in APK/PWA or in production.
# AUTH_SMOKE_SERVICE_KEY=generate_a_separate_random_secret_if_needed
`
fs.writeFileSync(file,content,{flag:'wx',mode:0o600})
console.log('Created identity-private/.env.identity.local (0600). Edit DB_PASSWORD locally. Secrets/code not printed.')
