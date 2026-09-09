import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryKey,importRecoveryKey,encryptMessage,decryptMessage,digest} from '../src/crypto.js';
test('recovery restores history; keys remain nonextractable',async()=>{
 const recovery=createRecoveryKey(),a=await importRecoveryKey(recovery),b=await importRecoveryKey(recovery);
 const message=await encryptMessage(a,'alice@example.test',"It's private 🔐");
 const decoded=await decryptMessage(b,message);assert.equal(decoded.text,"It's private 🔐");assert.equal(await digest(decoded.proof),message.proofHash);
 assert.equal(a.key.extractable,false);await assert.rejects(crypto.subtle.exportKey('raw',a.key));
 assert.ok(!JSON.stringify(message).includes("It's private 🔐"));assert.ok(!JSON.stringify(message).includes(recovery));
 assert.notEqual(message.iv,(await encryptMessage(a,'alice@example.test','again')).iv);
});
test('wrong keys and altered message metadata or ciphertext fail closed',async()=>{
 const a=await importRecoveryKey(createRecoveryKey()),b=await importRecoveryKey(createRecoveryKey());
 const m=await encryptMessage(a,'alice@example.test','secret');await assert.rejects(decryptMessage(b,m));
 for(const field of ['id','sender','proofHash','iv','ciphertext']){
 const changed={...m,[field]:(m[field][0]==='A'?'B':'A')+m[field].slice(1)};await assert.rejects(decryptMessage(a,changed));
 }
});
test('reject invalid recovery and oversized or blank plaintext',async()=>{
 await assert.rejects(importRecoveryKey('password'));const a=await importRecoveryKey(createRecoveryKey());
 await assert.rejects(encryptMessage(a,'alice@example.test',' '));await assert.rejects(encryptMessage(a,'alice@example.test','🔐'.repeat(1001)));
});
