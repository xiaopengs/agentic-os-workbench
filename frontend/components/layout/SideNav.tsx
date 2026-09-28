'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/icons/Icon';
import { NAV_ITEMS, navKeyByPath } from '@/lib/nav';

/** 侧栏 · 结构、间距、激活态、底部品牌卡均与原型 1:1 */
export function SideNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const active = navKeyByPath(pathname);

  return (
    <nav className={`sidenav${open ? ' open' : ''}`} aria-label="主导航">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={active === item.key ? 'active' : ''}
          onClick={onClose}
          aria-current={active === item.key ? 'page' : undefined}
        >
          <Icon name={item.icon} />
          {item.label}
        </Link>
      ))}

      <div className="side-brand">
        <svg className="art" viewBox="0 0 80 80" aria-hidden="true">
          <ellipse cx="40" cy="64" rx="24" ry="5" fill="#0ea371" opacity=".14" />
          <path
            d="M40 14 62 27v26L40 66 18 53V27z"
            fill="#fff"
            stroke="#0ea371"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M18 27l22 13 22-13M40 40v26"
            stroke="#0ea371"
            strokeWidth="2.4"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="64" cy="18" r="4" fill="#34d399" opacity=".7" />
          <circle cx="14" cy="22" r="2.6" fill="#8b5cf6" opacity=".55" />
          <circle cx="68" cy="44" r="2.2" fill="#3b82f6" opacity=".5" />
        </svg>
        <b>Agentic OS</b>
        <span>让 AI 代理真正落地</span>
        <div className="dots">
          <i className="on" />
          <i />
          <i />
        </div>
      </div>
    </nav>
  );
}

export default SideNav;