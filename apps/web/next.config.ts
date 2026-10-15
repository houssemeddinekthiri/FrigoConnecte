import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone', // image Docker légère (Phase 13)
  outputFileTracingRoot: path.join(__dirname, '../../'), // monorepo : inclut packages/contracts
  poweredByHeader: false,
};
export default config;
