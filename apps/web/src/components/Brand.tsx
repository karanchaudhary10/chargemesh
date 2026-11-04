import { useId } from "react";

/**
 * The ChargeMesh mark: a charge bolt inside a mesh cell.
 * Inline SVG so it stays crisp at any size and needs no network request.
 */
export function ChargeMeshLogo({
  size = 36,
  className = ""
}: {
  size?: number;
  className?: string;
}) {
  const gradientId = useId().replace(/:/g, "");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="ChargeMesh"
    >
      <defs>
        <linearGradient id={gradientId} x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${gradientId})`} />
      <path
        d="M11.6 13.9 20 9.2l8.4 4.7v9.4L20 28l-8.4-4.7v-9.4Z"
        stroke="#BFDBFE"
        strokeOpacity="0.5"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M20 9.2v-4M11.6 13.9l-3.7-2.1M28.4 13.9l3.7-2.1" stroke="#BFDBFE" strokeOpacity="0.3" strokeWidth="1.1" strokeLinecap="round" />
      <path
        d="M22.4 11.6 14.2 21.4h5.6l-2.2 6.8 8.2-9.8h-5.6l2.2-6.8Z"
        fill="white"
        stroke="white"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Logo plus wordmark, used in the top navigation bars. */
export function ChargeMeshBrand({
  subtitle,
  size = 36,
  onClick,
  className = ""
}: {
  subtitle: string;
  size?: number;
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      <ChargeMeshLogo size={size} className="shrink-0 shadow-xs" />
      <span className="flex flex-col text-left min-w-0">
        <span className="text-xl font-bold tracking-tight text-slate-900 group-hover:text-blue-600 transition-colors">
          ChargeMesh
        </span>
        <span className="text-xs text-slate-500 font-medium -mt-0.5 truncate">{subtitle}</span>
      </span>
    </>
  );

  const shared = `flex items-center gap-2.5 select-none group ${className}`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={shared}>
        {content}
      </button>
    );
  }

  return <div className={shared}>{content}</div>;
}
