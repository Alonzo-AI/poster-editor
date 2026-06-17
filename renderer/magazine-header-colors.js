/**
 * Magazine header text colors from sampled background behind playerName / playerMeta / eyebrow.
 * Static bucket → color map with brand-palette preference when readable.
 */
(function (global) {
  "use strict";

  const SW = 1080;
  const SH = 1350;
  const HEADER_LAYERS = ["playerName", "playerMeta", "eyebrow"];
  const SALUKIS_DARK_HEADER_LAYERS = ["playerName", "playerMeta"];

  /**
   * Editorial text-on-photo palette.
   * Most player photos are visually busy, so the header biases toward high-value
   * type. Dark text is reserved for genuinely bright sampled regions.
   */
  const MAGAZINE_HEADER_COLOR_MAP = {
    veryDark: {
      playerName: "#FFF8E8",
      playerMeta: "#E8EEF8",
      eyebrow: "#FFD166",
    },
    dark: {
      playerName: "#FFFFFF",
      playerMeta: "#DDE6F2",
      eyebrow: "#FFE08A",
    },
    mid: {
      playerName: "#FFF6E4",
      playerMeta: "#DFE7F2",
      eyebrow: "#FFD166",
    },
    light: {
      playerName: "#101418",
      playerMeta: "#1D2630",
      eyebrow: "#7A0F18",
    },
  };

  const SALUKIS_DARK_HEADER_COLOR_MAP = {
    veryDark: {
      playerName: "#F8FBFF",
      playerMeta: "#E6EEF8",
    },
    dark: {
      playerName: "#FFFFFF",
      playerMeta: "#EEF4FB",
    },
    mid: {
      playerName: "#F7FAFF",
      playerMeta: "#E2EAF4",
    },
    light: {
      playerName: "#0E1622",
      playerMeta: "#243244",
    },
  };

  function hexToRgb(hex) {
    let h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    return (
      "#" +
      [r, g, b]
        .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function lum(hex) {
    const [r, g, b] = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  function contrastRatio(a, b) {
    const la = lum(a) + 0.05;
    const lb = lum(b) + 0.05;
    return la > lb ? la / lb : lb / la;
  }

  function onColor(bgHex) {
    return lum(bgHex) > 0.55 ? "#111111" : "#FFFFFF";
  }

  function pickReadable(fgCandidates, bgHex, minRatio = 3) {
    for (const fg of fgCandidates) {
      if (!fg) continue;
      if (contrastRatio(fg, bgHex) >= minRatio) return fg;
    }
    return onColor(bgHex);
  }

  function classifyBucket(avgLum) {
    if (avgLum < 0.15) return "veryDark";
    if (avgLum < 0.42) return "dark";
    if (avgLum < 0.62) return "mid";
    return "light";
  }

  function brandCandidates(bucket, theme) {
    const c = theme || {};
    const darkBuckets = bucket === "veryDark" || bucket === "dark";
    if (darkBuckets) {
      return [c.secondary, c.onPhoto, c.onPhotoMuted, c.primary, c.contrast, c.onPrimary];
    }
    return [c.primary, c.onPrimary, c.contrast, c.secondary, "#111111", "#222222"];
  }

  function resolveLayerColor(layerId, bucket, bgHex, theme, colorMap) {
    const staticColor = colorMap?.[bucket]?.[layerId];
    // Static per-layer map is primary — brand palette only when map color isn't readable.
    if (staticColor && contrastRatio(staticColor, bgHex) >= 3) return staticColor;
    const picked = pickReadable(brandCandidates(bucket, theme), bgHex, 3);
    const plainFallback = onColor(bgHex);
    if (picked && picked.toLowerCase() !== plainFallback.toLowerCase()) return picked;
    return plainFallback;
  }

  function layerBox(g, def) {
    const w = g.w;
    let h = g.h;
    if (!h) {
      if (def.type === "image" || def.type === "glass" || def.type === "block") h = g.w;
      else h = Math.round((g.size ?? def.size ?? 30) * (def.kind === "stat" ? 1.8 : 1.35));
    }
    return { w, h, left: g.x, top: g.y };
  }

  function imgFit(def, g) {
    return g.fit || def.fit || "contain";
  }

  function computeDisp(def, g, im) {
    const w = g.w;
    const h = g.h ?? g.w;
    const nW = (im && im.natW) || w;
    const nH = (im && im.natH) || h;
    const fit = imgFit(def, g);
    const zoom = g.zoom || 1;
    let base;
    if (fit === "fill") return { dispW: w, dispH: h };
    if (fit === "cover") base = Math.max(w / nW, h / nH);
    else base = Math.min(w / nW, h / nH);
    const s = base * zoom;
    return { dispW: nW * s, dispH: nH * s };
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function drawPlayer(ctx, def, g, imgEl) {
    const x = g.x || 0;
    const y = g.y || 0;
    const w = g.w;
    const h = g.h ?? g.w;
    const fit = imgFit(def, g);
    if (fit === "fill") {
      ctx.drawImage(imgEl, x, y, w, h);
      return;
    }
    const { dispW, dispH } = computeDisp(def, g, {
      natW: imgEl.naturalWidth || w,
      natH: imgEl.naturalHeight || h,
    });
    const cropX = clamp01(g.cropX ?? 0.5);
    const cropY = clamp01(g.cropY ?? 0.5);
    const offX = x - cropX * (dispW - w);
    const offY = y - cropY * (dispH - h);
    ctx.drawImage(imgEl, offX, offY, dispW, dispH);
  }

  function drawMagazineDeco(ctx) {
    const botH = SH * 0.66;
    let grd = ctx.createLinearGradient(0, SH - botH, 0, SH);
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(0.62, "rgba(0,0,0,0.88)");
    grd.addColorStop(1, "#000000");
    ctx.fillStyle = grd;
    ctx.fillRect(0, SH - botH, SW, botH);

    const cx = SW * 0.58;
    const cy = SH * 0.36;
    grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(SW * 0.72, SH * 0.72));
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(0.46, "rgba(0,0,0,0)");
    grd.addColorStop(0.78, "rgba(0,0,0,0.18)");
    grd.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, SW, SH);
  }

  function drawSalukisDarkDeco(ctx) {
    const shadeX = Math.round(SW * 0.56);
    const shadeW = SW - shadeX;
    const shadeH = 190;
    const grd = ctx.createLinearGradient(shadeX, 0, SW, 0);
    grd.addColorStop(0, "rgba(8,12,18,0)");
    grd.addColorStop(0.32, "rgba(8,12,18,0.45)");
    grd.addColorStop(1, "rgba(8,12,18,0.82)");
    ctx.fillStyle = grd;
    ctx.fillRect(shadeX, 0, shadeW, shadeH);
  }

  function sampleRect(ctx, left, top, w, h) {
    const x = Math.max(0, Math.floor(left));
    const y = Math.max(0, Math.floor(top));
    const rw = Math.min(SW - x, Math.max(1, Math.ceil(w)));
    const rh = Math.min(SH - y, Math.max(1, Math.ceil(h)));
    let data;
    try {
      data = ctx.getImageData(x, y, rw, rh).data;
    } catch (e) {
      return null;
    }
    const cx = rw / 2;
    const cy = rh / 2;
    const innerW = rw * 0.6;
    const innerH = rh * 0.6;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let n = 0;
    for (let row = 0; row < rh; row++) {
      for (let col = 0; col < rw; col++) {
        const inCenter =
          Math.abs(col - cx) <= innerW / 2 && Math.abs(row - cy) <= innerH / 2;
        if (!inCenter) continue;
        const i = (row * rw + col) * 4;
        if (data[i + 3] < 8) continue;
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        n++;
      }
    }
    if (!n) {
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 8) continue;
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        n++;
      }
    }
    if (!n) return null;
    const r = rSum / n;
    const g = gSum / n;
    const b = bSum / n;
    const hex = rgbToHex(r, g, b);
    return { hex, bucket: classifyBucket(lum(hex)) };
  }

  function computeWithConfig(layout, layersDef, playerImageEl, themeColors, config) {
    if (!layout || !layersDef || !playerImageEl) return null;
    const playerDef = layersDef.player;
    const playerG = layout.player;
    if (!playerDef || !playerG || !config) return null;

    const canvas = document.createElement("canvas");
    canvas.width = SW;
    canvas.height = SH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, SW, SH);
    drawPlayer(ctx, playerDef, playerG, playerImageEl);
    config.drawDeco?.(ctx);

    const out = {};
    for (const id of config.layers) {
      const def = layersDef[id];
      const g = layout[id];
      if (!def || !g || g.hidden) continue;
      const box = layerBox(g, def);
      const sample = sampleRect(ctx, box.left, box.top, box.w, box.h);
      if (!sample) continue;
      out[id] = resolveLayerColor(id, sample.bucket, sample.hex, themeColors, config.colorMap);
    }
    return Object.keys(out).length ? out : null;
  }

  function compute(layout, layersDef, playerImageEl, themeColors) {
    return computeWithConfig(layout, layersDef, playerImageEl, themeColors, {
      layers: HEADER_LAYERS,
      colorMap: MAGAZINE_HEADER_COLOR_MAP,
      drawDeco: drawMagazineDeco,
    });
  }

  function computeSalukisDark(layout, layersDef, playerImageEl, themeColors) {
    return computeWithConfig(layout, layersDef, playerImageEl, themeColors, {
      layers: SALUKIS_DARK_HEADER_LAYERS,
      colorMap: SALUKIS_DARK_HEADER_COLOR_MAP,
      drawDeco: drawSalukisDarkDeco,
    });
  }

  global.PosterMagazineHeaderColors = {
    compute,
    computeSalukisDark,
    MAGAZINE_HEADER_COLOR_MAP,
    SALUKIS_DARK_HEADER_COLOR_MAP,
    HEADER_LAYERS,
    SALUKIS_DARK_HEADER_LAYERS,
  };
})(typeof window !== "undefined" ? window : globalThis);
