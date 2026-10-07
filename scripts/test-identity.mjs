import {spawnSync} from 'node:child_process'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const out=mkdtempSync(join(tmpdir(),'dara-identity-tests-'))
try {
  const tsc=resolve('node_modules/typescript/bin/tsc')
  const args=[tsc,'--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--esModuleInterop','--skipLibCheck','--lib','ES2022,DOM','--types','node','--typeRoots',resolve('node_modules/@types'),'--outDir',out,'test/identity-core.test.ts']
  const compiled=spawnSync(process.execPath,args,{stdio:'inherit'})
  if(compiled.status!==0)process.exitCode=compiled.status||1
  else {const r=spawnSync(process.execPath,['--test',join(out,'test/identity-core.test.js')],{stdio:'inherit'});process.exitCode=r.status||0}
} finally {rmSync(out,{recursive:true,force:true})}
