import 'reflect-metadata';
import { readFileSync, statSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { dbConnection } from '../src/identity/db-options';
import { IdentityPhaseA1791331200000 } from '../src/identity/migrations/1791331200000-IdentityPhaseA';
import { PgIdentityStore } from '../src/identity/pg-store';
import { parseRoster, provision } from '../src/identity/core/provision';

async function main() {
  const [command,file,...flags]=process.argv.slice(2);
  if(!['migrate','provision','cleanup'].includes(command||''))throw new Error('Usage: identity-admin migrate | provision PATH [--apply] | cleanup [--apply]');
  if(command==='provision'&&(!file||flags.some(f=>f!=='--apply')))throw new Error('Usage: identity-admin provision PATH [--apply]');
  const ds=new DataSource({...dbConnection(),entities:[],synchronize:false,migrations:[IdentityPhaseA1791331200000],migrationsTableName:'identity_migrations',logging:false});
  await ds.initialize();
  try {
    if(command==='migrate') {
      const ran=await ds.runMigrations({transaction:'all'});
      console.log(JSON.stringify({status:'IDENTITY_MIGRATIONS_APPLIED',migrations:ran.map(m=>m.name),legacyTablesModified:false}));
    } else if(command==='provision') {
      if(statSync(file).size>256*1024)throw new Error('ROSTER_TOO_LARGE');
      const roster=parseRoster(JSON.parse(readFileSync(file,'utf8')));
      const result=await provision(new PgIdentityStore(ds),roster,flags.includes('--apply'),process.env.PROVISION_ACTOR_LABEL||'local-operator');
      console.log(JSON.stringify(result));
    } else {
      const apply=file==='--apply';if(file&&!apply)throw new Error('Only --apply accepted');
      const cutoff=Date.now()-24*3600000;
      const result=await ds.transaction(async m=>{
        await m.query("SET LOCAL lock_timeout = '3s'");
        await m.query('SELECT pg_advisory_xact_lock(44051,1)');
        const counts=await m.query(`SELECT
          (SELECT count(*)::int FROM identity_rate_limits WHERE expires_at < $1) AS rate_limits,
          (SELECT count(*)::int FROM identity_challenges WHERE expires_at < $1) AS expired_challenges,
          (SELECT count(*)::int FROM identity_refresh_tokens WHERE expires_at < $1) AS expired_refresh_tokens`,[cutoff]);
        if(apply){
          await m.query('DELETE FROM identity_rate_limits WHERE expires_at < $1',[cutoff]);
          await m.query('DELETE FROM identity_challenges WHERE expires_at < $1',[cutoff]);
          // Consumed refresh tokens remain until the family's absolute expiry + 24h;
          // deleting them earlier would defeat refresh-reuse detection.
          await m.query('DELETE FROM identity_refresh_tokens WHERE expires_at < $1',[cutoff]);
        }
        return {mode:apply?'APPLIED':'PREVIEW',...counts[0],sessionsDeleted:0,usersDeleted:0};
      });console.log(JSON.stringify(result));
    }
  }finally{await ds.destroy();}
}
main().catch(e=>{console.error(e?.code==='ECONNREFUSED'?'DATABASE_UNREACHABLE':e?.code&&/^[A-Z_]+$/.test(e.code)?e.code:'IDENTITY_ADMIN_FAILED: check local configuration/input/database. No payload or secrets printed.');process.exitCode=1;});
