import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, useAnimate } from "framer-motion";
import { arc } from "motion";
import { cn } from "../../lib/utils";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function BounceSidebar({
  items = [],
  value,
  defaultValue = 0,
  onChange,
  dotColor = "#18181B",
  className,
  ...props
}) {
  const location = useLocation();
  const [internalValue, setInternalValue] = useState(defaultValue);
  
  // Auto-sync with current pathname if href matches
  useEffect(() => {
    if (value === undefined && location?.pathname) {
      const foundIdx = items.findIndex((item) => {
        if (typeof item === 'object' && item.href) {
          if (item.href === '/' && location.pathname === '/') return true;
          if (item.href !== '/' && location.pathname.startsWith(item.href)) return true;
        }
        return false;
      });
      if (foundIdx !== -1) {
        setInternalValue(foundIdx);
      }
    }
  }, [location?.pathname, items, value]);

  const activeIndex = value ?? internalValue;

  const [dot, animate] = useAnimate();
  const itemRefs = useRef([]);
  const prevY = useRef(null);

  const [dotSize, setDotSize] = useState(6);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    setDotSize(Math.round(6 * dpr) / dpr);
  }, []);

  useIsomorphicLayoutEffect(() => {
    let cancelled = false;
    const snap = () => {
      const el = itemRefs.current[activeIndex];
      if (cancelled || !el || !dot.current) return;
      const dpr = window.devicePixelRatio || 1;
      const size = Math.round(6 * dpr) / dpr;
      const toY =
        Math.round((el.offsetTop + el.offsetHeight / 2 - size / 2) * dpr) / dpr;
      animate(dot.current, { x: 0, y: toY }, { duration: 0 });
      prevY.current = toY;
      setReady(true);
    };

    snap();
    const raf = requestAnimationFrame(snap);
    document.fonts?.ready?.then(snap);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (!el || !dot.current) return;

    const dpr = window.devicePixelRatio || 1;
    const toY =
      Math.round((el.offsetTop + el.offsetHeight / 2 - dotSize / 2) * dpr) /
      dpr;

    if (prevY.current === null) {
      animate(dot.current, { x: 0, y: toY }, { duration: 0 });
      prevY.current = toY;
      return;
    }

    const fromY = prevY.current;
    const delta = toY - fromY;
    prevY.current = toY;
    if (delta === 0) return;

    const distance = Math.abs(delta);
    const path = arc({
      strength: Math.min(0.8, 14 / distance),
      direction: delta > 0 ? "ccw" : "cw",
    });

    animate(
      dot.current,
      { x: 0, y: toY },
      { duration: 0.25, ease: "easeOut", path }
    );
  }, [activeIndex, animate, dot, dotSize]);

  const select = (index, item) => {
    if (value === undefined) setInternalValue(index);
    onChange?.(index, item);
  };

  return (
    <ul
      data-slot="bounce-sidebar"
      className={cn("relative flex flex-col gap-1 pl-5 select-none", className)}
      {...props}
    >
      {/* Animated Bouncy Dot Indicator */}
      <span
        ref={dot}
        aria-hidden
        className="absolute left-1.5 top-0 rounded-full transition-opacity duration-150 pointer-events-none shadow-xs"
        style={{
          width: dotSize,
          height: dotSize,
          backgroundColor: dotColor,
          opacity: ready ? 1 : 0,
        }}
      />

      {items.map((item, index) => {
        const label = typeof item === "string" ? item : item.label;
        const Icon = item.icon;

        if (typeof item !== "string" && item.heading) {
          return (
            <li
              key={`${index}-${label}`}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              role="presentation"
              data-slot="bounce-sidebar-heading"
              style={{ color: dotColor }}
              className="px-2 pb-1.5 pt-5 text-[10px] font-mono font-bold uppercase tracking-[0.14em] first:pt-0"
            >
              {label}
            </li>
          );
        }

        const href = typeof item === "string" ? undefined : item.href;
        const isActive = index === activeIndex;
        const itemClassName = cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold transition-all duration-200",
          isActive
            ? "text-[#111827] bg-zinc-100/80 font-bold shadow-2xs"
            : "text-zinc-600 hover:text-[#111827] hover:bg-zinc-50"
        );

        return (
          <li
            key={`${index}-${label}`}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
          >
            {href ? (
              <Link
                to={href}
                data-slot="bounce-sidebar-item"
                data-active={isActive}
                onClick={() => {
                  select(index, item);
                  item.onClick?.();
                }}
                className={itemClassName}
              >
                {Icon && (
                  <Icon
                    className={cn(
                      "w-4 h-4 shrink-0 transition-colors",
                      isActive ? "text-zinc-600" : "text-zinc-400"
                    )}
                  />
                )}
                <span className="truncate">{label}</span>
                {item.badge && (
                  <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-600 font-semibold border border-[#E2E5E8]">
                    {item.badge}
                  </span>
                )}
              </Link>
            ) : (
              <button
                type="button"
                data-slot="bounce-sidebar-item"
                data-active={isActive}
                onClick={() => {
                  select(index, item);
                  item.onClick?.();
                }}
                className={itemClassName}
              >
                {Icon && (
                  <Icon
                    className={cn(
                      "w-4 h-4 shrink-0 transition-colors",
                      isActive ? "text-zinc-600" : "text-zinc-400"
                    )}
                  />
                )}
                <span className="truncate">{label}</span>
                {item.badge && (
                  <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-600 font-semibold border border-[#E2E5E8]">
                    {item.badge}
                  </span>
                )}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default BounceSidebar;
