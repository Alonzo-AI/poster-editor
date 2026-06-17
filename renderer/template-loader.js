/**
 * Loads poster templates from JSON and merges authoring layout overrides.
 * Patches window.TEMPLATES after inline definitions in index_2.html.
 */
(function (global) {
  "use strict";

  const JSON_TEMPLATE_IDS = ["magazine", "vapor_motion", "salukis_clean", "salukis_dark"];
  const FONT_KEYS = {
    disp: "'Anton',sans-serif",
    cond: "'Oswald',sans-serif",
    sans: "'Archivo',sans-serif",
    bebas: "'Bebas Neue',sans-serif",
    serif: "'Playfair Display',serif",
    chalk: "'Permanent Marker',cursive",
    type: "'Special Elite',monospace",
    comic: "'Bangers',cursive",
  };

  function resolveFont(v) {
    if (!v) return undefined;
    return FONT_KEYS[v] || v;
  }

  function interpolate(str, colors) {
    if (!str) return "";
    const c = colors || { primary: "#9D2235", secondary: "#FFFFFF" };
    const contrast = c.contrast || "#0b111e";
    const onPrimary = c.onPrimary || "#FFFFFF";
    const onPrimaryMuted = c.onPrimaryMuted || onPrimary;
    const calloutBg = c.calloutBg || "#FFFFFF";
    const onCallout = c.onCallout || c.primary || "#9D2235";
    return String(str)
      .replace(/\{\{primary\}\}/g, c.primary)
      .replace(/\{\{secondary\}\}/g, c.secondary)
      .replace(/\{\{contrast\}\}/g, contrast)
      .replace(/\{\{onPrimary\}\}/g, onPrimary)
      .replace(/\{\{onPrimaryMuted\}\}/g, onPrimaryMuted)
      .replace(/\{\{calloutBg\}\}/g, calloutBg)
      .replace(/\{\{onCallout\}\}/g, onCallout);
  }

  function salukisCleanStatSlots(rules) {
    const top = rules?.top ?? 230;
    const bottom = rules?.bottom ?? 1170;
    const span = bottom - top;
    const n = 3;
    const baseH = Math.floor(span / n);
    return [0, 1, 2].map((i) => ({
      y: top + i * baseH,
      h: i === n - 1 ? span - i * baseH : baseH,
    }));
  }

  /** Even vertical bands inside the vapor glass card (header / stats / footer). */
  function vaporMotionCardSlots(rules) {
    const cardX = rules?.cardX ?? 60;
    const cardY = rules?.cardY ?? 740;
    const cardW = rules?.cardW ?? 960;
    const cardH = rules?.cardH ?? 440;
    const pad = rules?.padding ?? 24;
    const rowHeights = rules?.rowHeights ?? [108, 76, 76, 40];
    const [headerH, statsTopH, statsBottomH, footerH] = rowHeights;
    const gap = rules?.rowGap ?? 6;
    const contentTop = cardY + pad;
    const header = { y: contentTop, h: headerH };
    const statsTop = { y: header.y + header.h + gap, h: statsTopH };
    const statsBottom = { y: statsTop.y + statsTop.h + gap, h: statsBottomH };
    const footer = {
      y: statsBottom.y + statsBottom.h + gap,
      h: footerH,
    };
    const leftX = cardX + 40;
    const midX = cardX + 150;
    const rightX = cardX + Math.round(cardW * 0.52);
    const colW = Math.round(cardW * 0.42);
    return {
      card: { x: cardX, y: cardY, w: cardW, h: cardH },
      header,
      statsTop,
      statsBottom,
      footer,
      leftX,
      midX,
      rightX,
      colW,
      innerW: cardW - 80,
    };
  }

  function applyVaporMotionLayout(layer, id, slots) {
    const { card, header, statsTop, statsBottom, footer, leftX, midX, rightX, colW, innerW } = slots;
    switch (id) {
      case "glassCard":
        Object.assign(layer, card);
        break;
      case "logo":
        Object.assign(layer, { x: leftX, y: header.y + 6, w: 88, h: 88 });
        break;
      case "eyebrow":
        Object.assign(layer, { x: midX, y: header.y + 4, w: colW });
        break;
      case "playerName":
        Object.assign(layer, { x: midX, y: header.y + 30, w: colW, size: 50 });
        break;
      case "playerMeta":
        Object.assign(layer, { x: midX + 4, y: header.y + 80, w: colW, size: 20 });
        break;
      case "hero":
        Object.assign(layer, {
          x: rightX + 40,
          y: header.y - 2,
          w: card.w - (rightX - card.x) - 40,
          h: Math.round(header.h * 0.92),
          size: 118,
        });
        break;
      case "heroDesc":
        Object.assign(layer, {
          x: rightX,
          y: header.y + Math.round(header.h * 0.62),
          w: card.w - (rightX - card.x) - 40,
          h: Math.round(header.h * 0.38),
          size: 17,
        });
        break;
      case "stat1":
        Object.assign(layer, { x: leftX, y: statsTop.y + 2, w: colW, h: statsTop.h - 4 });
        break;
      case "stat3":
        Object.assign(layer, { x: rightX, y: statsTop.y + 2, w: colW, h: statsTop.h - 4 });
        break;
      case "stat2":
        Object.assign(layer, { x: leftX, y: statsBottom.y + 2, w: colW, h: statsBottom.h - 4 });
        break;
      case "callout":
        Object.assign(layer, {
          x: rightX,
          y: statsBottom.y + 4,
          w: colW,
          h: statsBottom.h - 8,
          size: 20,
        });
        break;
      case "footer":
        Object.assign(layer, {
          x: card.x,
          y: footer.y,
          w: innerW + 80,
          h: footer.h,
          size: 16,
        });
        break;
      default:
        break;
    }
    return layer;
  }

  function salukisDarkPanelSlots(rules, canvasH) {
    const panelH = rules?.panelHeight ?? 318;
    const top = rules?.panelTop ?? canvasH - panelH;
    let statsH;
    let calloutH;
    let footerH;
    const rowHeights = rules?.rowHeights;
    if (rowHeights?.length === 3) {
      [statsH, calloutH, footerH] = rowHeights;
    } else {
      const baseH = Math.floor(panelH / 3);
      statsH = baseH;
      calloutH = baseH;
      footerH = panelH - 2 * baseH;
    }
    const stats = { y: top, h: statsH };
    const callout = { y: top + statsH, h: calloutH };
    const footer = { y: top + statsH + calloutH, h: footerH };
    const boxH = rules?.calloutBoxHeight ?? 64;
    const boxW = rules?.calloutBoxWidth ?? 896;
    const canvasW = rules?.canvasWidth ?? 1080;
    const calloutBox = {
      x: Math.round((canvasW - boxW) / 2),
      y: callout.y + Math.round((callout.h - boxH) / 2),
      w: boxW,
      h: boxH,
    };
    return { stats, callout, footer, calloutBox };
  }

  function applyLayoutRules(layer, id, json) {
    const rules = json.layoutRules || {};
    if (json.id === "salukis_clean" && /^stat[123]$/.test(id)) {
      const idx = +id.replace("stat", "") - 1;
      const slots = salukisCleanStatSlots(rules.salukisCleanStatSlots);
      if (slots[idx]) {
        layer.y = slots[idx].y;
        layer.h = slots[idx].h;
      }
    }
    if (json.id === "vapor_motion") {
      const slots = vaporMotionCardSlots(rules.vaporGlassCard);
      applyVaporMotionLayout(layer, id, slots);
    }
    if (json.id === "salukis_dark") {
      const slots = salukisDarkPanelSlots(
        { ...rules.salukisDarkPanelSlots, canvasWidth: json.canvas?.width ?? 1080 },
        json.canvas?.height ?? 1350
      );
      if (id === "stat1" || id === "stat2" || id === "stat3") {
        layer.y = slots.stats.y;
        layer.h = slots.stats.h;
        if (id === "stat2") layer.x = 360;
        if (id === "stat3") layer.x = 720;
      }
      if (id === "calloutBox" || id === "callout") {
        Object.assign(layer, slots.calloutBox);
      }
      if (id === "footer") {
        layer.y = slots.footer.y;
        layer.h = slots.footer.h;
      }
    }
    return layer;
  }

  function applyPlayerImageSettings(layerObj, json) {
    const rules = json.authoring?.settings?.playerImage || json.settings?.playerImage;
    if (!rules || !layerObj.player) return;
    if (rules.fitToFrame) {
      const w = json.canvas?.width ?? 1080;
      const h = json.canvas?.height ?? 1350;
      Object.assign(layerObj.player, {
        x: 0,
        y: 0,
        w,
        h,
        fit: rules.fit || "cover",
        zoom: rules.zoom ?? 1,
        cropX: rules.cropX ?? 0.5,
        cropY: rules.cropY ?? 0.5,
      });
      return;
    }
    Object.assign(layerObj.player, {
      ...(rules.fit != null ? { fit: rules.fit } : {}),
      ...(rules.zoom != null ? { zoom: rules.zoom } : {}),
      ...(rules.cropX != null ? { cropX: rules.cropX } : {}),
      ...(rules.cropY != null ? { cropY: rules.cropY } : {}),
    });
  }

  function layersArrayToObject(layers, json) {
    const out = {};
    for (const raw of layers || []) {
      const { id, font, ...rest } = raw;
      if (!id) continue;
      const layer = applyLayoutRules({ ...rest, font: resolveFont(font) }, id, json);
      out[id] = layer;
    }
    applyPlayerImageSettings(out, json);
    return out;
  }

  function mergeAuthoringLayout(layers, authoring) {
    if (!authoring?.layers) return layers;
    const out = { ...layers };
    for (const [id, geo] of Object.entries(authoring.layers)) {
      if (!out[id]) continue;
      out[id] = { ...out[id], ...geo };
    }
    return out;
  }

  function toRuntimeTemplate(json, colors) {
    const layerObj = layersArrayToObject(json.layers, json);

    return {
      name: json.name,
      _json: json,
      stageBg() {
        const colors = global.state?.colors;
        if (global.state?.canvasOverride) {
          return interpolate(global.state.canvasOverride, colors);
        }
        const bg = json.canvas?.background || "#000";
        return interpolate(bg, colors || global.state?.colors);
      },
      deco() {
        let html = interpolate(json.deco?.html || "", colors || global.state?.colors);
        if (json.id === "salukis_dark" && html.includes("{{panelHeight}}")) {
          const h = json.layoutRules?.salukisDarkPanelSlots?.panelHeight ?? 318;
          html = html.replace(/\{\{panelHeight\}\}/g, String(h));
        }
        return html;
      },
      get layers() {
        const merged = mergeAuthoringLayout(layerObj, json.authoring);
        if (json.authoring?.layers && global.state?.layouts?.[json.id]) {
          return mergeAuthoringLayout(merged, { layers: global.state.layouts[json.id] });
        }
        return merged;
      },
    };
  }

  function applyTemplateSettings(json) {
    if (!global.state) return;
    const s = json.settings || {};
    const authS = json.authoring?.settings || {};
    const vapor = authS.vaporGlass || s.vaporGlass;
    const logo = authS.logo || s.logo;
    if (json.id === "vapor_motion" && vapor && global.vaporGlassSettingsOf) {
      const vg = { ...vapor };
      if (typeof vg.color === "string" && vg.color.includes("{{")) {
        vg.color = interpolate(vg.color, global.state?.colors);
      }
      Object.assign(global.vaporGlassSettingsOf(), vg);
    }
    if (logo && global.logoSettingsOf) {
      Object.assign(global.logoSettingsOf(json.id), logo);
    }
    if (json.authoring?.layers && global.state.layouts) {
      if (!global.state.layouts[json.id]) global.state.layouts[json.id] = {};
      const authLayers = json.authoring.layers;
      if (authLayers && Object.keys(authLayers).length) {
        Object.assign(global.state.layouts[json.id], JSON.parse(JSON.stringify(authLayers)));
      }
    }
  }

  async function loadTemplate(id, baseUrl, authoringBaseUrl) {
    const tplUrl = `${baseUrl}${id}.json`;
    const res = await fetch(tplUrl);
    if (!res.ok) throw new Error(`Template not found: ${tplUrl}`);
    const json = await res.json();
    try {
      const authRes = await fetch(`${authoringBaseUrl}${id}.json`);
      if (authRes.ok) {
        const auth = await authRes.json();
        json.authoring = auth;
      }
    } catch (_) { /* optional authoring */ }
    return json;
  }

  async function loadAll(options) {
    const baseUrl = options?.templatesUrl ?? "./templates/";
    const authoringBaseUrl = options?.authoringUrl ?? "./layouts/authoring/";
    const templates = global.TEMPLATES;
    if (!templates) throw new Error("TEMPLATES must be defined before PosterTemplateLoader.loadAll");

    for (const id of JSON_TEMPLATE_IDS) {
      const json = await loadTemplate(id, baseUrl, authoringBaseUrl);
      templates[id] = toRuntimeTemplate(json, global.state?.colors);
      applyTemplateSettings(json);
    }
    return JSON_TEMPLATE_IDS;
  }

  function getTextRules(templateId) {
    const t = global.TEMPLATES?.[templateId];
    return t?._json?.textRules || {};
  }

  function getTemplateSettings(templateId) {
    const t = global.TEMPLATES?.[templateId];
    return t?._json?.settings || {};
  }

  global.PosterTemplateLoader = {
    JSON_TEMPLATE_IDS,
    loadAll,
    loadTemplate,
    getTextRules,
    getTemplateSettings,
    interpolate,
    salukisCleanStatSlots,
    salukisDarkPanelSlots,
    vaporMotionCardSlots,
  };
})(typeof window !== "undefined" ? window : globalThis);
