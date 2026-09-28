import type { CSSProperties } from 'react';

export type IconName =
  | 'i-logo' | 'i-doc' | 'i-cube' | 'i-play' | 'i-device' | 'i-bulb' | 'i-bot'
  | 'i-monitor' | 'i-shield' | 'i-list' | 'i-phone' | 'i-wave' | 'i-plane'
  | 'i-book' | 'i-search' | 'i-bell' | 'i-target' | 'i-chev-d' | 'i-chev-r'
  | 'i-check' | 'i-warn' | 'i-sun' | 'i-bolt' | 'i-folder' | 'i-calendar'
  | 'i-takeout' | 'i-water' | 'i-chip' | 'i-zap' | 'i-battery' | 'i-refresh'
  | 'i-dots' | 'i-send' | 'i-wrench' | 'i-x' | 'i-arrow-r' | 'i-spark'
  | 'i-trend-up' | 'i-menu' | 'i-grid';

interface IconProps {
  name: IconName;
  /** 字号即图标尺寸（.ic 为 1em） */
  size?: number | string;
  className?: string;
  style?: CSSProperties;
  filled?: boolean;
  title?: string;
}

export function Icon({ name, size, className, style, filled, title }: IconProps) {
  return (
    <svg
      className={`ic${filled ? ' fill' : ''}${className ? ' ' + className : ''}`}
      style={size !== undefined ? { fontSize: size, ...style } : style}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <use href={`#${name}`} />
    </svg>
  );
}

export default Icon;