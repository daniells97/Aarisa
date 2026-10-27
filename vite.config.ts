import 'dotenv/config'; // local dev only; production gets env from Infisical
import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { nitro } from 'nitro/vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 3100 },
  plugins: [tsconfigPaths(), tanstackStart(), nitro(), viteReact()],
});
