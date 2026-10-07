import { IdentityStore, Table, Tables, Tx } from '../src/identity/core/model';
export class MemoryIdentityStore implements IdentityStore {
  rows:Record<Table,Map<string,unknown>>={users:new Map(),tenants:new Map(),memberships:new Map(),challenges:new Map(),sessions:new Map(),refresh_tokens:new Map(),rate_limits:new Map(),import_batches:new Map()};
  private queue:Promise<unknown>=Promise.resolve();
  transaction<T>(fn:(tx:Tx)=>Promise<T>):Promise<T> {
    const run=this.queue.then(async()=>{
      const snapshot=structuredClone(this.rows);
      const tx:Tx={
        get:async<K extends Table>(t:K,id:string)=>(structuredClone(snapshot[t].get(id))||null) as Tables[K]|null,
        find:async<K extends Table>(t:K,where:Partial<Tables[K]>)=>[...snapshot[t].values()].filter(v=>Object.entries(where).every(([k,x])=>(v as Record<string,unknown>)[k]===x)).map(v=>structuredClone(v)) as Tables[K][],
        put:async<K extends Table>(t:K,row:Tables[K])=>{snapshot[t].set(row.id,structuredClone(row));},
      };
      const result=await fn(tx);this.rows=snapshot;return result;
    });
    this.queue=run.catch(()=>undefined);return run;
  }
}
