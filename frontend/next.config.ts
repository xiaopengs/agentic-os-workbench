import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ⚠️ 必须：沙箱内通过 http://127.0.0.1:<port> 预览，纯 host、不带协议与端口，
  // 否则 Next 16 的 HMR WebSocket 会被判定为跨源，导致 hydration 失败、页面交互全部失效。
  allowedDevOrigins: ['127.0.0.1'],
  reactStrictMode: true,
  poweredByHeader: false,
  // 后端是独立 Cloud Functions（同域 /api/*），前端不做任何 rewrite，避免遮蔽真实 API
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