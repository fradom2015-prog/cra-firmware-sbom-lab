import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    // I test condividono un database: eseguiti in sequenza, ognuno svuota le tabelle.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
