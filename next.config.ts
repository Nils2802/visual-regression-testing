import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['playwright', 'sharp', 'pixelmatch', 'pngjs', '@prisma/client'],
};

export default nextConfig;
