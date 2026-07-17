import { isLabEffectEnabled, onLabEffectToggle } from "./core";

interface Particle {
  offset: number; // 縦方向の基準位置(px)
  edgeInset: number; // 画面端からの距離(px)
  size: number;
  speed: number; // スクロール量に対する移動割合
  driftPhase: number;
  edge: "left" | "right";
  opacity: number;
}

const PARTICLE_COUNT = 18;
const EDGE_MARGIN = 60;
const PARTICLE_COLOR = "0, 100, 54"; // --color-primary-dark (#006436) のRGB

// 画面端をスクロールに連動してゆっくり漂う小さな粒を表示する(Canvas 2D、WebGLなし)
export function initScrollParticles(): void {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let particles: Particle[] = [];
  let rafId: number | undefined;
  let scrollOffset = 0;
  let isEnabled = false;

  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function createParticles() {
    particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      offset: Math.random() * window.innerHeight * 2,
      edgeInset: Math.random() * EDGE_MARGIN,
      size: 2 + Math.random() * 3,
      speed: 0.05 + Math.random() * 0.15,
      driftPhase: Math.random() * Math.PI * 2,
      edge: Math.random() < 0.5 ? "left" : "right",
      opacity: 0.25 + Math.random() * 0.35,
    }));
  }

  function onScroll() {
    scrollOffset = window.scrollY;
  }

  function draw(time: number) {
    if (!ctx || !canvas || !canvas.isConnected) {
      rafId = undefined;
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const wrap = canvas.height + 40;

    for (const p of particles) {
      const wobble = Math.sin(time * 0.0003 + p.driftPhase) * 8;
      const rawY = p.offset - scrollOffset * p.speed;
      const y = (((rawY % wrap) + wrap) % wrap) - 20;
      const x = p.edge === "left" ? p.edgeInset + wobble : canvas.width - p.edgeInset + wobble;

      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${PARTICLE_COLOR}, ${p.opacity})`;
      ctx.fill();
    }

    rafId = requestAnimationFrame(draw);
  }

  // Astroのページ遷移(View Transitions)でdocument.bodyが丸ごと入れ替わると、
  // 動的に追加したcanvasも一緒に消えてしまうため、無ければ作り直す
  function ensureCanvas() {
    if (canvas && canvas.isConnected) return;
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      rafId = undefined;
    }
    canvas = document.createElement("canvas");
    canvas.className = "lab-scroll-particles";
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    scrollOffset = window.scrollY;
    resize();
    createParticles();
    rafId = requestAnimationFrame(draw);
  }

  function start() {
    isEnabled = true;
    ensureCanvas();
  }

  function stop() {
    isEnabled = false;
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    rafId = undefined;
    canvas?.remove();
    canvas = null;
    ctx = null;
  }

  window.addEventListener("resize", resize);
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("astro:page-load", () => {
    if (isEnabled) ensureCanvas();
  });

  if (isLabEffectEnabled("scroll-particles")) start();
  onLabEffectToggle("scroll-particles", (enabled) => (enabled ? start() : stop()));
}
