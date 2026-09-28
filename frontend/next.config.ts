import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ⚠️ 必须：沙箱内通过 http://127.0.0.1:<port> 预览，纯 host、不带协议与端口，
  // 否则 Next 16 的 HMR WebSocket 会被判定为跨源，导致 hydration 失败、页面交互全部失效。
  allowedDevOrigins: ['127.0.0.1'],

  // 单端口自包含部署：产出 .next/standalone（含裁剪后的最小 node_modules），
  // 供 scripts/build-app.mjs 组装成可独立运行的 app-dist/ 部署单元。
  // 不影响 next dev。
  output: 'standalone',

  reactStrictMode: true,
  poweredByHeader: false,

  // 后端与前端同域（/api/*）。开发态由 server.mjs 或独立后端进程提供，
  // 这里不做 rewrite，避免遮蔽真实 API。
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;