export const SEMANTIC_TONES = Object.freeze(["neutral", "information", "success", "warning", "danger"]);
export const CONTROL_SIZES = Object.freeze(["compact", "default", "touch"]);

export function requireSemanticTone(value, fallback = "neutral") {
  return SEMANTIC_TONES.includes(value) ? value : fallback;
}

export const COMPONENT_CONTRACTS = Object.freeze({
  button: { states: ["default", "hover", "active", "focus-visible", "disabled", "loading"], minTarget: 40 },
  field: { states: ["default", "focus-visible", "disabled", "invalid"], labelled: true },
  dialog: { states: ["closed", "open"], keyboard: ["Tab", "Shift+Tab", "Escape"], restoresFocus: true },
  status: { states: SEMANTIC_TONES, colorIndependent: true },
  disclosure: { states: ["closed", "open", "focus-visible"], nativeSemantics: true },
  tabs: { states: ["default", "selected", "focus-visible", "disabled"], keyboard: ["ArrowLeft", "ArrowRight", "Home", "End"] },
  progressPath: { states: ["complete", "active", "waiting", "blocked", "unavailable"], colorIndependent: true },
  dataList: { states: ["loading", "empty", "ready", "error"], responsive: true },
});
