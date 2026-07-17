import { isLabEffectEnabled, onLabEffectToggle } from "./core";

const RING_SIZE = 20;
const EASE = 0.18;

// カーソルに少し遅れて追従する小さいリングを表示する(WebGLなし、CSS transformのみ)
export function initCursorRing(): void {
  let ring: HTMLDivElement | null = null;
  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;
  let hasPosition = false;
  let rafId: number | undefined;

  function onMouseMove(e: MouseEvent) {
    targetX = e.clientX;
    targetY = e.clientY;
    if (!hasPosition) {
      hasPosition = true;
      currentX = targetX;
      currentY = targetY;
      ring?.classList.add("is-visible");
    }
  }

  function tick() {
    currentX += (targetX - currentX) * EASE;
    currentY += (targetY - currentY) * EASE;
    if (ring) {
      ring.style.transform = `translate(${currentX - RING_SIZE / 2}px, ${currentY - RING_SIZE / 2}px)`;
    }
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (ring) return;
    ring = document.createElement("div");
    ring.className = "lab-cursor-ring";
    document.body.appendChild(ring);
    hasPosition = false;
    window.addEventListener("mousemove", onMouseMove);
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    if (!ring) return;
    window.removeEventListener("mousemove", onMouseMove);
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    ring.remove();
    ring = null;
  }

  if (isLabEffectEnabled("cursor-ring")) start();
  onLabEffectToggle("cursor-ring", (enabled) => (enabled ? start() : stop()));
}
