import { build } from 'esbuild';
await build({entryPoints:['src/client.jsx'],outfile:'public/app.js',bundle:true,format:'esm',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
await build({entryPoints:['src/worker.js'],outfile:'dist/worker.js',bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers']});
