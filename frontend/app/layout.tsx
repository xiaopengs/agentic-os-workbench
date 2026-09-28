import type { Metadata, Viewport } from 'next';
import './globals.css';
import { IconSprite } from '@/components/icons/IconSprite';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Agentic OS · Automation Workbench',
  description: 'Agentic OS 自动化开发工作台 · 从意图到发布的全链路 Agent 开发与验证',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <IconSprite />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
