// Browser-only message encryption. Never import this module into the Worker.
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', {fatal:true});
export const ROOM = 'private-e2ee-v2';
export function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
export function unb64(s) {
  if(typeof s!=='string'||!/^[A-Za-z0-9_-]+$/.test(s)) throw Error('Invalid key or ciphertext');
  return Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
}
export async function digest(value) { return b64(await crypto.subtle.digest('SHA-256', typeof value==='string'?enc.encode(value):value)); }
export function createRecoveryKey() { return 'thunder1.'+b64(crypto.getRandomValues(new Uint8Array(32))); }
export async function importRecoveryKey(recovery) {
  if(!/^thunder1\.[A-Za-z0-9_-]{43}$/.test(recovery.trim())) throw Error('Enter the complete Thunder recovery key.');
  const raw=unb64(recovery.trim().slice(9));
  if(raw.length!==32) throw Error('Invalid recovery key');
  const base=await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode(ROOM),info:enc.encode('thunder/message/aes-gcm/v1')},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const keyId=await digest(raw); raw.fill(0);
  return {key,keyId};
}
function aad(m) {return enc.encode(JSON.stringify(['thunder',1,ROOM,m.id,m.sender,m.keyId,m.proofHash]));}
export async function encryptMessage(keys,sender,text) {
  if(!text.trim()||enc.encode(text).length>4000) throw Error('Use 1–4,000 bytes of text.');
  const proof=b64(crypto.getRandomValues(new Uint8Array(32)));
  const m={v:1,room:ROOM,id:crypto.randomUUID(),sender,keyId:keys.keyId,proofHash:await digest(proof)};
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(m),tagLength:128},keys.key,enc.encode(JSON.stringify({text,proof})));
  return {...m,iv:b64(iv),ciphertext:b64(ciphertext)};
}
export async function decryptMessage(keys,m) {
  if(m.v!==1||m.room!==ROOM||m.keyId!==keys.keyId) throw Error('This message needs a different recovery key.');
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(m.iv),additionalData:aad(m),tagLength:128},keys.key,unb64(m.ciphertext));
  const p=JSON.parse(dec.decode(plaintext));
  if(typeof p.text!=='string'||typeof p.proof!=='string'||await digest(p.proof)!==m.proofHash) throw Error('Message authentication failed');
  return p;
}
export async function reencryptMessage(oldKeys,newKeys,message) {
  const payload=await decryptMessage(oldKeys,message);
  const {v,room,id,sender,proofHash}=message;
  const m={v,room,id,sender,keyId:newKeys.keyId,proofHash};
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(m),tagLength:128},newKeys.key,enc.encode(JSON.stringify(payload)));
  const next={...m,iv:b64(iv),ciphertext:b64(ciphertext)};
  // Verify every replacement before sending it to storage.
  await decryptMessage(newKeys,next);
  return next;
}
