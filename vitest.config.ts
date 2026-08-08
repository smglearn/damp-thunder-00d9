import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      'cloudflare:workers': resolve(__dirname, './__mocks__/cloudflare.ts'),
      'partyserver': resolve(__dirname, './__mocks__/partyserver.ts'),
    }
  }
});
