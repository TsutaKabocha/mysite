import { isLabEffectEnabled, onLabEffectToggle } from "./core";

let enabled = false;
let listenerAttached = false;

// サイト内ナビゲーションだけを対象にする(外部リンク・新規タブ・ダウンロード・
// 修飾キー付きクリック・同一ページ内アンカーは素通りさせる)
function shouldIntercept(link: HTMLAnchorElement, event: MouseEvent): boolean {
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.target && link.target !== "_self") return false;
  if (link.hasAttribute("download")) return false;

  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return false;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) {
    return false;
  }
  return true;
}

function playRippleAndNavigate(x: number, y: number, href: string) {
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

  void overlay.offsetHeight; // reflowを強制してtransitionを確実に発火させる
  overlay.classList.add("is-expanding");

  let navigated = false;
  const navigate = () => {
    if (navigated) return;
    navigated = true;
    window.location.href = href;
  };
  overlay.addEventListener("transitionend", navigate, { once: true });
  window.setTimeout(navigate, 700); // transitionendが発火しない場合の保険
}

function handleClick(e: MouseEvent) {
  if (!enabled || e.defaultPrevented) return;
  const target = e.target as HTMLElement | null;
  const link = target?.closest("a") as HTMLAnchorElement | null;
  if (!link || !shouldIntercept(link, e)) return;
  e.preventDefault();
  playRippleAndNavigate(e.clientX, e.clientY, link.href);
}

// リンククリック位置から円形のリップルが広がって次のページへ遷移する演出
export function initPageRipple(): void {
  enabled = isLabEffectEnabled("page-ripple");
  if (!listenerAttached) {
    listenerAttached = true;
    document.addEventListener("click", handleClick);
  }
  onLabEffectToggle("page-ripple", (next) => {
    enabled = next;
  });
}
