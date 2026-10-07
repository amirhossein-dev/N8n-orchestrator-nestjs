import { randomUUID } from 'node:crypto';
import { IdentityStore, Role, Status, fail } from './model';
import * as V from './validation';
export interface Roster { tenant:{slug:string;name:string;enterprise:boolean;status:Status}; members:{phone:string;firstName:string;lastName:string;roles:Role[];status:Status}[]; }
export function parseRoster(value:unknown):Roster {
  const x=V.object(value,['tenant','members']);const t=V.object(x.tenant,['slug','name','enterprise','status']);
  if(typeof t.enterprise!=='boolean'||!['active','suspended'].includes(String(t.status))||!Array.isArray(x.members)||x.members.length>1000) return fail('INVALID_ROSTER');
  const members=x.members.map(v=>{const m=V.object(v,['phone','firstName','lastName','roles','status']);if(!['active','suspended'].includes(String(m.status)))return fail('INVALID_STATUS');return {phone:V.phone(m.phone),firstName:V.text(m.firstName,80),lastName:V.text(m.lastName,80),roles:V.roles(m.roles),status:m.status as Status};});
  if(new Set(members.map(m=>m.phone)).size!==members.length)fail('DUPLICATE_ROSTER_PHONE');
  return {tenant:{slug:V.slug(t.slug),name:V.text(t.name,120),enterprise:t.enterprise,status:t.status as Status},members};
}
export async function provision(store:IdentityStore,roster:Roster,apply:boolean,actorLabel:string,now=Date.now()) {
  V.text(actorLabel,80);
  return store.transaction(async tx=>{
    const existing=(await tx.find('tenants',{slug:roster.tenant.slug}))[0];
    const tenant={id:existing?.id||randomUUID(),slug:roster.tenant.slug,name:roster.tenant.name,status:roster.tenant.status,enterprise:roster.tenant.enterprise};
    if(apply)await tx.put('tenants',tenant);
    let added=0,updated=0,unchanged=0;
    for(const row of roster.members) {
      let user=(await tx.find('users',{phone:row.phone}))[0];
      if(!user){user={id:randomUUID(),phone:row.phone,first_name:row.firstName,last_name:row.lastName,status:'active',phone_verified_at:null};if(apply)await tx.put('users',user);}
      const old=(await tx.find('memberships',{user_id:user.id,tenant_id:tenant.id}))[0];
      const changed=!old || old.status!==row.status || JSON.stringify([...old.roles].sort())!==JSON.stringify([...row.roles].sort());
      if(!old)added++;else if(changed)updated++;else unchanged++;
      if(apply&&changed)await tx.put('memberships',{id:old?.id||randomUUID(),tenant_id:tenant.id,user_id:user.id,roles:row.roles,status:row.status,revision:(old?.revision||0)+1});
      if(apply&&row.status==='suspended') for(const s of await tx.find('sessions',{user_id:user.id,tenant_id:tenant.id}))if(s.revoked_at===null)await tx.put('sessions',{...s,revoked_at:now,revoke_reason:'membership_suspended'});
    }
    if(apply&&tenant.status==='suspended')for(const s of await tx.find('sessions',{tenant_id:tenant.id}))if(s.revoked_at===null)await tx.put('sessions',{...s,revoked_at:now,revoke_reason:'tenant_suspended'});
    if(apply)await tx.put('import_batches',{id:randomUUID(),tenant_id:tenant.id,recorded_at:now,actor_label:actorLabel,added,updated});
    return {mode:apply?'APPLIED':'PREVIEW',tenant:tenant.slug,added,updated,unchanged,omittedMembers:'UNCHANGED',deletions:0,phoneVerificationGranted:false};
  });
}
