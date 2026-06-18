/**
 * Shared poster render helpers: story mapping and text auto-fit.
 * Used by index_2.html editor and headless __RENDER_API__ path.
 */
(function (global) {
  "use strict";

  const AUTO_FIT_BINDS = new Set(["heroNumber", "callout", "playerName", "teamName"]);

  const SPORT_MAP = {
    mfb: "Football",
    fb: "Football",
    mbb: "Men's Basketball",
    wbb: "Women's Basketball",
    wfb: "Football",
    wsoc: "Soccer",
    msoc: "Soccer",
  };

  function templateAutoFitBinds(templateId, getTextRules) {
    const extra = getTextRules?.(templateId)?.autoFit || [];
    return new Set([...AUTO_FIT_BINDS, ...extra]);
  }

  function templateStatAutoFit(templateId, getTextRules) {
    return !!getTextRules?.(templateId)?.stats?.autoFit;
  }

  function autoFitSalukisStat(el, g, def) {
    const n = el.querySelector(".s-n");
    const l = el.querySelector(".s-l");
    if (!n) return;
    const maxW = g.w;
    const slotH = g.h ?? def.h ?? 114;
    const maxPx = g.size ?? def.size ?? 150;
    const minPx = 38;
    let size = maxPx;
    n.style.display = "block";
    n.style.width = "100%";
    n.style.textAlign = g.align ?? def.align ?? "center";
    n.style.whiteSpace = "normal";
    n.style.wordBreak = "break-word";
    n.style.lineHeight = "0.9";
    n.style.setProperty("font-size", size + "px", "important");
    let guard = 0;
    const numMaxH = Math.round(slotH * 0.62);
    while (size > minPx && guard++ < 90) {
      if (n.scrollWidth <= maxW + 2 && n.scrollHeight <= numMaxH) break;
      size -= 2;
      n.style.setProperty("font-size", size + "px", "important");
    }
    if (l) {
      l.style.display = "block";
      l.style.width = "100%";
      l.style.textAlign = g.align ?? def.align ?? "center";
      l.style.marginTop = "4px";
    }
  }

  function autoFitGenericStat(el, g, def, templateId, getTextRules) {
    const n = el.querySelector(".s-n");
    const l = el.querySelector(".s-l");
    if (!n) return;
    const rules = getTextRules?.(templateId)?.stats || {};
    const maxW = g.w;
    const slotH = g.h ?? def.h ?? 70;
    const maxPx = g.size ?? def.size ?? rules.maxSize ?? rules.defaultSize ?? 42;
    const minPx = 22;
    const stacked = !!def.statStack;
    let size = maxPx;
    n.style.display = stacked ? "block" : "inline";
    n.style.maxWidth = stacked ? "100%" : "none";
    n.style.whiteSpace = "normal";
    n.style.wordBreak = "break-word";
    n.style.lineHeight = stacked ? "0.9" : "1";
    n.style.fontSize = size + "px";
    if (l && !stacked) {
      l.style.fontSize = Math.round(size * 0.42) + "px";
      l.style.whiteSpace = "normal";
      l.style.wordBreak = "break-word";
    }
    const numMaxH = stacked ? Math.round(slotH * 0.62) : slotH;
    let guard = 0;
    while (size > minPx && guard++ < 90) {
      const wOk = el.scrollWidth <= maxW + 2;
      const hOk = n.scrollHeight <= numMaxH + 2;
      if (wOk && hOk) break;
      size -= 2;
      n.style.fontSize = size + "px";
      if (l && !stacked) l.style.fontSize = Math.round(size * 0.42) + "px";
    }
    if (l && stacked) {
      l.style.display = "block";
      l.style.width = "100%";
      l.style.textAlign = g.align ?? def.align ?? "center";
      l.style.marginTop = "4px";
    }
    el.style.overflow = "hidden";
  }

  function autoFitTextLayer(el, def, g, templateId, getTextRules) {
    if (def.type !== "text" || def.kind === "stat" || !templateAutoFitBinds(templateId, getTextRules).has(def.bind)) return;
    if (g?.manualSize) return;
    const maxW = g.w;
    const lh = def.lh ?? g.lh ?? 1;
    let maxH = g.h ?? def.h ?? null;
    if (!maxH && def.bind === "heroNumber") {
      maxH = Math.round((g.size ?? def.size ?? 30) * (typeof lh === "number" ? lh : 1) * 1.08);
    }
    if (maxH) {
      el.style.height = maxH + "px";
      el.style.overflow = "hidden";
    }
    let size = parseFloat(el.style.fontSize) || (g.size ?? def.size ?? 30);
    el.style.overflowWrap = "break-word";
    el.style.wordBreak = "break-word";
    if (def.bind === "heroNumber") {
      el.style.whiteSpace = "nowrap";
      el.style.lineHeight = String(lh);
      let guard = 0;
      while (size > 12 && guard++ < 90) {
        const wOk = el.scrollWidth <= maxW + 2;
        const hOk = !maxH || el.scrollHeight <= maxH + 2;
        if (wOk && hOk) break;
        size -= 2;
        el.style.fontSize = size + "px";
      }
    } else {
      el.style.whiteSpace = "normal";
      const minSize = Math.max(10, Math.round(size * 0.72));
      let guard = 0;
      while (size > minSize && guard++ < 60) {
        const wOk = el.scrollWidth <= maxW + 2;
        const hOk = !maxH || el.scrollHeight <= maxH + 4;
        if (wOk && hOk) break;
        size -= 1;
        el.style.fontSize = size + "px";
      }
      if (maxH) el.style.overflow = "hidden";
    }
  }

  function themeLum(hex) {
    const h = String(hex || "").replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  function themeContrastRatio(a, b) {
    const la = themeLum(a) + 0.05, lb = themeLum(b) + 0.05;
    return la > lb ? la / lb : lb / la;
  }
  function themeOnColor(bg) {
    return themeLum(bg) > 0.55 ? "#111111" : "#FFFFFF";
  }
  function themePickReadable(candidates, bg, min = 3) {
    for (const fg of candidates) {
      if (fg && themeContrastRatio(fg, bg) >= min) return fg;
    }
    return themeOnColor(bg);
  }
  function enrichThemeColors(colors) {
    const c = { ...(colors || {}) };
    const primary = c.primary || "#9D2235";
    const secondary = c.secondary || "#FFFFFF";
    const calloutBg = c.calloutBg || "#FFFFFF";
    c.onPrimary = c.onPrimary || themePickReadable([secondary, "#FFFFFF", "#111111"], primary, 3);
    c.onPrimaryMuted = c.onPrimaryMuted || themePickReadable([secondary, c.onPrimary], primary, 2.8);
    c.calloutBg = calloutBg;
    c.onCallout = c.onCallout || themePickReadable([primary, c.contrast, "#111111", "#FFFFFF"], calloutBg, 3);
    c.onPhoto = c.onPhoto || primary;
    c.onPhotoMuted = c.onPhotoMuted || primary;
    if (!c.contrast) c.contrast = themeOnColor(primary) === "#FFFFFF" ? "#0B111E" : "#F5F5F5";
    c.onContrast = c.onContrast || themePickReadable([secondary, primary, "#FFFFFF", "#111111"], c.contrast, 4.5);
    return c;
  }

  /** Map stories.players.json entry → editor text + optional colors. */
  function mapStoryToText(story) {
    const text = {};
    const colors = {};
    const set = (k, v) => {
      text[k] = v != null && v !== "" ? String(v) : "";
    };
    set("playerName", story.player_name);
    set("teamName", story.team_name);
    const pc = (story.position_class || "").split(",").map((x) => x.trim());
    text.position = pc[0] && pc[0] !== "—" ? pc[0] : "";
    text.playerClass = pc[1] && pc[1] !== "—" ? pc[1] : "";
    set("hashtag", story.hashtag);
    set("eyebrow", story.eyebrow_text);
    set("heroNumber", story.hero_stat_number);
    set("heroDesc", story.hero_stat_description);
    set("stat1num", story.stat_line_1);
    set("stat1label", story.stat_context_1);
    set("stat2num", story.stat_line_2);
    set("stat2label", story.stat_context_2);
    set("stat3num", story.stat_line_3);
    set("stat3label", story.stat_context_3);
    set("callout", story.callout_text);
    text.sport = SPORT_MAP[(story.sport || "").toLowerCase()] || story.sport || "";
    if (story.primary_color) colors.primary = story.primary_color;
    if (story.secondary_color) colors.secondary = story.secondary_color;
    return { text, colors };
  }

  global.PosterRenderEngine = {
    AUTO_FIT_BINDS,
    SPORT_MAP,
    templateAutoFitBinds,
    templateStatAutoFit,
    autoFitSalukisStat,
    autoFitGenericStat,
    autoFitTextLayer,
    mapStoryToText,
    enrichThemeColors,
  };
})(typeof window !== "undefined" ? window : globalThis);
