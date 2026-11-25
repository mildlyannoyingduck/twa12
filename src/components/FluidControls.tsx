import { memo, ReactNode, TouchEvent, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { haptics } from '../utils/haptics';

interface LiquidSwitchProps {
  checked: boolean;
  onToggle: () => void;
  ariaLabel?: string;
  activeColorClass?: string;
}

/**
 * Pure GPU-Composited Toggle Switch (zero JS spring overhead on Galaxy A07)
 */
export const LiquidSwitch = memo(function LiquidSwitch({
  checked,
  onToggle,
  ariaLabel,
  activeColorClass = 'bg-blue-600 shadow-[0_0_14px_rgba(37,99,235,0.4)] dark:bg-sky-400 dark:shadow-[0_0_16px_rgba(56,189,248,0.45)]',
}: LiquidSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => {
        haptics.tick();
        onToggle();
      }}
      className={`relative flex h-7 w-[52px] shrink-0 items-center rounded-full border p-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 active:scale-95 ${
        checked
          ? `border-white/75 ${activeColorClass}`
          : 'border-white/55 bg-blue-400/18 dark:border-sky-300/25 dark:bg-sky-400/15'
      }`}
    >
      <span
        style={{
          transform: checked ? 'translate3d(22px, 0, 0)' : 'translate3d(0, 0, 0)',
        }}
        className="relative h-5 w-5 rounded-full bg-white shadow-[0_2px_8px_rgba(7,20,43,0.28),inset_0_-1px_1px_rgba(59,130,246,0.22)] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
      >
        <span className="absolute left-1 top-1 h-1.5 w-2 rounded-full bg-sky-100/90" />
      </span>
    </button>
  );
});

interface CrystalSheetProps {
  open: boolean;
  onClose: () => void;
  zIndexClass?: string;
  maxWidthClass?: string;
  scrimClassName?: string;
  footer?: ReactNode;
  children: ReactNode;
}

let openSheetLockCount = 0;
let savedBodyOverflow = '';

/**
 * Viewport-Portaled Modal / Bottom Sheet:
 * - Portals into `document.body` so ancestor tab/panel transforms NEVER trap `position: fixed`.
 * - Flex-column `max-h-[86dvh]` layout with internal `overscroll-contain` scroll + optional pinned `footer`
 *   ensuring zero vertical cutoff on shorter Android screens & WebViews.
 */
export function CrystalSheet({
  open,
  onClose,
  zIndexClass = 'z-50',
  maxWidthClass = 'max-w-lg',
  scrimClassName = 'bg-[#040E28]/36 dark:bg-[#020618]/60',
  footer,
  children,
}: CrystalSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const deltaYRef = useRef<number>(0);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (openSheetLockCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openSheetLockCount += 1;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      openSheetLockCount = Math.max(0, openSheetLockCount - 1);
      if (openSheetLockCount === 0) {
        document.body.style.overflow = savedBodyOverflow;
      }
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    startYRef.current = e.touches[0].clientY;
    startTimeRef.current = performance.now();
    deltaYRef.current = 0;
    if (panelRef.current) {
      panelRef.current.style.transition = 'none';
    }
  };

  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (startYRef.current === null || e.touches.length !== 1 || !panelRef.current) return;
    const dy = Math.max(0, e.touches[0].clientY - startYRef.current);
    deltaYRef.current = dy;
    panelRef.current.style.transform = `translate3d(0, ${dy}px, 0)`;
  };

  const handleTouchEnd = () => {
    const dy = deltaYRef.current;
    const elapsed = Math.max(1, performance.now() - startTimeRef.current);
    const velocity = dy / elapsed;
    startYRef.current = null;
    deltaYRef.current = 0;
    if (dy > 76 || (dy > 32 && velocity > 0.48)) {
      haptics.tick();
      onClose();
      return;
    }
    if (panelRef.current) {
      panelRef.current.style.transition = 'transform 165ms cubic-bezier(0.16, 1, 0.3, 1)';
      panelRef.current.style.transform = '';
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className={`animate-scrim-in fixed inset-0 ${zIndexClass} flex items-end justify-center overscroll-contain sm:items-center sm:p-4 ${scrimClassName}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          haptics.tick();
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className={`animate-sheet-in ios-glass-modal flex max-h-[86dvh] w-full ${maxWidthClass} flex-col overflow-hidden rounded-t-[32px] text-[#07142B] dark:text-white sm:max-h-[88dvh] sm:rounded-[34px]`}
      >
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex shrink-0 cursor-grab touch-none justify-center pt-2.5 pb-1 active:cursor-grabbing sm:hidden"
        >
          <div className="h-1.5 w-11 rounded-full bg-blue-950/22 dark:bg-sky-200/35" />
        </div>

        <div
          className={`sheet-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y px-5 pt-2 sm:px-6 sm:pt-5 ${
            footer ? 'pb-4 sm:pb-4' : 'pb-[calc(1.35rem+env(safe-area-inset-bottom))] sm:pb-6'
          }`}
        >
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-white/35 px-5 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-sky-300/15 sm:px-6 sm:pb-5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
