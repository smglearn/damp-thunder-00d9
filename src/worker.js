import { DurableObject } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
const ROOM='private-e2ee-v2';
const B64=/^[A-Za-z0-9_-]+$/;
const LEGACY=/^[A-Za-z0-9_-]{21}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function members(env) {return new Set((env.MEMBER_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));}
function send(ws,event) {try {ws.send(JSON.stringify(event));} catch {try{ws.close(1011,'Reconnect');}catch{}}}
function error(message,status=400) {return new Response(message,{status});}
async function identity(request,env) {
  const token=request.headers.get('Cf-Access-Jwt-Assertion');
  if(!token||!env.ACCESS_TEAM||!env.ACCESS_AUD) throw Error('Unauthorized');
  const issuer=env.ACCESS_TEAM.replace(/\/$/,'');
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)) throw Error('Invalid Access configuration');
  const jwks=createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'));
  const {payload}=await jwtVerify(token,jwks,{issuer,audience:env.ACCESS_AUD,algorithms:['RS256'],requiredClaims:['sub','email','exp']});
  if(typeof payload.email!=='string'||typeof payload.sub!=='string') throw Error('Unauthorized');
  const email=payload.email.toLowerCase();
  if(!members(env).has(email)) throw Error('Not a chat member');
  return {email,sub:payload.sub,exp:payload.exp};
}
function secured(response) {
  const h=new Headers(response.headers);
  h.set('Cache-Control','no-store');h.set('Referrer-Policy','no-referrer');h.set('X-Content-Type-Options','nosniff');
  h.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return new Response(response.body,{status:response.status,headers:h});
}
export default {
  async fetch(request,env) {
    let user;try{user=await identity(request,env);}catch{return secured(error('Sign in with an invited Cloudflare Access account.',401));}
    const url=new URL(request.url);
    if(url.pathname==='/api/me'&&request.method==='GET') return secured(Response.json({email:user.email,owner:user.email===env.OWNER_EMAIL?.toLowerCase(),room:ROOM}));
    if(url.pathname==='/api/recovery') {
      if(user.email!==env.OWNER_EMAIL?.toLowerCase())return secured(error('Owner only',403));
      if(!['GET','POST'].includes(request.method))return secured(error('Method not allowed',405));
      if(request.method==='POST'&&(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json')))return secured(error('Origin or content type denied',403));
      const headers=new Headers(request.headers);headers.set('x-thunder-identity',JSON.stringify(user));
      return secured(await env.Chat.get(env.Chat.idFromName(ROOM)).fetch(new Request(request,{headers})));
    }
    const legacyApi=url.pathname.match(/^\/api\/legacy\/([A-Za-z0-9_-]{21})$/);
    if(legacyApi){
      if(user.email!==env.OWNER_EMAIL?.toLowerCase())return secured(error('Owner-only archive',403));
      if(request.method!=='GET')return secured(error('Archive is read-only',405));
      const headers=new Headers(request.headers);headers.set('x-thunder-identity',JSON.stringify(user));
      // PartyServer 0.0.57 routed by the room name directly; preserve that ID mapping.
      return secured(await env.Chat.get(env.Chat.idFromName(legacyApi[1])).fetch(new Request(request,{headers})));
    }
    if(LEGACY.test(url.pathname.slice(1))){
      if(user.email!==env.OWNER_EMAIL?.toLowerCase())return secured(error('Owner-only archive',403));
      if(request.method!=='GET')return secured(error('Archive is read-only',405));
      url.pathname='/legacy.html';return secured(await env.ASSETS.fetch(new Request(url,request)));
    }
    if(url.pathname==='/api/chat') {
      if(request.method!=='GET'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket') return secured(error('WebSocket required',426));
      if(request.headers.get('Origin')!==url.origin) return secured(error('Origin denied',403));
      const headers=new Headers(request.headers);
      headers.set('x-thunder-identity',JSON.stringify(user));
      return env.Chat.get(env.Chat.idFromName(ROOM)).fetch(new Request(request,{headers}));
    }
    if(request.method!=='GET'||!['/','/private','/app.js','/styles.css','/legacy.js'].includes(url.pathname)) return secured(error('Not found',404));
    if(url.pathname==='/private')url.pathname='/';
    return secured(await env.ASSETS.fetch(new Request(url,request)));
  }
};

export class Chat extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);this.ctx=ctx;this.env=env;
    this.encrypted=ctx.id.equals(env.Chat.idFromName(ROOM));
    // Existing objects are archive-only: no schema creation or storage mutation.
    if(!this.encrypted)return;
    ctx.blockConcurrencyWhile(async()=>{
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS encrypted_messages_v1(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,sender TEXT NOT NULL,envelope TEXT NOT NULL,stored_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS delivery_v1(message_id TEXT NOT NULL,recipient TEXT NOT NULL,delivered_at INTEGER NOT NULL,PRIMARY KEY(message_id,recipient));
        CREATE TABLE IF NOT EXISTS room_config_v1(id INTEGER PRIMARY KEY CHECK(id=1),key_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS rate_v1(sender TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);`);
    });
  }
  keyId() {return this.ctx.storage.sql.exec('SELECT key_id FROM room_config_v1 WHERE id=1').toArray()[0]?.key_id||null;}
  valid(user) {return user&&user.exp*1000>Date.now()&&members(this.env).has(user.email);}
  async fetch(request) {
    let user;try{user=JSON.parse(request.headers.get('x-thunder-identity'));}catch{return error('Unauthorized',401);}
    if(!this.valid(user))return error('Unauthorized',401);
    if(!this.encrypted){
      if(user.email!==this.env.OWNER_EMAIL?.toLowerCase())return error('Owner-only archive',403);
      const url=new URL(request.url);
      if(request.method!=='GET'||!url.pathname.startsWith('/api/legacy/'))return error('Archive is read-only',405);
      const after=Number(url.searchParams.get('after')||0);
      if(!Number.isSafeInteger(after)||after<0)return error('Invalid cursor',400);
      const table=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").toArray();
      const rows=table.length?this.ctx.storage.sql.exec('SELECT rowid AS cursor,id,user,role,content FROM messages WHERE rowid > ? ORDER BY rowid LIMIT 51',after).toArray():[];
      return Response.json({messages:rows.slice(0,50),hasMore:rows.length>50,readOnly:true});
    }
    if(new URL(request.url).pathname==='/api/recovery')return this.recovery(request,user);
    if(this.ctx.getWebSockets().length>=50)return error('Room connection limit',429);
    const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment(user);
    send(pair[1],{type:'hello',keyId:this.keyId(),room:ROOM});
    return new Response(null,{status:101,webSocket:pair[0]});
  }
  broadcast(event) {for(const ws of this.ctx.getWebSockets()){if(this.valid(ws.deserializeAttachment()))send(ws,event);else ws.close(1008,'Sign in again');}}
  async recovery(request,user) {
    if(user.email!==this.env.OWNER_EMAIL?.toLowerCase())return error('Owner only',403);
    const limit=8*1024*1024;
    if(request.method==='GET') {
      const totals=this.ctx.storage.sql.exec('SELECT COUNT(*) AS count,COALESCE(SUM(length(envelope)),0) AS bytes FROM encrypted_messages_v1').one();
      if(totals.count>1000||totals.bytes>limit-65536)return error('This history needs a larger migration. Nothing was changed.',413);
      const rows=this.ctx.storage.sql.exec('SELECT * FROM encrypted_messages_v1 ORDER BY seq LIMIT 1001').toArray();
      if(rows.length>1000)return error('This history needs a larger migration. Nothing was changed.',413);
      const data=JSON.stringify({keyId:this.keyId(),messages:rows.map(r=>({...JSON.parse(r.envelope),seq:r.seq}))});
      if(new TextEncoder().encode(data).length>limit)return error('This history needs a larger migration. Nothing was changed.',413);
      return new Response(data,{headers:{'Content-Type':'application/json'}});
    }
    if(request.method!=='POST')return error('Method not allowed',405);
    let event;
    try {
      const reader=request.body?.getReader();if(!reader)return error('Missing replacement',400);
      const chunks=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();return error('Replacement too large. Nothing was changed.',413);}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
      event=JSON.parse(new TextDecoder().decode(bytes));
    }catch{return error('Invalid replacement',400);}
    if(typeof event.keyId!=='string'||event.keyId.length!==43||!B64.test(event.keyId)||event.keyId===event.previousKeyId||!Array.isArray(event.messages)||event.messages.length>1000)return error('Invalid replacement',400);
    // No await between checking the snapshot and committing: sends cannot interleave.
    if(!this.valid(user))return error('Sign in again',401);
    if(!this.keyId()||event.previousKeyId!==this.keyId())return error('Room key changed. Reload before trying again.',409);
    const rows=this.ctx.storage.sql.exec('SELECT * FROM encrypted_messages_v1 ORDER BY seq LIMIT 1001').toArray();
    if(rows.length!==event.messages.length)return error('New messages arrived. Try again; nothing was changed.',409);
    for(let i=0;i<rows.length;i++){
      const original=JSON.parse(rows[i].envelope),m=event.messages[i];
      if(!m||m.v!==1||m.room!==ROOM||m.id!==original.id||m.sender!==original.sender||m.proofHash!==original.proofHash||m.keyId!==event.keyId||Object.keys(m).sort().join(',')!=='ciphertext,id,iv,keyId,proofHash,room,sender,v'||typeof m.iv!=='string'||m.iv.length!==16||!B64.test(m.iv)||typeof m.ciphertext!=='string'||m.ciphertext.length<22||m.ciphertext.length>33000||!B64.test(m.ciphertext))return error('Replacement does not match stored history',400);
    }
    this.ctx.storage.transactionSync(()=>{
      for(const m of event.messages)this.ctx.storage.sql.exec('UPDATE encrypted_messages_v1 SET envelope=? WHERE id=?',JSON.stringify(m),m.id);
      this.ctx.storage.sql.exec('UPDATE room_config_v1 SET key_id=? WHERE id=1',event.keyId);
    });
    await this.ctx.storage.sync();
    this.broadcast({type:'hello',keyId:this.keyId(),room:ROOM});
    return Response.json({keyId:this.keyId(),updated:rows.length});
  }
  rate(user) {
    const window=Math.floor(Date.now()/60000);const row=this.ctx.storage.sql.exec('SELECT window,count FROM rate_v1 WHERE sender=?',user.email).toArray()[0];
    const count=row?.window===window?row.count+1:1;
    if(count>180)throw Error('Too many requests. Wait a minute.');
    this.ctx.storage.sql.exec('INSERT INTO rate_v1 VALUES (?,?,?) ON CONFLICT(sender) DO UPDATE SET window=excluded.window,count=excluded.count',user.email,window,count);
  }
  record(row) {return {...JSON.parse(row.envelope),seq:row.seq,storedAt:row.stored_at,deliveries:this.ctx.storage.sql.exec('SELECT recipient,delivered_at AS deliveredAt FROM delivery_v1 WHERE message_id=?',row.id).toArray()};}
  async webSocketMessage(ws,raw) {
    if(!this.encrypted){ws.close(1008,'Legacy archive is read-only. Reload your room link.');return;}
    let event;try {
      const user=ws.deserializeAttachment();if(!this.valid(user)){ws.close(1008,'Sign in again');return;}
      if(typeof raw!=='string'||new TextEncoder().encode(raw).length>36000)throw Error('Message is too large.');
      event=JSON.parse(raw);this.rate(user);
      if(event.type==='configure') {
        if(user.email!==this.env.OWNER_EMAIL?.toLowerCase())throw Error('Only the room owner can initialize encryption.');
        if(typeof event.keyId!=='string'||event.keyId.length!==43||!B64.test(event.keyId))throw Error('Invalid key fingerprint');
        const current=this.keyId();if(current&&current!==event.keyId)throw Error('Room already has a key. Restore the original recovery key.');
        this.ctx.storage.sql.exec('INSERT OR IGNORE INTO room_config_v1 VALUES (1,?)',event.keyId);
        await this.ctx.storage.sync();this.broadcast({type:'hello',keyId:this.keyId(),room:ROOM});return;
      }
      if(event.type==='history') {
        const before=event.before??Number.MAX_SAFE_INTEGER;
        if(!Number.isSafeInteger(before)||before<1)throw Error('Invalid history cursor');
        const rows=this.ctx.storage.sql.exec('SELECT * FROM encrypted_messages_v1 WHERE seq < ? ORDER BY seq DESC LIMIT 51',before).toArray();
        send(ws,{type:'history',messages:rows.slice(0,50).reverse().map(r=>this.record(r)),hasMore:rows.length>50});return;
      }
      if(event.type==='send') {
        const m=event.message;
        if(!m||m.v!==1||m.room!==ROOM||!UUID.test(m.id)||m.sender!==user.email||m.keyId!==this.keyId())throw Error('Message identity or room key does not match.');
        if(typeof m.iv!=='string'||m.iv.length!==16||!B64.test(m.iv)||typeof m.ciphertext!=='string'||m.ciphertext.length<22||m.ciphertext.length>33000||!B64.test(m.ciphertext)||typeof m.proofHash!=='string'||m.proofHash.length!==43||!B64.test(m.proofHash))throw Error('Invalid encrypted message');
        if(Object.keys(m).sort().join(',')!=='ciphertext,id,iv,keyId,proofHash,room,sender,v')throw Error('Unexpected message fields');
        const envelope=JSON.stringify(m);
        let row=this.ctx.storage.sql.exec('SELECT * FROM encrypted_messages_v1 WHERE id=?',m.id).toArray()[0];
        if(row){if(row.envelope!==envelope)throw Error('Message ID already used');send(ws,{type:'stored',message:this.record(row)});return;}
        this.ctx.storage.sql.exec('INSERT INTO encrypted_messages_v1(id,sender,envelope,stored_at) VALUES (?,?,?,?)',m.id,user.email,envelope,Date.now());
        await this.ctx.storage.sync();
        row=this.ctx.storage.sql.exec('SELECT * FROM encrypted_messages_v1 WHERE id=?',m.id).one();
        send(ws,{type:'stored',message:this.record(row)});this.broadcast({type:'message',message:this.record(row)});return;
      }
      if(event.type==='received') {
        if(!UUID.test(event.id)||typeof event.proof!=='string'||event.proof.length!==43||!B64.test(event.proof))throw Error('Invalid delivery receipt');
        const row=this.ctx.storage.sql.exec('SELECT * FROM encrypted_messages_v1 WHERE id=?',event.id).toArray()[0];
        if(!row||row.sender===user.email)throw Error('Receipt requires a different recipient.');
        const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(event.proof));
        const proofHash=btoa(String.fromCharCode(...new Uint8Array(hash))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
        if(proofHash!==JSON.parse(row.envelope).proofHash)throw Error('Receipt does not prove decryption.');
        this.ctx.storage.sql.exec('INSERT OR IGNORE INTO delivery_v1 VALUES (?,?,?)',event.id,user.email,Date.now());
        await this.ctx.storage.sync();
        this.broadcast({type:'receipt',id:event.id,deliveries:this.record(row).deliveries});return;
      }
      throw Error('Unsupported event');
    }catch(e){send(ws,{type:'error',id:typeof event?.message?.id==='string'?event.message.id:undefined,message:e instanceof Error?e.message:'Request failed'});}
  }
  webSocketClose(ws,code,reason){try{ws.close(code,reason);}catch{}}
  webSocketError(ws){try{ws.close(1011,'Reconnect');}catch{}}
}
