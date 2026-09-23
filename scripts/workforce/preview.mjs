// Local-only component verification. Synthetic source responses; never hosted proof.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
const root = process.cwd();
const here = path.join(root, 'scripts/workforce');
const run = process.env.WORKFORCE_RUN_DIR;
if (!run || !run.includes('/.hermes/tmp/agent-runs/')) throw new Error('Explicit run-owned scratch path required');
const person = (id, name, overrides = {}) => ({ id, name, role:'resident aide',status:'in',since:'2026-09-23T10:00:00Z',currentShift:'Day 6:00AM–6:00PM',nextShift:'2026-09-24 · Day 6:00AM–6:00PM',scheduleId:'synthetic-schedule',attendance:'expected',scheduledMinutes:2400,workedMinutes:2360,exceptions:0,fileStatus:'Requirements not configured',due:[],...overrides });
const snapshot = {facilityId:'11111111-1111-4111-8111-111111111111',facilityName:'Synthetic test building',generatedAt:'2026-09-23T19:00:00Z',timeclockEnabled:true,weekStart:'2026-09-14',weekEnd:'2026-09-20',nextWeekStart:'2026-09-28',scheduleStatus:'Draft',payrollStatus:'ADP setup pending',payrollRulesConfigured:false,people:[person('sample-a','Sample Person A'),person('sample-b','Sample Person B',{status:'out',since:null,attendance:'missing',exceptions:1,workedMinutes:null,due:[{title:'Orientation evidence',date:'2026-10-01'}]}),person('sample-c','Sample Person C',{attendance:'extra',currentShift:null})]};
const server = await createServer({ root:here,configFile:false,define:{'process.env':{}},cacheDir:path.join(run,'vite-cache'),plugins:[react(),{name:'synthetic-workforce-source',configureServer(server){server.middlewares.use('/api/admin/workforce',(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');const scenario = new URL(req.headers.referer ?? 'http://localhost').searchParams.get('scenario');if(scenario==='error'){res.statusCode=503;res.end(JSON.stringify({error:'Synthetic source unavailable. Retry to refresh.'}));}else res.end(JSON.stringify({...snapshot,timeclockEnabled:scenario!=='kiosk-off'}));});}}],resolve:{alias:[{find:'next/link',replacement:path.join(here,'fixture-link.tsx')},{find:'next/navigation',replacement:path.join(here,'fixture-navigation.ts')},{find:'@/contexts/haven-auth-context',replacement:path.join(here,'fixture-auth.ts')},{find:'@',replacement:path.join(root,'src')}]},css:{postcss:path.join(root,'postcss.config.mjs')},server:{host:'127.0.0.1',port:8948,strictPort:true,fs:{allow:[root]}},logLevel:'error'});
await server.listen();
fs.writeFileSync(path.join(run,'preview-scope.json'),JSON.stringify({url:'http://127.0.0.1:8948',scope:'Production Workforce components and CSS; synthetic API and shell; not hosted authentication proof'},null,2));
console.log('Workforce synthetic preview: http://127.0.0.1:8948');
