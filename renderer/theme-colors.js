/** Derive readable text/surface colors from brand palette (primary/secondary). */

function hexToRgb(hex) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lum(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function contrastRatio(a, b) {
  const la = lum(a) + 0.05;
  const lb = lum(b) + 0.05;
  return la > lb ? la / lb : lb / la;
}

export function onColor(bgHex) {
  return lum(bgHex) > 0.55 ? "#111111" : "#FFFFFF";
}

export function pickReadable(fgCandidates, bgHex, minRatio = 3) {
  for (const fg of fgCandidates) {
    if (!fg) continue;
    if (contrastRatio(fg, bgHex) >= minRatio) return fg;
  }
  return onColor(bgHex);
}

/**
 * Enrich LLM/base palette with derived tokens templates use for readable text.
 * @param {object} colors
 */
export function enrichThemeColors(colors) {
  const c = { ...(colors || {}) };
  const primary = c.primary || "#9D2235";
  const secondary = c.secondary || "#FFFFFF";
  const calloutBg = c.calloutBg || "#FFFFFF";

  c.onPrimary = c.onPrimary || pickReadable([secondary, "#FFFFFF", "#111111"], primary, 3);
  c.onPrimaryMuted = c.onPrimaryMuted || pickReadable([secondary, c.onPrimary], primary, 2.8);
  c.calloutBg = calloutBg;
  c.onCallout = c.onCallout || pickReadable([primary, c.contrast, "#111111", "#FFFFFF"], calloutBg, 3);
  // Text over full-bleed player photo (top-right name block) — brand primary reads on light jerseys/crowds.
  c.onPhoto = c.onPhoto || primary;
  c.onPhotoMuted = c.onPhotoMuted || primary;
  if (!c.contrast) c.contrast = onColor(primary) === "#FFFFFF" ? "#0B111E" : "#F5F5F5";
  c.onContrast = c.onContrast || pickReadable([secondary, primary, "#FFFFFF", "#111111"], c.contrast, 4.5);

  return c;
}
