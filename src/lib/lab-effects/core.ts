// /lab ページで on/off できる軽量エフェクトの共通ロジック。
// 各エフェクトは BaseLayout 経由で全ページに無条件で読み込まれ、
// このモジュールが持つ localStorage の状態を自分で確認して動作するかどうかを決める。

export type LabEffectKey = "cursor-ring" | "page-ripple" | "scroll-particles";

export interface LabEffectMeta {
  key: LabEffectKey;
  name: string;
  description: string;
}

// /lab ページのカード一覧はこの配列を単一の情報源として描画する
export const LAB_EFFECTS: LabEffectMeta[] = [
  {
    key: "cursor-ring",
    name: "カーソル追従リング",
    description:
      "深緑の小さいリングがカーソルに少し遅れて追従します。クリック判定は妨げません。",
  },
  {
    key: "page-ripple",
    name: "ページ遷移リップル",
    description:
      "サイト内リンクをクリックすると、その位置から円形のリップルが広がって次のページへ遷移します。",
  },
  {
    key: "scroll-particles",
    name: "スクロール連動パーティクル",
    description: "画面端に、スクロールに連動してゆっくり漂う小さな粒を表示します。",
  },
];

const STORAGE_PREFIX = "lab_effect_";
const TOGGLE_EVENT = "lab-effect-toggle";

interface LabEffectToggleDetail {
  key: LabEffectKey;
  enabled: boolean;
}

export function isLabEffectEnabled(key: LabEffectKey): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

// 保存 + 同一タブ内で動いているエフェクトへの即時通知を行う
export function setLabEffectEnabled(key: LabEffectKey, enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, enabled ? "1" : "0");
  } catch {
    // プライベートブラウジング等でlocalStorageが使えない場合は永続化のみ諦める
  }
  window.dispatchEvent(
    new CustomEvent<LabEffectToggleDetail>(TOGGLE_EVENT, { detail: { key, enabled } })
  );
}

// 同一タブでのトグル(CustomEvent)と、他タブでの変更(storageイベント)の両方に追従する
export function onLabEffectToggle(
  key: LabEffectKey,
  callback: (enabled: boolean) => void
): void {
  window.addEventListener(TOGGLE_EVENT, (e) => {
    const detail = (e as CustomEvent<LabEffectToggleDetail>).detail;
    if (detail.key === key) callback(detail.enabled);
  });
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_PREFIX + key) callback(e.newValue === "1");
  });
}
