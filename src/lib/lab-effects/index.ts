import { initCursorRing } from "./cursor-ring";
import { initPageRipple } from "./page-ripple";
import { initScrollParticles } from "./scroll-particles";

// 全ページで無条件に読み込み、各エフェクトが自分でlocalStorageのon/off状態を確認して動作する
export function initLabEffects(): void {
  initCursorRing();
  initPageRipple();
  initScrollParticles();
}

export * from "./core";
