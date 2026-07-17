import { isLabEffectEnabled, onLabEffectToggle } from "./core";

const RING_SIZE = 20;

// カーソルにビタ追従する小さいリングを表示する(WebGLなし、CSS transformのみ)
export function initCursorRing(): void {
  let ring: HTMLDivElement | null = null;
  let isEnabled = false;

  function onMouseMove(e: MouseEvent) {
    if (!ring) return;
    ring.style.transform = `translate(${e.clientX - RING_SIZE / 2}px, ${e.clientY - RING_SIZE / 2}px)`;
    ring.classList.add("is-visible");
  }

  // Astroのページ遷移(View Transitions)でdocument.bodyが丸ごと入れ替わると、
  // 動的に追加したリング要素も一緒に消えてしまうため、無ければ作り直す
  function ensureRing() {
    if (ring && ring.isConnected) return;
    ring = document.createElement("div");
    ring.className = "lab-cursor-ring";
    document.body.appendChild(ring);
  }

  function start() {
    isEnabled = true;
    ensureRing();
  }

  function stop() {
    isEnabled = false;
    ring?.remove();
    ring = null;
  }

  window.addEventListener("mousemove", onMouseMove);
  document.addEventListener("astro:page-load", () => {
    if (isEnabled) ensureRing();
  });

  if (isLabEffectEnabled("cursor-ring")) start();
  onLabEffectToggle("cursor-ring", (enabled) => (enabled ? start() : stop()));
}
