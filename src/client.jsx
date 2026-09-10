import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ROOM,createRecoveryKey,importRecoveryKey,encryptMessage,decryptMessage,reencryptMessage} from './crypto.js';
import {vault} from './storage.js';

function App(){
  const [me,setMe]=useState(null),[keys,setKeys]=useState(null),[remoteKey,setRemoteKey]=useState(undefined);
  const [online,setOnline]=useState(false),[problem,setProblem]=useState(''),[recovery,setRecovery]=useState(''),[generated,setGenerated]=useState(''),[saved,setSaved]=useState(false);
  const [items,setItems]=useState([]),[draft,setDraft]=useState(''),[more,setMore]=useState(false),[busy,setBusy]=useState(false),[pending,setPending]=useState([]);
  const [replacement,setReplacement]=useState(''),[replacementSaved,setReplacementSaved]=useState(false);
  const socket=useRef(null),keyRef=useRef(null),meRef=useRef(null),queue=useRef([]),serial=useRef(Promise.resolve()),cache=useRef(new Map()),acknowledged=useRef(new Set());
  const prefix=()=>`room:${ROOM}:user:${meRef.current.email}:`;
  const emit=e=>{if(socket.current?.readyState===WebSocket.OPEN){socket.current.send(JSON.stringify(e));return true;}return false;};
  async function saveQueue(next){await vault('put',prefix()+'outbox',next);queue.current=next;setPending(next);}
  async function consume(m){
    let text=cache.current.get(m.id);
    if(!text){try{const p=await decryptMessage(keyRef.current,m);text=p.text;cache.current.set(m.id,text);
      if(m.sender!==meRef.current.email&&!acknowledged.current.has(m.id)&&!m.deliveries?.some(d=>d.recipient===meRef.current.email)){
        if(emit({type:'received',id:m.id,proof:p.proof}))acknowledged.current.add(m.id);
      }
    }catch{text='Unable to decrypt. Check your recovery key.';}}
    setItems(old=>{const existing=old.find(x=>x.id===m.id);const next={...m,text,deliveries:m.deliveries?.length?m.deliveries:existing?.deliveries||[]};return [...old.filter(x=>x.id!==m.id),next].sort((a,b)=>a.seq-b.seq);});
    if(queue.current.some(x=>x.id===m.id))await saveQueue(queue.current.filter(x=>x.id!==m.id));
  }
  async function onEvent(e){
    if(e.type==='hello'){
      setRemoteKey(e.keyId);
      const staged=await vault('get',prefix()+'replacement');
      if(staged?.keyId===e.keyId&&keyRef.current?.keyId!==e.keyId){
        await vault('put',prefix()+'keys',staged);keyRef.current=staged;setKeys(staged);
        cache.current.clear();setItems([]);setReplacement('');setReplacementSaved(false);emit({type:'history'});
      }
      return;
    }
    if(e.type==='error'){setProblem(e.message);return;}
    if(e.type==='receipt'){setItems(old=>old.map(m=>m.id===e.id?{...m,deliveries:e.deliveries}:m));return;}
    if(!keyRef.current)return;
    if(e.type==='history'){setMore(e.hasMore);for(const m of e.messages)await consume(m);}
    if(e.type==='stored'||e.type==='message')await consume(e.message);
  }
  useEffect(()=>{
    let stopped=false,retry;
    async function start(){try{
      const r=await fetch('/api/me',{cache:'no-store'});if(!r.ok)throw Error('Sign in with your invited account, then reload this page.');
      const user=await r.json();meRef.current=user;setMe(user);
      const stored=await vault('get',prefix()+'keys');if(stored){keyRef.current=stored;setKeys(stored);}
      queue.current=await vault('get',prefix()+'outbox')||[];setPending(queue.current);
      connect();
    }catch(e){setProblem(e.message);}}
    function connect(){if(stopped)return;const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/chat`);socket.current=ws;
      ws.onopen=()=>{setOnline(true);acknowledged.current.clear();cache.current.clear();emit({type:'history'});for(const m of queue.current)emit({type:'send',message:m});};
      ws.onmessage=e=>{serial.current=serial.current.then(()=>onEvent(JSON.parse(e.data))).catch(e=>setProblem(e.message));};
      ws.onclose=e=>{setOnline(false);if(e.code===1008){setProblem('Your session expired or access changed. Reload to sign in.');return;}retry=setTimeout(connect,3000);};
      ws.onerror=()=>setOnline(false);
    }
    start();return()=>{stopped=true;clearTimeout(retry);socket.current?.close();};
  },[]);
  async function unlock(value,create=false){setBusy(true);setProblem('');try{
    const imported=await importRecoveryKey(value);
    if(remoteKey&&remoteKey!==imported.keyId)throw Error('This recovery key does not match the private room.');
    if(remoteKey===undefined)throw Error('Wait for the room connection.');
    if(!remoteKey&&!create)throw Error('The room owner needs to initialize encryption first.');
    if(keyRef.current&&keyRef.current.keyId!==imported.keyId&&queue.current.length){
      const migrated=[];for(const m of queue.current)migrated.push(await reencryptMessage(keyRef.current,imported,m));
      await saveQueue(migrated);
    }
    await vault('put',prefix()+'keys',imported);keyRef.current=imported;setKeys(imported);cache.current.clear();acknowledged.current.clear();
    if(create&&!emit({type:'configure',keyId:imported.keyId}))throw Error('Reconnect before initializing the room.');
    emit({type:'history'});setRecovery('');setGenerated('');setSaved(false);
    for(const m of queue.current)emit({type:'send',message:m});
  }catch(e){setProblem(e.message);}finally{setBusy(false);}}
  async function submit(e){e.preventDefault();setBusy(true);setProblem('');try{
    if(keys?.keyId!==remoteKey)throw Error('Unlock this room first.');
    if(queue.current.length>=50)throw Error('Wait for pending messages to send before adding more.');
    const m=await encryptMessage(keys,me.email,draft);cache.current.set(m.id,draft);
    const queued=serial.current.then(async()=>{await saveQueue([...queue.current,m]);setDraft('');emit({type:'send',message:m});});
    serial.current=queued.catch(()=>{});await queued;
  }catch(e){setProblem(e.message);}finally{setBusy(false);}}
  async function lock(){await serial.current;await vault('delete',prefix()+'keys');await vault('delete',prefix()+'replacement');keyRef.current=null;setKeys(null);setItems([]);cache.current.clear();setRecovery('');setGenerated('');setReplacement('');}
  async function replaceKey(){
    setBusy(true);setProblem('');
    try{
      await serial.current;
      if(!replacementSaved||!online||queue.current.length)throw Error('Save the new key and wait for pending messages to finish.');
      const next=await importRecoveryKey(replacement),old=keyRef.current;
      const r=await fetch('/api/recovery',{cache:'no-store'});if(!r.ok)throw Error(await r.text());
      const snapshot=await r.json();if(snapshot.keyId!==old?.keyId)throw Error('Reload and unlock the current room first.');
      const messages=[];for(const m of snapshot.messages)messages.push(await reencryptMessage(old,next,m));
      // Persist the candidate before commit. A lost response is recovered by hello.
      await vault('put',prefix()+'replacement',next);
      const result=await fetch('/api/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({previousKeyId:old.keyId,keyId:next.keyId,messages})});
      if(!result.ok)throw Error(await result.text());
      await onEvent({type:'hello',keyId:(await result.json()).keyId});
      setProblem('Recovery key replaced. Share the new key directly with your invited members.');
    }catch(e){setProblem(e.message+' If the connection was interrupted, reload before trying again.');}finally{setBusy(false);}
  }
  const unlocked=keys&&keys.keyId===remoteKey;
  return <main><header><div><div className="eyebrow">THUNDER</div><h1>Private chat</h1><p className="muted">One room. People you trust.</p></div><div><span className={online?'online':'offline'}>{online?'Connected':'Reconnecting…'}</span><small>{me&&<p>{me.email}</p>}</small></div></header>
    <p className="notice">Encrypted message content is unlocked on your devices. The service still sees member identities, timing, and delivery information.</p>
    {problem&&<p className="error" role="alert">{problem}</p>}
    {!unlocked&&<section><h2>{remoteKey===null?'Set up the private room':'Unlock your conversation'}</h2><p>Use the recovery key shared by the room owner. Keep it outside this chat; it unlocks the room’s encrypted history.</p>
      <form onSubmit={e=>{e.preventDefault();unlock(recovery);}}><label>Recovery key<input type="password" value={recovery} onChange={e=>setRecovery(e.target.value)} autoComplete="off" spellCheck="false"/></label><button disabled={busy||!online||!remoteKey||!recovery}>Unlock this device</button></form>
      {me?.owner&&remoteKey===null&&<details><summary>Create the room’s first key</summary><p>Generate this once. Save it in your password manager and share it directly with invited members. The server cannot recover it.</p>
        {!generated?<button className="secondary" onClick={()=>{setGenerated(createRecoveryKey());setSaved(false);}}>Generate recovery key</button>:<><code>{generated}</code><label className="check"><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/>I saved this recovery key somewhere safe.</label><button disabled={!saved||busy||!online} onClick={()=>unlock(generated,true)}>Initialize encrypted room</button></>}
      </details>}
      {remoteKey&&<p><small>Room fingerprint: <code>{remoteKey}</code></small></p>}
    </section>}
    {unlocked&&<><div className="row"><p className="online">Encryption unlocked on this device</p><button className="secondary" disabled={busy} onClick={lock}>Lock &amp; forget key</button></div>
      {more&&<button className="secondary" onClick={()=>emit({type:'history',before:Math.min(...items.map(x=>x.seq))})}>Load earlier messages</button>}
      <div className="messages" aria-live="polite">{!items.length&&!pending.length&&<p className="muted">Your encrypted conversation starts here. Previous prototype rooms remain separate.</p>}{items.map(m=><article key={m.id} className={'message '+(m.sender===me.email?'own':'')}><small>{m.sender===me.email?'You':m.sender}</small><p>{m.text}</p>{m.sender===me.email&&<small>{m.deliveries?.length?`Delivered to ${m.deliveries.map(d=>d.recipient).join(', ')}`:'Sent · waiting for a recipient device'}</small>}</article>)}
      {pending.map(m=><article key={m.id} className="message own"><small>You</small><p>{cache.current.get(m.id)||'Encrypted message queued on this device'}</p><small>{online?'Sending…':'Queued · will retry when connected'}</small><button className="secondary" disabled={!online} onClick={()=>emit({type:'send',message:m})}>Retry</button></article>)}</div>
      <form className="composer" onSubmit={submit}><label>Message<textarea value={draft} maxLength={4000} onChange={e=>setDraft(e.target.value)} placeholder="Write a private message…"/></label><button disabled={busy||!draft.trim()}>{online?'Send encrypted message':'Queue encrypted message'}</button><p><small>Sent = encrypted message stored. Delivered = another member’s device decrypted it. Neither means read.</small></p></form>
      <details><summary>Privacy &amp; recovery</summary><p>This version uses a shared room key, not a forward-secure ratcheting protocol. Anyone who has that key can decrypt the room’s history. Removing a member’s login does not erase their key or saved messages. Key rotation is required before using this room after a membership change.</p><p>Keep your recovery key. Losing it and every unlocked device means losing access to encrypted history. This web app also depends on trustworthy code being served to your browser.</p><small>Room fingerprint: <code>{keys.keyId}</code></small></details>
      {me.owner&&<details><summary>Replace recovery key</summary><p>Use this unlocked device to encrypt stored history with a new key. Save it first, then share it directly with invited members. Other devices will need the new key. Messages and delivery confirmations are preserved; copies already saved by others cannot be revoked. Supports up to 1,000 messages and 8 MB; larger histories remain unchanged.</p>
        {!replacement?<button className="secondary" disabled={busy||!online||pending.length>0} onClick={()=>{setReplacement(createRecoveryKey());setReplacementSaved(false);}}>Generate replacement key</button>:<><code>{replacement}</code><label className="check"><input type="checkbox" checked={replacementSaved} onChange={e=>setReplacementSaved(e.target.checked)}/>I saved the new recovery key in my password manager.</label><button disabled={!replacementSaved||busy||!online||pending.length>0} onClick={replaceKey}>Replace key and preserve history</button></>}
      </details>}
    </>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
