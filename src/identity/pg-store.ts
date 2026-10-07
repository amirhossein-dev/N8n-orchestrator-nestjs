import { DataSource, EntityManager } from 'typeorm';
import { IdentityStore, Table, Tables, Tx } from './core/model';

const COLUMNS: Record<Table, readonly string[]> = {
  users:['id','phone','first_name','last_name','status','phone_verified_at'],
  tenants:['id','slug','name','status','enterprise'],
  memberships:['id','user_id','tenant_id','roles','status','revision'],
  challenges:['id','phone_key','user_id','tenant_id','code_hash','client','device_name','expires_at','attempts','consumed_at','assurance'],
  sessions:['id','user_id','tenant_id','client','assurance','cookie_hash','created_at','last_seen_at','expires_at','revoked_at','revoke_reason','device_name'],
  refresh_tokens:['id','session_id','expires_at','consumed_at'],
  rate_limits:['id','count','expires_at'],
  import_batches:['id','tenant_id','recorded_at','actor_label','added','updated'],
};
const NUMERIC = new Set(['phone_verified_at','created_at','last_seen_at','expires_at','consumed_at','revoked_at','recorded_at','revision','attempts','count','added','updated']);
class PgTx implements Tx {
  constructor(private readonly manager: EntityManager) {}
  private decode<K extends Table>(row: Record<string, unknown>): Tables[K] {
    for(const k of Object.keys(row)) if(NUMERIC.has(k)&&row[k]!==null) {
      const n=Number(row[k]);if(!Number.isSafeInteger(n))throw new Error('INVALID_DATABASE_NUMBER');row[k]=n;
    }
    return row as unknown as Tables[K];
  }
  async get<K extends Table>(table: K,id:string):Promise<Tables[K]|null> {
    const rows=await this.find(table,{id} as Partial<Tables[K]>);return rows[0]||null;
  }
  async find<K extends Table>(table:K,where:Partial<Tables[K]>):Promise<Tables[K][]> {
    const columns=COLUMNS[table];if(!columns)throw new Error('INVALID_TABLE');
    const entries=Object.entries(where);if(entries.some(([k])=>!columns.includes(k)))throw new Error('INVALID_COLUMN');
    const params:unknown[]=[];
    const clauses=entries.map(([k,v])=>{if(v===null)return `"${k}" IS NULL`;params.push(v);return `"${k}" = $${params.length}`;});
    const rows:Record<string,unknown>[]=await this.manager.query(`SELECT ${columns.map(c=>'"'+c+'"').join(',')} FROM identity_${table}${clauses.length?' WHERE '+clauses.join(' AND '):''}`,params);
    return rows.map(r=>this.decode<K>(r));
  }
  async put<K extends Table>(table:K,row:Tables[K]):Promise<void> {
    const columns=COLUMNS[table];const data=row as unknown as Record<string,unknown>;
    if(!columns || columns.some(k=>data[k]===undefined))throw new Error('INCOMPLETE_DATABASE_ROW');
    const params=columns.map(k=>k==='roles'?JSON.stringify(data[k]):data[k]);
    const values=columns.map((k,i)=>`$${i+1}${k==='roles'?'::jsonb':''}`);
    await this.manager.query(`INSERT INTO identity_${table} (${columns.map(k=>'"'+k+'"').join(',')}) VALUES (${values.join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(k=>k!=='id').map(k=>`"${k}" = EXCLUDED."${k}"`).join(',')}`,params);
  }
}
export class PgIdentityStore implements IdentityStore {
  constructor(private readonly ds:DataSource) {}
  transaction<T>(work:(tx:Tx)=>Promise<T>):Promise<T> {
    return this.ds.transaction(async manager=>{
      await manager.query("SET LOCAL lock_timeout = '3s'");
      await manager.query("SET LOCAL statement_timeout = '10s'");
      // Bounded first-phase implementation: one identity advisory lock.
      // Network I/O is outside the transaction. This favors correctness over scale;
      // replace with consistent account-scoped row locks only after concurrency tests.
      await manager.query('SELECT pg_advisory_xact_lock(44051, 1)');
      return work(new PgTx(manager));
    });
  }
}
