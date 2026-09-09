# Thunder SMS

Invite-only private chat on Cloudflare Workers and a SQLite Durable Object.

The production entry point is `src/worker.js`; `src/client.jsx` is the browser client. Older template sources remain for historical reference and are not built.

## Development and verification

Use Node.js 22 or newer. Run `npm ci`, then `npm test`. Tests cover encryption, authentication, ciphertext persistence, delivery proof, retries, pagination and read-only legacy archives. `node test/preview.mjs` starts a localhost-only synthetic identity preview; never deploy that preview gateway.

## Deployment

`npm run deploy` runs verification and deploys the existing `thunder-sms` Worker using `wrangler.json`. Cloudflare Builds runs this command for main. The existing Chat binding and v1 migration are retained. Do not change the room identifier or migration to reset a room.

Private configuration is maintained in Cloudflare: ACCESS_TEAM, ACCESS_AUD, OWNER_EMAIL and MEMBER_EMAILS. `keep_vars: true` preserves these settings; no member addresses or provider secrets belong in this public repository. Access policy membership must match Worker membership.

## Encryption and recovery

Messages are encrypted in the browser with AES-GCM before upload. A shared recovery secret derives a nonextractable browser key saved in IndexedDB. Save the recovery secret in a password manager before starting. New devices require that secret; device approval and recovery-key rotation are not implemented. Losing both the secret and unlocked devices makes old encrypted history unrecoverable. Sign-in does not recover encryption keys.

The server retains sender and delivery metadata. Delivery indicates a recipient client supplied proof after decrypting; it does not establish that a person read the message. This shared-key design does not provide forward secrecy or per-device signatures. Legacy prototype rooms are owner-only read-only archives and retain their original plaintext storage.
