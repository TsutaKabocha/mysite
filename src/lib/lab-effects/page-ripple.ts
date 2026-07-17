import type { TransitionBeforePreparationEvent } from "astro:transitions/client";
import { isLabEffectEnabled, onLabEffectToggle } from "./core";

let enabled = false;

function createRippleOverlay(x: number, y: number): HTMLDivElement {
  const maxRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );
  const overlay = document.createElement("div");
  overlay.className = "lab-page-ripple";
  overlay.style.setProperty("--x", `${x}px`);
  overlay.style.setProperty("--y", `${y}px`);
  overlay.style.setProperty("--r", `${maxRadius}px`);
  document.body.appendChild(overlay);
  return overlay;
}

// リップルが画面を覆い終わるまで待つ(transitionendが発火しない場合の保険付き)
function expandAndWaitForCover(overlay: HTMLDivElement): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    overlay.addEventListener("transitionend", finish, { once: true });
    window.setTimeout(finish, 700);

    void overlay.offsetHeight; // reflowを強制してtransitionを確実に発火させる
    overlay.classList.add("is-expanding");
  });
}

// ClientRouter(View Transitions)はリンククリックを自前でpreventDefaultして
// navigate()するため、旧実装のようにdocumentのclickイベントを横取りして
// preventDefault+location.hrefで遷移する方式は競合して機能しなくなる。
// 代わりにAstroが遷移開始時に発火させる astro:before-preparation にフックし、
// 実際のページ差し替え(loader)をリップルが画面を覆い終わるまで遅延させる。
function handleBeforePreparation(event: TransitionBeforePreparationEvent) {
  if (!enabled || !event.sourceElement) return;

  const rect = event.sourceElement.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const overlay = createRippleOverlay(x, y);

  const defaultLoader = event.loader;
  event.loader = async () => {
    await expandAndWaitForCover(overlay);
    await defaultLoader();
  };
}

// リンククリック位置から円形のリップルが広がって次のページへ遷移する演出
export function initPageRipple(): void {
  enabled = isLabEffectEnabled("page-ripple");
  onLabEffectToggle("page-ripple", (next) => {
    enabled = next;
  });

  document.addEventListener(
    "astro:before-preparation",
    handleBeforePreparation as EventListener
  );
}
