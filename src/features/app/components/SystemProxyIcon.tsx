type SystemProxyIconProps = {
  size?: number;
  className?: string;
};

/**
 * 直立梯子 icon（网络代理入口）。lucide 无纯梯子图标（waves-ladder 14px 下
 * 浑浊不可读），按 lucide 24×24 / stroke-2 / round 规范手绘替代。
 */
export function SystemProxyIcon({
  size = 14,
  className,
}: SystemProxyIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <path d="M7 3v18" />
      <path d="M17 3v18" />
      <path d="M7 8h10" />
      <path d="M7 12h10" />
      <path d="M7 16h10" />
    </svg>
  );
}
