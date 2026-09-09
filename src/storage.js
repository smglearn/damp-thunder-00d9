// IndexedDB persists non-extractable CryptoKeys and encrypted pending messages only.
function open() {return new Promise((resolve,reject)=>{const r=indexedDB.open('thunder-e2ee-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('vault');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function vault(action,key,value) {
  const db=await open();
  return new Promise((resolve,reject)=>{const tx=db.transaction('vault',action==='get'?'readonly':'readwrite');const s=tx.objectStore('vault');const r=action==='get'?s.get(key):action==='put'?s.put(value,key):s.delete(key);tx.oncomplete=()=>{db.close();resolve(r.result);};tx.onerror=()=>{db.close();reject(tx.error);};});
}
