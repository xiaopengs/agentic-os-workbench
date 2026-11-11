import { redirect } from 'next/navigation';

/**
 * 合同模块已从当前基线下线（导航移除，路由不可达）。
 * 源码完整保留在同目录 page.tsx.bak，恢复时改回文件名即可。
 */
export default function Page() {
  redirect('/');
}
