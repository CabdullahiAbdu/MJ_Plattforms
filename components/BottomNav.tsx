import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Home, Search, Calendar, Check, Settings } from './Icons';
import { AppView } from '../types';
import { haptics } from '../services/haptics';

interface BottomNavProps {
  currentView: AppView;
  navigate: (view: AppView) => void;
}

interface TabItem {
  view: AppView;
  label: string;
  renderIcon: (active: boolean) => React.ReactNode;
}

const TABS: TabItem[] = [
  { view: AppView.HOME, label: 'Home', renderIcon: () => <Home size={19} /> },
  { view: AppView.SEARCH, label: 'Discover', renderIcon: () => <Search size={19} /> },
  { view: AppView.CALENDAR, label: 'Calendar', renderIcon: () => <Calendar size={19} /> },
  { view: AppView.WATCHLIST, label: 'Library', renderIcon: () => <Check size={19} /> },
  { view: AppView.SETTINGS, label: 'Settings', renderIcon: () => <Settings size={19} /> },
];

export const BottomNav: React.FC<BottomNavProps> = ({ currentView, navigate }) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  const activeIndex = Math.max(
    0,
    TABS.findIndex((t) => t.view === currentView)
  );

  // Visual highlight index updates immediately while dragging or tapping
  const [visualIndex, setVisualIndex] = useState<number>(activeIndex);

  const currentViewRef = useRef<AppView>(currentView);
  currentViewRef.current = currentView;

  useEffect(() => {
    setVisualIndex(activeIndex);
  }, [activeIndex]);

  // Continuous spring physics state in slot units (0 .. TABS.length - 1)
  const physicsRef = useRef({
    initialized: false,
    pos: activeIndex,
    vel: 0,
    targetPos: activeIndex,
    swell: 1,
    vSwell: 0,
    targetSwell: 1,
    rafId: 0 as number,
    lastTime: 0,
    isDragging: false,
    pointerId: -1,
    startX: 0,
    hasMoved: false,
  });

  const applyBubbleTransform = useCallback((pos: number, vel: number, swell: number) => {
    const el = bubbleRef.current;
    if (!el) return;
    // Subtle organic horizontal stretch proportional to velocity
    const stretchX = 1 + Math.min(0.14, Math.abs(vel) * 0.012);
    const squashY = 1 / Math.pow(stretchX, 0.35);
    const scaleX = stretchX * swell;
    const scaleY = squashY * swell;
    el.style.transform = `translate3d(${(pos * 100).toFixed(3)}%, 0, 0) scaleX(${scaleX.toFixed(4)}) scaleY(${scaleY.toFixed(4)})`;
  }, []);

  const startPhysicsLoop = useCallback(() => {
    const p = physicsRef.current;
    if (p.rafId) return;

    p.lastTime = performance.now();

    const step = (now: number) => {
      const dt = Math.min((now - p.lastTime) / 1000, 0.032);
      p.lastTime = now;

      // Responsive spring stiffness: tighter when dragging with finger, silky glide on tap
      const stiffness = p.isDragging ? 520 : 320;
      const damping = p.isDragging ? 36 : 26;

      const force = (p.targetPos - p.pos) * stiffness - p.vel * damping;
      p.vel += force * dt;
      p.pos += p.vel * dt;

      const fSwell = (p.targetSwell - p.swell) * 380 - p.vSwell * 28;
      p.vSwell += fSwell * dt;
      p.swell += p.vSwell * dt;

      applyBubbleTransform(p.pos, p.vel, p.swell);

      const isSettled =
        !p.isDragging &&
        Math.abs(p.targetPos - p.pos) < 0.002 &&
        Math.abs(p.vel) < 0.015 &&
        Math.abs(p.targetSwell - p.swell) < 0.002 &&
        Math.abs(p.vSwell) < 0.015;

      if (isSettled) {
        p.pos = p.targetPos;
        p.vel = 0;
        p.swell = p.targetSwell;
        p.vSwell = 0;
        applyBubbleTransform(p.pos, 0, p.swell);
        p.rafId = 0;
      } else {
        p.rafId = requestAnimationFrame(step);
      }
    };

    p.rafId = requestAnimationFrame(step);
  }, [applyBubbleTransform]);

  // Sync bubble target whenever activeIndex changes
  useEffect(() => {
    const p = physicsRef.current;
    if (!p.initialized) {
      p.initialized = true;
      p.pos = activeIndex;
      p.targetPos = activeIndex;
      applyBubbleTransform(activeIndex, 0, 1);
      return;
    }

    if (!p.isDragging) {
      p.targetPos = activeIndex;
      startPhysicsLoop();
    }
  }, [activeIndex, applyBubbleTransform, startPhysicsLoop]);

  useEffect(() => {
    return () => {
      if (physicsRef.current.rafId) {
        cancelAnimationFrame(physicsRef.current.rafId);
        physicsRef.current.rafId = 0;
      }
    };
  }, []);

  // Convert clientX into continuous slot position [0 .. TABS.length - 1]
  const resolveSlotFromClientX = (clientX: number): { continuousPos: number; nearestIndex: number } => {
    const trackEl = trackRef.current;
    if (!trackEl) return { continuousPos: activeIndex, nearestIndex: activeIndex };

    const rect = trackEl.getBoundingClientRect();
    const slotWidth = rect.width / TABS.length;
    const relX = clientX - rect.left - slotWidth / 2;
    const rawPos = relX / Math.max(1, slotWidth);
    const continuousPos = Math.max(0, Math.min(TABS.length - 1, rawPos));
    const nearestIndex = Math.max(0, Math.min(TABS.length - 1, Math.round(continuousPos)));

    return { continuousPos, nearestIndex };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = physicsRef.current;
    p.isDragging = true;
    p.pointerId = e.pointerId;
    p.startX = e.clientX;
    p.hasMoved = false;
    p.targetSwell = 1.04;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unavailable
    }

    startPhysicsLoop();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const p = physicsRef.current;
    if (!p.isDragging || e.pointerId !== p.pointerId) return;

    if (Math.abs(e.clientX - p.startX) > 4) {
      p.hasMoved = true;
    }

    if (p.hasMoved) {
      p.targetSwell = 1.05;
      const { continuousPos, nearestIndex } = resolveSlotFromClientX(e.clientX);
      // Smoothly blend continuous finger position with subtle magnetic snap to slot centers
      p.targetPos = continuousPos * 0.78 + nearestIndex * 0.22;
      setVisualIndex(nearestIndex);

      const targetView = TABS[nearestIndex].view;
      if (targetView !== currentViewRef.current) {
        currentViewRef.current = targetView;
        haptics.selection();
        navigate(targetView);
      }

      startPhysicsLoop();
    }
  };

  const finishPointerInteraction = (e: React.PointerEvent<HTMLElement>, cancelled = false) => {
    const p = physicsRef.current;
    if (!p.isDragging || e.pointerId !== p.pointerId) return;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }

    const wasClick = !p.hasMoved && !cancelled;
    p.isDragging = false;
    p.pointerId = -1;
    p.targetSwell = 1;

    if (wasClick) {
      const { nearestIndex } = resolveSlotFromClientX(e.clientX);
      const targetView = TABS[nearestIndex].view;
      p.targetPos = nearestIndex;
      setVisualIndex(nearestIndex);

      if (targetView !== currentViewRef.current) {
        currentViewRef.current = targetView;
        haptics.selection();
        navigate(targetView);
      }
    } else {
      const settledIdx = Math.max(
        0,
        TABS.findIndex((t) => t.view === currentViewRef.current)
      );
      p.targetPos = settledIdx;
      setVisualIndex(settledIdx);
    }

    startPhysicsLoop();
  };

  return (
    <nav
      aria-label="Primary Navigation"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishPointerInteraction(e, false)}
      onPointerCancel={(e) => finishPointerInteraction(e, true)}
      style={{
        width: 'clamp(284px, 88vw, 412px)',
        bottom: 'max(0.75rem, calc(env(safe-area-inset-bottom) + 0.35rem))',
        touchAction: 'none',
      }}
      className="fixed left-1/2 -translate-x-1/2 z-50 p-1.5 rounded-full bg-zinc-950/90 backdrop-blur-2xl border border-white/[0.14] shadow-[0_20px_50px_rgba(0,0,0,0.85),inset_0_1px_0.5px_rgba(255,255,255,0.12)] select-none"
    >
      {/* Symmetric 5-Slot Toggle Track */}
      <div
        ref={trackRef}
        className="relative grid grid-cols-5 items-center w-full rounded-full"
        style={{ height: 'clamp(42px, 10.5vw, 48px)' }}
      >
        {/* Full-Height Sliding Toggle Bubble */}
        <div
          ref={bubbleRef}
          aria-hidden="true"
          style={{
            width: `${100 / TABS.length}%`,
            willChange: 'transform',
            transformOrigin: 'center center',
          }}
          className="pointer-events-none absolute top-0 bottom-0 left-0 rounded-full bg-white shadow-[0_4px_20px_rgba(255,255,255,0.32),inset_0_1px_0.5px_rgba(255,255,255,0.9)]"
        />

        {TABS.map((tab, idx) => {
          const isHighlighted = visualIndex === idx;
          return (
            <button
              key={tab.view}
              type="button"
              tabIndex={0}
              aria-label={tab.label}
              aria-current={isHighlighted ? 'page' : undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  physicsRef.current.targetPos = idx;
                  setVisualIndex(idx);
                  startPhysicsLoop();
                  navigate(tab.view);
                }
              }}
              className={`focusable-rounded relative z-10 w-full h-full flex items-center justify-center rounded-full cursor-pointer transition-colors duration-200 ${
                isHighlighted
                  ? 'text-black'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {tab.renderIcon(isHighlighted)}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
