/**
 * Extract Magazine text palette from a player photo using ColorThief (with bucket fallback).
 */
(function (global) {
  "use strict";

  const PHOTO_BG = "#141414";
  let _colorThiefMod = null;
  let _colorThiefLoad = null;

  function hexToRgb(hex) {
    let h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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

  function toHexC(o) {
    const r = o.r ?? o[0];
    const g = o.g ?? o[1];
    const b = o.b ?? o[2];
    return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
  }

  function colorToHex(c) {
    if (!c) return null;
    if (typeof c === "string") return c;
    if (typeof c.hex === "function") return c.hex();
    if (Array.isArray(c)) return toHexC(c);
    if (c.r != null) return toHexC(c);
    return null;
  }

  function uniqHexes(list) {
    const out = [];
    const seen = new Set();
    for (const item of list) {
      const hex = colorToHex(item);
      if (!hex || seen.has(hex.toLowerCase())) continue;
      seen.add(hex.toLowerCase());
      out.push(hex);
    }
    return out;
  }

  function loadColorThief() {
    if (_colorThiefMod) return Promise.resolve(_colorThiefMod);
    if (_colorThiefLoad) return _colorThiefLoad;
    _colorThiefLoad = import("https://esm.sh/colorthief")
      .then((mod) => {
        _colorThiefMod = mod;
        return mod;
      })
      .catch((err) => {
        console.warn("ColorThief load failed, using fallback extractor:", err);
        _colorThiefMod = null;
        return null;
      });
    return _colorThiefLoad;
  }

  function fallbackExtract(img) {
    const S = 72;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(img, 0, 0, S, S);
    let data;
    try {
      data = ctx.getImageData(0, 0, S, S).data;
    } catch (e) {
      return null;
    }
    const buckets = {};
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const k = (r >> 4) + "," + (g >> 4) + "," + (b >> 4);
      const bk = buckets[k] || (buckets[k] = { n: 0, r: 0, g: 0, b: 0 });
      bk.n++;
      bk.r += r;
      bk.g += g;
      bk.b += b;
    }
    const arr = Object.values(buckets).map((bk) => {
      const r = Math.round(bk.r / bk.n);
      const g = Math.round(bk.g / bk.n);
      const b = Math.round(bk.b / bk.n);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      return { n: bk.n, r, g, b, sat: mx ? (mx - mn) / mx : 0, lum: (0.299 * r + 0.587 * g + 0.114 * b) / 255 };
    });
    if (!arr.length) return null;
    arr.sort((a, b) => b.n - a.n);
    const dist = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
    const colorful = arr.filter((o) => o.sat > 0.22 && o.lum > 0.07 && o.lum < 0.96);
    const primary = colorful[0] || arr[0];
    let secondary =
      colorful.find((o) => o !== primary && dist(o, primary) > 120) ||
      arr.find((o) => o !== primary && dist(o, primary) > 140);
    if (!secondary) secondary = primary.lum < 0.5 ? { r: 255, g: 255, b: 255 } : { r: 17, g: 17, b: 17 };
    return {
      palette: uniqHexes([primary, secondary, ...arr.slice(0, 6).map(toHexC)]),
      swatches: { Vibrant: toHexC(primary), Muted: toHexC(secondary) },
    };
  }

  async function extractFromImage(img) {
    const mod = await loadColorThief();
    if (mod) {
      try {
        const { getPalette, getSwatches } = mod;
        const paletteRaw = await getPalette(img, { colorCount: 6, quality: 10 });
        const swatchesRaw = await getSwatches(img);
        const palette = uniqHexes((paletteRaw || []).map(colorToHex));
        if (!palette.length) return fallbackExtract(img);
        const swatches = {};
        if (swatchesRaw) {
          for (const [name, entry] of Object.entries(swatchesRaw)) {
            const hex = colorToHex(entry?.color ?? entry);
            if (hex) swatches[name] = hex;
          }
        }
        return { palette, swatches };
      } catch (e) {
        console.warn("ColorThief extraction failed, using fallback:", e);
      }
    }
    return fallbackExtract(img);
  }

  function mapMagazinePalette(extracted) {
    if (!extracted || !extracted.palette?.length) return null;
    const { palette, swatches = {} } = extracted;
    const primary = swatches.Vibrant || palette[0];
    const secondary = palette[1] || swatches.Muted || palette[0];
    const onPhoto = pickReadable(
      [...palette, swatches.LightVibrant, swatches.Vibrant, "#FFFFFF", "#F5F5F5"],
      PHOTO_BG,
      4.5
    );
    const onPhotoMuted = pickReadable(
      [secondary, ...palette, swatches.Muted, onPhoto],
      PHOTO_BG,
      3
    );
    const calloutBg = primary;
    const onCallout = pickReadable([onPhoto, secondary, ...palette, "#FFFFFF", "#111111"], calloutBg, 3);

    return {
      primary,
      secondary,
      onPhoto,
      onPhotoMuted,
      calloutBg,
      onCallout,
    };
  }

  async function applyFromPlayer(imgEl) {
    if (!imgEl) return null;
    const extracted = await extractFromImage(imgEl);
    return mapMagazinePalette(extracted);
  }

  global.PosterPhotoPalette = {
    applyFromPlayer,
    mapMagazinePalette,
    extractFromImage,
    pickReadable,
    onColor,
    lum,
  };
})(typeof window !== "undefined" ? window : globalThis);
