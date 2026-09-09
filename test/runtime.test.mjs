import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRecoveryKey,importRecoveryKey,encryptMessage,decryptMessage} from '../src/crypto.js';
const issuer='https://test.cloudflareaccess.com',origin='http://localhost';
function inbox(ws){const events=[];let wake;ws.addEventListener('message',e=>{events.push(JSON.parse(e.data));wake?.();});ws.accept();return {send:e=>ws.send(JSON.stringify(e)),async next(type){const end=Date.now()+5000;for(;;){const i=events.findIndex(e=>e.type===type);if(i>=0)return events.splice(i,1)[0];if(Date.now()>end)throw Error('Timed out waiting for '+type+'; '+JSON.stringify(events));await new Promise(r=>{wake=r;setTimeout(r,50);});}},close:()=>ws.close()};}
test('real Worker: verified membership, ciphertext persistence, recipient receipts, and retry safety',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk={...await exportJWK(publicKey),kid:'test',alg:'RS256',use:'sig'};
 const token=(email,aud='test-aud',expiry='1h')=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(issuer).setAudience(aud).setSubject(email).setExpirationTime(expiry).sign(privateKey);
 const alice=await token('alice@example.test'),bob=await token('bob@example.test');const directory=await mkdtemp(join(tmpdir(),'thunder-test-'));
 const options={unsafeInspectDurableObjects:true,name:'thunder-test',modules:true,scriptPath:'dist/worker.js',compatibilityDate:'2024-11-01',durableObjects:{Chat:{className:'Chat',useSQLite:true}},resourcePersistencePath:directory,isolatedResourcePersistencePath:directory,bindings:{ACCESS_TEAM:issuer,ACCESS_AUD:'test-aud',OWNER_EMAIL:'alice@example.test',MEMBER_EMAILS:'alice@example.test,bob@example.test'},serviceBindings:{ASSETS:()=>new Response('local test')},outboundService:request=>{assert.equal(request.url,issuer+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});}};
 let mf=new Miniflare(convertV4MiniflareOptions(options));const clients=[];
 async function request(path,jwt,extra={}){return mf.dispatchFetch(origin+path,{headers:{...(jwt?{'Cf-Access-Jwt-Assertion':jwt}:{}),...extra}});}
 async function connect(jwt){const response=await request('/api/chat',jwt,{Upgrade:'websocket',Origin:origin});assert.equal(response.status,101);const client=inbox(response.webSocket);clients.push(client);await client.next('hello');return client;}
 try{
 assert.equal((await request('/api/me',null,{'Cf-Access-Authenticated-User-Email':'alice@example.test'})).status,401);
 for(const invalid of [await token('outsider@example.test'),await token('alice@example.test','wrong'),await token('alice@example.test','test-aud','-1h')])assert.equal((await request('/api/me',invalid)).status,401);
 assert.equal((await request('/api/chat',alice,{Upgrade:'websocket',Origin:'https://evil.example'})).status,403);
 assert.equal((await request('/api/me',alice)).status,200);
 const archiveName='a'.repeat(21),archive=await mf.unsafeGetDurableObjectStorage('thunder-test','Chat',{name:archiveName});
 await archive.exec('CREATE TABLE messages (id TEXT PRIMARY KEY,user TEXT,role TEXT,content TEXT)');
 await archive.exec('INSERT INTO messages VALUES (?,?,?,?)','old-id','Old name','user','Existing private history');
 const tablesBefore=await archive.exec("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name");
 assert.equal((await request('/api/legacy/'+archiveName,bob)).status,403);
 const legacy=await request('/api/legacy/'+archiveName,alice);assert.equal(legacy.status,200);assert.equal((await legacy.json()).messages[0].content,'Existing private history');
 assert.deepEqual(await archive.exec("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name"),tablesBefore);
 assert.equal((await archive.exec('SELECT content FROM messages'))[0].content,'Existing private history');
 const meResponse=await request('/api/me',alice);assert.equal(meResponse.headers.get('cache-control'),'no-store');assert.ok(meResponse.headers.get('content-security-policy').includes("script-src 'self'"));

 const a=await connect(alice),b=await connect(bob),keys=await importRecoveryKey(createRecoveryKey());
 b.send({type:'configure',keyId:keys.keyId});assert.match((await b.next('error')).message,/owner/);
 a.send({type:'configure',keyId:keys.keyId});await a.next('hello');await b.next('hello');
 const m=await encryptMessage(keys,'alice@example.test',"Private message: O'Brien 🔐");
 b.send({type:'send',message:m});assert.match((await b.next('error')).message,/identity/);
 a.send({type:'send',message:{...m,plaintext:'leak'}});assert.match((await a.next('error')).message,/Unexpected/);
 a.send({type:'send',message:m});const stored=await a.next('stored');assert.equal(stored.message.deliveries.length,0);const received=await b.next('message');assert.equal(received.message.ciphertext,m.ciphertext);
 b.send({type:'received',id:m.id,proof:'A'.repeat(43)});assert.match((await b.next('error')).message,/decryption/);
 const decoded=await decryptMessage(keys,received.message);a.send({type:'received',id:m.id,proof:decoded.proof});assert.match((await a.next('error')).message,/different recipient/);
 b.send({type:'received',id:m.id,proof:decoded.proof});assert.equal((await a.next('receipt')).deliveries[0].recipient,'bob@example.test');
 a.send({type:'send',message:m});assert.equal((await a.next('stored')).message.seq,stored.message.seq);
 a.send({type:'send',message:{...m,ciphertext:'A'.repeat(50)}});assert.match((await a.next('error')).message,/already used/);
 a.send({type:'history'});const history=await a.next('history');assert.equal(history.messages.length,1);assert.ok(!JSON.stringify(history).includes(decoded.text));
 for(let i=0;i<51;i++){const next=await encryptMessage(keys,'alice@example.test','Pagination '+i);a.send({type:'send',message:next});await a.next('stored');}
 a.send({type:'history'});const latest=await a.next('history');assert.equal(latest.messages.length,50);assert.equal(latest.hasMore,true);
 a.send({type:'history',before:latest.messages[0].seq});const earlier=await a.next('history');assert.equal(earlier.messages.length,2);assert.equal(earlier.hasMore,false);

 for(const c of clients)c.close();await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions(options));
 const restored=await connect(bob);restored.send({type:'history'});const recent=await restored.next('history');assert.equal(recent.messages.length,50);restored.send({type:'history',before:recent.messages[0].seq});const saved=await restored.next('history');assert.equal(saved.messages[0].deliveries.length,1);assert.equal((await decryptMessage(keys,saved.messages[0])).text,decoded.text);
 }finally{for(const c of clients){try{c.close();}catch{}}await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
