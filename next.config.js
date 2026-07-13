/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // 빌드 시 ESLint 검사 수행 (에러가 있으면 빌드 실패)
    ignoreDuringBuilds: false,
  },
  typescript: {
    // 빌드 시 타입 검사 수행 (에러가 있으면 빌드 실패).
    // 이 스위치가 켜져 있던 동안 존재하지 않는 컬럼을 읽는 버그
    // (good_qty, machines.default_tact_time 등)가 프로덕션까지 도달했다.
    ignoreBuildErrors: false,
  },
  // React compiler and optimizations
  compiler: {
    // Suppress specific warnings
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error']
    } : false,
  },
  experimental: {
    // Improve hot reload performance
    optimizeCss: false,
    // Tree-shake barrel re-exports (src/components/*/index.ts) so importing
    // one named export from a barrel doesn't pull in every module the
    // barrel re-exports (this is how jsPDF/xlsx/html2canvas previously
    // leaked into the /dashboard and /analytics bundles via the oee and
    // reports barrels). Extend this list when new component barrels are
    // added.
    optimizePackageImports: [
      '@/components/oee',
      '@/components/reports',
      '@/components/dashboard',
      '@/components/machines',
      '@/components/quality',
      '@/components/production',
      '@/components/admin',
    ],
  },
  // Webpack configuration
  webpack: (config, { dev }) => {
    // Better cache configuration
    if (dev) {
      config.cache = {
        type: 'filesystem',
        buildDependencies: {
          config: [__filename],
        },
      };
    }

    // Resolve alias for better imports
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname, 'src'),
    };
    
    return config;
  },
  // Disable prefetching in development
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right',
  },
  // Improve page transitions
  reactStrictMode: false,
  swcMinify: true,
};

module.exports = nextConfig;