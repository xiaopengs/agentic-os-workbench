/**
 * IconSprite · 内联 SVG symbol 集合
 * 迁移自 workbench.html 的 <svg style="display:none"> 块（40 个 symbol，viewBox / path 1:1）
 * 以 React 组件形式在 root layout 渲染一次，页面内通过 <Icon name="i-xxx" /> 引用。
 */
export function IconSprite() {
  return (
    <svg style={{ display: 'none' }} xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <symbol id="i-logo" viewBox="0 0 24 24">
        <path d="M12 3 21 19H3z" fill="url(#lg1)" />
        <path d="M12 9.5 16.8 19H7.2z" fill="#fff" opacity=".92" />
        <defs>
          <linearGradient id="lg1" x1="0" y1="0" x2="24" y2="24">
            <stop offset="0" stopColor="#34d399" />
            <stop offset="1" stopColor="#059669" />
          </linearGradient>
        </defs>
      </symbol>
      <symbol id="i-doc" viewBox="0 0 24 24">
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v4h4" />
        <path d="M10 12h6M10 16h6" />
      </symbol>
      <symbol id="i-cube" viewBox="0 0 24 24">
        <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" />
        <path d="M3.5 7 12 11.5 20.5 7M12 11.5V21.5" />
      </symbol>
      <symbol id="i-play" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9.2" />
        <path d="M10 8.6l5.4 3.4L10 15.4z" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-device" viewBox="0 0 24 24">
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <path d="M11 18.5h2" />
      </symbol>
      <symbol id="i-bulb" viewBox="0 0 24 24">
        <path d="M9.5 18h5M10 21h4" />
        <path d="M12 3a6.2 6.2 0 0 1 3.6 11.2c-.8.6-1.1 1.2-1.1 2v.8h-5v-.8c0-.8-.3-1.4-1.1-2A6.2 6.2 0 0 1 12 3z" />
      </symbol>
      <symbol id="i-bot" viewBox="0 0 24 24">
        <rect x="4" y="7.5" width="16" height="12" rx="3.5" />
        <path d="M12 7.5V4.5M12 4.5a1.4 1.4 0 1 0-.01-2.8 1.4 1.4 0 0 0 .01 2.8z" />
        <circle cx="9" cy="13" r="1.15" fill="currentColor" stroke="none" />
        <circle cx="15" cy="13" r="1.15" fill="currentColor" stroke="none" />
        <path d="M9.5 16.5h5" />
      </symbol>
      <symbol id="i-monitor" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="13" rx="2.5" />
        <path d="M9 21h6M12 17v4" />
      </symbol>
      <symbol id="i-shield" viewBox="0 0 24 24">
        <path d="M12 2.8 20 6v6.2c0 4.6-3.2 7.6-8 9-4.8-1.4-8-4.4-8-9V6z" />
        <path d="M8.8 12l2.3 2.3 4.1-4.4" />
      </symbol>
      <symbol id="i-list" viewBox="0 0 24 24">
        <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
        <path d="M8 9h8M8 13h8M8 17h5" />
      </symbol>
      <symbol id="i-phone" viewBox="0 0 24 24">
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <path d="M11 18.5h2" />
      </symbol>
      <symbol id="i-wave" viewBox="0 0 24 24">
        <path d="M3 12h3l2.4-6 3.2 12 2.8-9 1.8 3H21" />
      </symbol>
      <symbol id="i-plane" viewBox="0 0 24 24">
        <path d="M21 3 3 10.5l6.2 2.6L11 19.5z" />
        <path d="M21 3 9.2 13.1" />
      </symbol>
      <symbol id="i-book" viewBox="0 0 24 24">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z" />
        <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M20 20l-4.2-4.2" />
      </symbol>
      <symbol id="i-bell" viewBox="0 0 24 24">
        <path d="M18 9.5a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15.5 18 9.5" />
        <path d="M10 20a2.2 2.2 0 0 0 4 0" />
      </symbol>
      <symbol id="i-target" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4.5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-chev-d" viewBox="0 0 24 24">
        <path d="M6.5 9.5 12 15l5.5-5.5" />
      </symbol>
      <symbol id="i-chev-r" viewBox="0 0 24 24">
        <path d="M9.5 6.5 15 12l-5.5 5.5" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </symbol>
      <symbol id="i-warn" viewBox="0 0 24 24">
        <path d="M12 3.5 22 20H2z" />
        <path d="M12 10v4.5" />
        <circle cx="12" cy="17.2" r=".9" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-sun" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" />
      </symbol>
      <symbol id="i-bolt" viewBox="0 0 24 24">
        <path d="M13 2.5 4.5 13.5H11L9.8 21.5 19 10h-6.5z" />
      </symbol>
      <symbol id="i-folder" viewBox="0 0 24 24">
        <path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      </symbol>
      <symbol id="i-calendar" viewBox="0 0 24 24">
        <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
        <path d="M3.5 10h17M8 2.8V7M16 2.8V7" />
      </symbol>
      <symbol id="i-takeout" viewBox="0 0 24 24">
        <path d="M5 8h14l-1.2 12.2a1.8 1.8 0 0 1-1.8 1.6H8a1.8 1.8 0 0 1-1.8-1.6z" />
        <path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" />
      </symbol>
      <symbol id="i-water" viewBox="0 0 24 24">
        <path d="M12 3S5.8 10 5.8 14.4a6.2 6.2 0 0 0 12.4 0C18.2 10 12 3 12 3z" />
      </symbol>
      <symbol id="i-chip" viewBox="0 0 24 24">
        <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
        <rect x="10" y="10" width="4" height="4" />
        <path d="M9 3.5v3M15 3.5v3M9 17.5v3M15 17.5v3M3.5 9h3M3.5 15h3M17.5 9h3M17.5 15h3" />
      </symbol>
      <symbol id="i-zap" viewBox="0 0 24 24">
        <path d="M13 2.5 4.5 13.5H11L9.8 21.5 19 10h-6.5z" />
      </symbol>
      <symbol id="i-battery" viewBox="0 0 24 24">
        <rect x="2.5" y="8" width="17" height="8.5" rx="2" />
        <path d="M21.8 11v2.5" />
        <path d="M6 11v2.5M9.5 11v2.5" />
      </symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24">
        <path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" />
        <path d="M20 4.5V11h-6.5M4 19.5V13h6.5" />
      </symbol>
      <symbol id="i-dots" viewBox="0 0 24 24">
        <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-send" viewBox="0 0 24 24">
        <path d="M21 3 3 10.5l6.2 2.6L11 19.5z" />
        <path d="M21 3 9.2 13.1" />
      </symbol>
      <symbol id="i-wrench" viewBox="0 0 24 24">
        <path d="M14.5 6.5a4.5 4.5 0 0 0-6 5.6L3 17.6 6.4 21l5.5-5.5a4.5 4.5 0 0 0 5.6-6L14 13l-3-3z" />
      </symbol>
      <symbol id="i-x" viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6 6 18" />
      </symbol>
      <symbol id="i-arrow-r" viewBox="0 0 24 24">
        <path d="M4 12h15M13.5 6.5 19 12l-5.5 5.5" />
      </symbol>
      <symbol id="i-spark" viewBox="0 0 24 24">
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
        <path d="M18.5 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" />
      </symbol>
      <symbol id="i-trend-up" viewBox="0 0 24 24">
        <path d="M4 17l5.5-5.5 3.5 3.5L20 8" />
        <path d="M14.5 8H20v5.5" />
      </symbol>
      <symbol id="i-menu" viewBox="0 0 24 24">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </symbol>
      <symbol id="i-grid" viewBox="0 0 24 24">
        <rect x="4" y="4" width="7" height="7" rx="1.8" />
        <rect x="13" y="4" width="7" height="7" rx="1.8" />
        <rect x="4" y="13" width="7" height="7" rx="1.8" />
        <rect x="13" y="13" width="7" height="7" rx="1.8" />
      </symbol>
    </svg>
  );
}

export default IconSprite;