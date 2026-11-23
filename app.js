/*
 * UI wiring and rendering for the hearth tiling simulator. Depends on layout.js.
 *
 * The hearth is divided into rectangular zones, each tiled separately with its own tile size and
 * grout gaps. Zones the user adds ("placed" zones) have a size and position of their own; the rest
 * of the hearth is cut into rectangular "surround" zones around them. With no placed zones, a
 * single surround zone covers the whole hearth.
 */
(() => {
  'use strict';

  const TL = TilingLayout;

  const GROUP_NAMES = { hearth: 'Hearth', placement: 'Zone', tile: 'Tile', grout: 'Grout' };

  // `scope` says where a value lives: on the hearth, on the selected zone ('zone'), or on the
  // selected zone when it is a placed zone ('placed'). `rows` names the container for its control.
  // Defaults give an exact 12 × 4 fit with flush edges, so the app starts in the valid state.
  // `axis` marks the grout gaps: while auto-balance is on they are locked, display the zone's
  // balanced gap for that axis, and use `balancedLabel`. `centre` marks the zone offsets: while
  // the zone is centred on that axis they are locked, display the centred offset, and use
  // `centredLabel`. Placed-zone sliders get their range from the hearth size.
  const PARAMS = [
    { key: 'hearthW', scope: 'hearth', rows: 'hearth', group: 'hearth', label: 'Width (↔)', min: 100, max: 3000, step: 1, value: 1255, allowZero: false },
    { key: 'hearthD', scope: 'hearth', rows: 'hearth', group: 'hearth', label: 'Depth (↕)', min: 100, max: 2000, step: 1, value: 415, allowZero: false },
    { key: 'zoneW', scope: 'placed', rows: 'size', group: 'placement', label: 'Width (↔)', min: 10, step: 0.5, allowZero: false },
    { key: 'zoneD', scope: 'placed', rows: 'size', group: 'placement', label: 'Depth (↕)', min: 10, step: 0.5, allowZero: false },
    { key: 'zoneX', scope: 'placed', rows: 'offset-x', group: 'placement', centre: 'x', label: 'From left edge (↔)', centredLabel: 'From left edge (↔), centred', min: 0, step: 0.5, allowZero: true },
    { key: 'zoneY', scope: 'placed', rows: 'offset-y', group: 'placement', centre: 'y', label: 'From top edge (↕)', centredLabel: 'From top edge (↕), centred', min: 0, step: 0.5, allowZero: true },
    { key: 'tileW', scope: 'zone', rows: 'tile', group: 'tile', label: 'Width (↔)', min: 10, max: 1200, step: 1, value: 100, allowZero: false },
    { key: 'tileD', scope: 'zone', rows: 'tile', group: 'tile', label: 'Depth (↕)', min: 10, max: 1200, step: 1, value: 100, allowZero: false },
    { key: 'gapX', scope: 'zone', rows: 'grout', group: 'grout', axis: 'x', label: 'Gap between columns (↔)', balancedLabel: 'Balanced gap between columns (↔)', min: 0, max: 20, step: 0.1, value: 5, allowZero: true },
    { key: 'gapY', scope: 'zone', rows: 'grout', group: 'grout', axis: 'y', label: 'Gap between rows (↕)', balancedLabel: 'Balanced gap between rows (↕)', min: 0, max: 20, step: 0.1, value: 5, allowZero: true },
  ];
  const GAP_PARAMS = PARAMS.filter((def) => def.axis);
  const OFFSET_PARAMS = PARAMS.filter((def) => def.centre);
  const ZONE_PARAMS = PARAMS.filter((def) => def.scope === 'zone');
  const DEFAULT_SETTINGS = Object.fromEntries(ZONE_PARAMS.map((def) => [def.key, def.value]));

  // Per axis of a placed zone: its size and offset keys, the matching hearth dimension, and the
  // centring flag (also the id of its checkbox in `els`).
  const AXES = {
    x: { size: 'zoneW', offset: 'zoneX', hearth: 'hearthW', centre: 'centreX' },
    y: { size: 'zoneD', offset: 'zoneY', hearth: 'hearthD', centre: 'centreY' },
  };

  // Upper bound on rectangles drawn, so absurd inputs cannot freeze the page.
  const MAX_DRAWN = 40000;

  // Delay before flagging an unparsable entry, so half-typed values like "1 1/" don't flash red.
  const ERROR_DELAY_MS = 700;

  // Zone settings objects hold tileW, tileD, gapX, gapY. While balancing, gapX/gapY hold the
  // minimum gaps (the values when balancing was turned on); the controls show the balanced gaps
  // from the latest layout instead.
  const state = {
    border: false,
    balance: false,
    cut: 'rows',
    // { id, zoneW, zoneD, zoneX, zoneY, centreX, centreY, ...settings }
    placed: [],
    // { id, rect, ...settings }, re-cut on every render; settings follow the area they cover.
    surround: [],
    // null selects no zone (only possible with more than one zone).
    selectedId: null,
  };
  const controls = {}; // key -> { def, label, slider, num, errorTimer }

  // Zones from the latest render: { id, kind, obj, rect, name, badge, layout }.
  let zones = [];
  let syncedId = null; // zone whose values the zone controls currently show
  let selectedPoint = null; // centre of the selected zone, to pick a successor if it disappears
  let fallbackSettings = { ...DEFAULT_SETTINGS }; // for surround zones with no predecessor
  let nextId = 1;
  const listItems = new Map(); // zone id -> list item elements

  const $ = (id) => document.getElementById(id);
  const els = {
    border: $('border'),
    balance: $('balance'),
    zoneList: $('zone-list'),
    addZone: $('add-zone'),
    zoneTitle: $('zone-title'),
    zoneExtent: $('zone-extent'),
    zoneFields: $('zone-fields'),
    placement: $('placement'),
    centreX: $('centre-x'),
    centreY: $('centre-y'),
    removeZone: $('remove-zone'),
    apply: $('apply'),
    applyTile: $('apply-tile'),
    applyGaps: $('apply-gaps'),
    summary: $('summary'),
    details: $('details'),
    issues: $('issues'),
    view: $('view'),
    clips: $('clips'),
    hearth: $('hearth'),
    tiles: $('tiles'),
    ghosts: $('ghosts'),
    zoneSel: $('zone-sel'),
    zoneLabels: $('zone-labels'),
    zoneHits: $('zone-hits'),
    labelW: $('label-w'),
    labelD: $('label-d'),
    legendSel: $('legend-sel'),
  };

  // ---------- Helpers ----------

  const round = (n, places) => {
    const f = 10 ** places;
    const r = Math.round(n * f) / f;
    return Object.is(r, -0) ? 0 : r;
  };
  const fmtInput = (n) => String(round(n, 6)); // number boxes: keep typed precision
  const fmtMm = (n) => String(round(n, 2)); // human-readable readouts
  const r3 = (n) => round(n, 3); // SVG coordinates

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // 0 -> A, 25 -> Z, 26 -> AA, ...
  function letters(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    }
    return s;
  }

  const settingsOf = (obj) => Object.fromEntries(ZONE_PARAMS.map((def) => [def.key, obj[def.key]]));

  const contains = (r, p) =>
    p.x >= r.x - TL.EPS && p.x <= r.x + r.w + TL.EPS && p.y >= r.y - TL.EPS && p.y <= r.y + r.d + TL.EPS;
  const centreOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.d / 2 });

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, children = []) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.append(...children);
    return el;
  }

  // Next value on the step grid in direction `dir` (±1), moving `mult` steps. Off-grid values
  // (e.g. a balanced 9.0909) snap to the neighbouring grid point first: 9.1 up, 9.0 down.
  function stepValue(v, step, dir, mult) {
    const k = v / step;
    const base = dir > 0 ? Math.floor(k + 1e-9) : Math.ceil(k - 1e-9);
    return round((base + dir * mult) * step, 6);
  }

  const selectedZone = () => zones.find((z) => z.id === state.selectedId);

  // The object a parameter's value is stored on: the hearth state or the selected zone.
  const owner = (def) => (def.scope === 'hearth' ? state : selectedZone()?.obj);

  // ---------- Controls ----------

  function buildControls() {
    for (const def of PARAMS) {
      const id = `in-${def.key}`;

      const row = document.createElement('div');
      row.className = 'param';
      row.innerHTML = `
        <label for="${id}"></label>
        <input type="range" min="${def.min}" max="${def.max ?? 1000}" step="${def.step}">
        <input type="text" id="${id}" inputmode="decimal" autocomplete="off" spellcheck="false">
        <span class="unit">mm</span>`;
      document.querySelector(`[data-rows="${def.rows}"]`).appendChild(row);

      const ctl = {
        def,
        label: row.querySelector('label'),
        slider: row.querySelector('input[type="range"]'),
        num: row.querySelector('input[type="text"]'),
        errorTimer: 0,
      };
      controls[def.key] = ctl;
      setLabel(ctl, def.label);
      const { slider, num } = ctl;

      // Zone values are filled in when a zone is selected.
      if (def.scope === 'hearth') {
        state[def.key] = def.value;
        slider.value = def.value;
        num.value = fmtInput(def.value);
      }

      slider.addEventListener('input', () => setValue(def.key, round(Number(slider.value), 6), 'slider'));

      num.addEventListener('input', () => {
        clearTimeout(ctl.errorTimer);
        const v = TL.parseLength(num.value, def.allowZero);
        if (v === null) {
          ctl.errorTimer = setTimeout(() => num.classList.add('error'), ERROR_DELAY_MS);
          return;
        }
        num.classList.remove('error');
        setValue(def.key, v, 'number');
      });

      // On blur / Enter, an invalid entry reverts to the last good value.
      num.addEventListener('change', () => {
        const obj = owner(def);
        if (obj && TL.parseLength(num.value, def.allowZero) === null) {
          clearTimeout(ctl.errorTimer);
          num.value = fmtInput(obj[def.key]);
          num.classList.remove('error');
        }
      });

      // Arrow keys step along the slider's step grid (Shift = ×10).
      num.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const next = stepValue(owner(def)[def.key], def.step, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1);
        const floor = def.allowZero ? 0 : def.step;
        setValue(def.key, Math.max(floor, next), 'key');
      });
    }

    els.border.checked = state.border;
    els.border.addEventListener('change', () => {
      state.border = els.border.checked;
      render();
    });

    els.balance.checked = state.balance;
    els.balance.addEventListener('change', () => {
      if (!els.balance.checked) {
        // Keep the balanced gaps (full precision), so manual tweaking starts from them.
        for (const z of zones) {
          z.obj.gapX = z.layout.x.gap;
          z.obj.gapY = z.layout.y.gap;
        }
        const sel = selectedZone();
        if (sel) for (const def of GAP_PARAMS) showValue(def.key, sel.obj[def.key]);
      }
      state.balance = els.balance.checked;
      applyModes();
      render();
    });

    for (const radio of document.querySelectorAll('input[name="cut"]')) {
      radio.checked = radio.value === state.cut;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        state.cut = radio.value;
        render();
      });
    }

    for (const [axis, a] of Object.entries(AXES)) {
      const box = els[a.centre];
      box.addEventListener('change', () => {
        const sel = selectedZone();
        if (!box.checked) {
          // Start manual positioning from where the centred zone is now.
          sel.obj[a.offset] = Math.max(0, round(sel.rect[axis], 6));
          showValue(a.offset, sel.obj[a.offset]);
        }
        sel.obj[a.centre] = box.checked;
        applyModes();
        render();
      });
    }

    els.addZone.addEventListener('click', addZone);

    els.removeZone.addEventListener('click', () => {
      state.placed = state.placed.filter((z) => z.id !== state.selectedId);
      // The selection passes to the zone that now covers the removed zone's centre.
      render();
      listItems.get(state.selectedId)?.button.focus();
    });

    // Clicking a zone selects it; clicking the selected zone again, or the preview outside the
    // hearth, selects none.
    els.zoneList.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-id]');
      if (button) toggleZone(button.dataset.id);
    });
    els.view.addEventListener('click', (e) => {
      const hit = e.target.closest('#zone-hits [data-id]');
      toggleZone(hit ? hit.dataset.id : null);
    });

    els.applyTile.addEventListener('click', () => {
      const src = selectedZone().obj;
      for (const z of zones) {
        z.obj.tileW = src.tileW;
        z.obj.tileD = src.tileD;
      }
      render();
    });
    els.applyGaps.addEventListener('click', () => {
      const src = selectedZone().obj;
      for (const z of zones) {
        z.obj.gapX = src.gapX;
        z.obj.gapY = src.gapY;
      }
      render();
    });
  }

  function setLabel(ctl, text) {
    ctl.label.textContent = text;
    ctl.slider.setAttribute('aria-label', `${GROUP_NAMES[ctl.def.group]} ${text} slider`);
  }

  // Lock/unlock controls whose values are derived (balanced gaps, centred offsets) and switch
  // their labels to match.
  function applyModes() {
    const sel = selectedZone();
    for (const def of GAP_PARAMS) {
      const ctl = controls[def.key];
      setLabel(ctl, state.balance ? def.balancedLabel : def.label);
      ctl.slider.disabled = state.balance;
      ctl.num.disabled = state.balance;
    }
    for (const def of OFFSET_PARAMS) {
      const ctl = controls[def.key];
      const centred = Boolean(sel && sel.kind === 'placed' && sel.obj[AXES[def.centre].centre]);
      setLabel(ctl, centred ? def.centredLabel : def.label);
      ctl.slider.disabled = centred;
      ctl.num.disabled = centred;
    }
    els.applyGaps.disabled = state.balance;
    els.applyGaps.title = state.balance ? 'Turn off auto-balance to copy gaps between zones' : '';
  }

  function setValue(key, v, source) {
    const { def } = controls[key];
    const obj = owner(def);
    obj[key] = v;
    showValue(key, v, source);
    if (key === 'zoneW' || key === 'zoneD') keepInside(obj, key);
    render();
  }

  // Growing a zone that is not centred pushes it back from the far edge, as far as it fits.
  function keepInside(z, sizeKey) {
    for (const a of Object.values(AXES)) {
      if (a.size !== sizeKey || z[a.centre]) continue;
      const max = Math.max(0, state[a.hearth] - z[a.size]);
      if (z[a.offset] > max) {
        z[a.offset] = round(max, 6);
        showValue(a.offset, z[a.offset]);
      }
    }
  }

  // Show `v` in a parameter's slider and text box (skipping whichever one `source` names, since
  // it already holds the value). Does not change state.
  function showValue(key, v, source) {
    const ctl = controls[key];
    const { def, slider, num } = ctl;

    // Widen the slider range when the value falls outside it. Placed-zone sliders keep the range
    // the hearth gives them, so they cannot drag a zone out of it.
    if (v > Number(slider.max) && def.scope !== 'placed') {
      slider.max = round(Math.ceil(v / def.step) * def.step, 6);
    }
    if (v < Number(slider.min)) {
      const floor = def.allowZero ? 0 : def.step;
      slider.min = round(Math.max(floor, Math.floor(v / def.step) * def.step), 6);
    }

    if (source !== 'slider') slider.value = v;
    if (source !== 'number') {
      clearTimeout(ctl.errorTimer);
      num.value = fmtInput(v);
      num.classList.remove('error');
    }
  }

  // Load the selected zone's values into the zone controls.
  function syncZoneControls(sel) {
    syncedId = sel.id;
    const placed = sel.kind === 'placed';
    els.placement.hidden = !placed;
    if (placed) {
      els.centreX.checked = sel.obj.centreX;
      els.centreY.checked = sel.obj.centreY;
    }
    for (const def of PARAMS) {
      if (def.scope === 'zone' || (def.scope === 'placed' && placed)) showValue(def.key, sel.obj[def.key]);
    }
    applyModes();
  }

  // Slider ranges and centred offsets of the selected placed zone follow the hearth and the zone.
  function syncPlacement(sel) {
    const z = sel.obj;
    for (const [axis, a] of Object.entries(AXES)) {
      const length = state[a.hearth];
      const size = controls[a.size].slider;
      const offset = controls[a.offset].slider;
      size.max = r3(length);
      offset.max = r3(Math.max(0, length - z[a.size]));
      // Re-set the values, as the browser clamps them when the range shrinks.
      size.value = z[a.size];
      if (z[a.centre]) showValue(a.offset, sel.rect[axis]);
      else offset.value = z[a.offset];
    }
  }

  // ---------- Zones ----------

  function selectZone(id) {
    state.selectedId = id;
    render();
  }

  // Select a zone, or none if it is already selected (or `id` is null). A lone zone stays selected.
  function toggleZone(id) {
    const next = id === state.selectedId ? null : id;
    if (next === null && zones.length < 2) return;
    selectZone(next);
  }

  // Replace the surround zones with the new cut, carrying ids and settings over by overlap.
  function reconcileSurround(rects) {
    const old = state.surround;
    const matches = TL.matchRects(old.map((p) => p.rect), rects);
    state.surround = rects.map((rect, i) => {
      const { keep, from } = matches[i];
      if (keep >= 0) {
        old[keep].rect = rect;
        return old[keep];
      }
      const src = from >= 0 ? old[from] : fallbackSettings;
      return { id: `s${nextId++}`, rect, ...settingsOf(src) };
    });
    if (state.surround.length) fallbackSettings = settingsOf(state.surround[0]);
  }

  // Add a zone cut from the surround zone at the hearth centre, centred on the hearth. If a zone
  // already covers the centre, cut it from the middle of the largest surround zone instead. The
  // new zone takes that zone's tile and grout, and a size that keeps an exact fit exact.
  function addZone() {
    const W = state.hearthW;
    const D = state.hearthD;
    const centre = { x: W / 2, y: D / 2 };
    const surround = zones.filter((z) => z.kind === 'surround');
    const centreFree = !zones.some((z) => z.kind === 'placed' && contains(z.rect, centre));
    const host = centreFree
      ? surround.find((z) => contains(z.rect, centre))
      : surround.reduce((best, z) => (!best || z.rect.w * z.rect.d > best.rect.w * best.rect.d ? z : best), null);

    const settings = settingsOf((host ?? selectedZone() ?? zones[0]).obj);
    const area = host ? host.rect : { x: 0, y: 0, w: W, d: D };
    const length = (axis, extent, tile) =>
      host
        ? TL.suggestZoneLength(area[extent], host.layout[axis].count, settings[tile], host.layout[axis].gap)
        : round(area[extent] / 2, 0);
    const zoneW = length('x', 'w', 'tileW');
    const zoneD = length('y', 'd', 'tileD');
    const zoneX = round(area.x + (area.w - zoneW) / 2, 6);
    const zoneY = round(area.y + (area.d - zoneD) / 2, 6);

    const zone = {
      id: `z${nextId++}`,
      zoneW,
      zoneD,
      zoneX,
      zoneY,
      centreX: Math.abs(zoneX - (W - zoneW) / 2) < TL.EPS,
      centreY: Math.abs(zoneY - (D - zoneD) / 2) < TL.EPS,
      ...settings,
    };
    state.placed.push(zone);
    selectZone(zone.id);
  }

  // Problems with where placed zones sit: past the hearth edge, or overlapping each other.
  function geometryIssues(W, D) {
    const issues = [];
    const bad = new Set();
    const placed = zones.filter((z) => z.kind === 'placed');
    for (const z of placed) {
      const r = z.rect;
      const over = Math.max(-r.x, -r.y, r.x + r.w - W, r.y + r.d - D);
      if (over > TL.EPS) {
        issues.push(`${z.name} extends ${fmtMm(over)} mm past the hearth edge.`);
        bad.add(z.id);
      }
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (TL.overlapArea(placed[i].rect, placed[j].rect) > TL.EPS) {
          issues.push(`${placed[i].name} and ${placed[j].name} overlap.`);
          bad.add(placed[i].id);
          bad.add(placed[j].id);
        }
      }
    }
    return { issues, bad };
  }

  // ---------- Rendering ----------

  function axisIssue(name, unit, axis, tile, gap) {
    if (axis.valid) return null;
    if (axis.count === 0) {
      const need = tile + (axis.ends[0] + axis.ends[1]) * gap;
      return `${name}: no whole tile fits (one ${unit} needs ${fmtMm(need)} mm).`;
    }
    const left = round(axis.leftover, 2) > 0 ? `${fmtMm(axis.leftover)} mm` : '< 0.01 mm';
    if (state.balance && axis.gapUnits === 0) {
      return `${name}: ${left} left over, and with a single flush ${unit} there are no grout gaps to spread it across.`;
    }
    return `${name}: ${left} left over, not enough for another whole ${unit} plus grout, so it is omitted.`;
  }

  function render() {
    const W = state.hearthW;
    const D = state.hearthD;

    const placedRects = state.placed.map((z) => TL.placeZone(z, W, D));
    reconcileSurround(TL.cutSurround(W, D, placedRects, state.cut));
    const hasPlaced = state.placed.length > 0;
    zones = [
      ...state.surround.map((p, i) => ({
        id: p.id,
        kind: 'surround',
        obj: p,
        rect: p.rect,
        badge: letters(i),
        name: hasPlaced ? `Surround ${letters(i)}` : 'Whole hearth',
      })),
      ...state.placed.map((z, i) => ({
        id: z.id,
        kind: 'placed',
        obj: z,
        rect: placedRects[i],
        badge: String(i + 1),
        name: `Zone ${i + 1}`,
      })),
    ];
    for (const z of zones) {
      z.layout = TL.layoutZone(z.rect, z.obj, W, D, state.border, state.balance);
    }
    const multi = zones.length > 1;

    // A selected zone that was cut away passes the selection to the zone now covering its centre.
    // A lone zone is always selected.
    let sel = selectedZone();
    if (!sel && (state.selectedId !== null || !multi)) {
      sel = (selectedPoint && zones.find((z) => contains(z.rect, selectedPoint))) || zones[0];
      state.selectedId = sel.id;
    }
    if (sel) {
      selectedPoint = centreOf(sel.rect);
      if (sel.id !== syncedId) syncZoneControls(sel);
      if (state.balance) {
        for (const def of GAP_PARAMS) showValue(def.key, sel.layout[def.axis].gap);
      }
      if (sel.kind === 'placed') syncPlacement(sel);
    } else {
      syncedId = null; // reload the controls on the next selection, even of the same zone
    }

    els.zoneTitle.textContent = sel ? sel.name : 'No zone selected';
    els.zoneExtent.textContent = !sel
      ? 'Click a zone in the preview or pick one from the list to change its tile and grout.'
      : sel.kind === 'placed'
        ? ''
        : hasPlaced
          ? `${fmtMm(sel.rect.w)} × ${fmtMm(sel.rect.d)} mm, sized by the zones around it.`
          : 'Covers the whole hearth. Add a zone to tile part of it differently.';
    els.zoneExtent.hidden = sel?.kind === 'placed';
    els.zoneFields.hidden = !sel;
    els.apply.hidden = !multi;

    // View: hearth plus a fixed margin, so tile/grout changes never rescale the drawing.
    const pad = 0.08 * Math.max(W, D);
    els.view.setAttribute('viewBox', [-pad, -pad, W + 2 * pad, D + 2 * pad].map(r3).join(' '));
    els.hearth.setAttribute('width', r3(W));
    els.hearth.setAttribute('height', r3(D));

    // Dimension labels in the margin.
    const fontSize = r3(pad * 0.38);
    els.labelW.setAttribute('x', r3(W / 2));
    els.labelW.setAttribute('y', r3(-pad * 0.3));
    els.labelW.setAttribute('font-size', fontSize);
    els.labelW.textContent = `${fmtMm(W)} mm`;
    els.labelD.setAttribute('font-size', fontSize);
    els.labelD.setAttribute('transform', `translate(${r3(-pad * 0.3)} ${r3(D / 2)}) rotate(-90)`);
    els.labelD.textContent = `${fmtMm(D)} mm`;

    const { drawable, cells } = drawTiles(pad);
    drawZones(sel, multi, pad);

    const geom = geometryIssues(W, D);
    const valid = geom.issues.length === 0 && zones.every((z) => z.layout.valid);
    renderZoneList(sel, multi, geom.bad);

    // Status readout.
    const total = zones.reduce((n, z) => n + z.layout.total, 0);
    if (multi) {
      const where = `${plural(total, 'tile')} in ${zones.length} zones`;
      els.summary.textContent = valid ? `Exact fit: ${where}` : `Not an exact fit: ${where} placed`;
    } else {
      const { x, y } = zones[0].layout;
      const counts = `${plural(x.count, 'column')} × ${plural(y.count, 'row')} = ${plural(total, 'tile')}`;
      els.summary.textContent = valid ? `Exact fit: ${counts}` : `Not an exact fit: ${counts} placed`;
    }

    const details = [];
    if (multi) {
      const bySize = new Map();
      for (const z of zones) {
        if (z.layout.total === 0) continue;
        const size = `${fmtMm(z.obj.tileW)} × ${fmtMm(z.obj.tileD)} mm`;
        bySize.set(size, (bySize.get(size) ?? 0) + z.layout.total);
      }
      const list = [...bySize].map(([size, n]) => `${n} at ${size}`).join(', ');
      details.push(`Tiles needed: ${list || 'none'}.`);
    }
    if (state.balance && sel) {
      const gapText = (axis, units, min) =>
        axis.gapUnits > 0
          ? `${fmtMm(axis.gap)} mm between ${units} (min ${fmtMm(min)})`
          : `no gaps between ${units}`;
      const { x, y } = sel.layout;
      details.push(
        `Grout after balancing${multi ? ` in ${sel.name}` : ''}: ` +
          `${gapText(x, 'columns', sel.obj.gapX)}, ${gapText(y, 'rows', sel.obj.gapY)}.`,
      );
    }
    els.details.textContent = details.join('\n');

    const issues = [...geom.issues];
    for (const z of zones) {
      const prefix = multi ? `${z.name} ` : '';
      issues.push(
        axisIssue(multi ? `${prefix}width` : 'Width', 'column', z.layout.x, z.obj.tileW, z.obj.gapX),
        axisIssue(multi ? `${prefix}depth` : 'Depth', 'row', z.layout.y, z.obj.tileD, z.obj.gapY),
      );
    }
    if (!drawable) {
      issues.push(`Preview hidden: too many tiles to draw (${cells}).`);
    }
    els.issues.replaceChildren(
      ...issues.filter(Boolean).map((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      }),
    );

    document.body.classList.toggle('invalid', !valid);
  }

  // Tiles, plus one extra ghost column/row in each zone on each axis that does not fit exactly.
  function drawTiles(pad) {
    const grids = zones.map(({ layout: { x, y } }) => ({
      nCols: x.count + (x.valid ? 0 : 1),
      nRows: y.count + (y.valid ? 0 : 1),
    }));
    const cells = grids.reduce((n, g) => n + g.nCols * g.nRows, 0);
    const drawable = cells <= MAX_DRAWN;
    const tiles = [];
    const clips = [];
    const ghostPaths = [];
    if (drawable) {
      zones.forEach((z, k) => {
        const { x, y, edges } = z.layout;
        const { nCols, nRows } = grids[k];
        const r = z.rect;
        const tw = r3(z.obj.tileW);
        const th = r3(z.obj.tileD);
        const shape = `h${tw}v${th}h${-tw}z`;
        const ghosts = [];
        for (let j = 0; j < nRows; j++) {
          const py = r3(r.y + y.start + j * y.step);
          for (let i = 0; i < nCols; i++) {
            const px = r3(r.x + x.start + i * x.step);
            (i < x.count && j < y.count ? tiles : ghosts).push(`M${px} ${py}${shape}`);
          }
        }
        if (ghosts.length === 0) return;
        // Ghosts stay inside their zone, except past the hearth edge, where the overhang shows.
        const x0 = r.x - (edges.left ? pad : 0);
        const y0 = r.y - (edges.top ? pad : 0);
        const x1 = r.x + r.w + (edges.right ? pad : 0);
        const y1 = r.y + r.d + (edges.bottom ? pad : 0);
        const id = `clip-${z.id}`;
        clips.push(
          svgEl('clipPath', { id }, [
            svgEl('rect', { x: r3(x0), y: r3(y0), width: r3(x1 - x0), height: r3(y1 - y0) }),
          ]),
        );
        ghostPaths.push(svgEl('path', { d: ghosts.join(''), 'clip-path': `url(#${id})` }));
      });
    }
    els.tiles.setAttribute('d', tiles.join(''));
    els.clips.replaceChildren(...clips);
    els.ghosts.replaceChildren(...ghostPaths);
    return { drawable, cells };
  }

  // Selected-zone highlight, zone badges, and click targets for picking a zone.
  function drawZones(sel, multi, pad) {
    const rectAttrs = (r) => ({ x: r3(r.x), y: r3(r.y), width: r3(r.w), height: r3(r.d) });

    const showSel = Boolean(multi && sel);
    els.zoneSel.style.display = showSel ? '' : 'none';
    els.legendSel.hidden = !showSel;
    if (showSel) {
      for (const [k, v] of Object.entries(rectAttrs(sel.rect))) els.zoneSel.setAttribute(k, v);
    }

    // Badges match the zone list, and are left out of zones too small to hold them.
    const fs = pad * 0.3;
    const labels = [];
    const hits = [];
    if (multi) {
      for (const z of zones) {
        const r = z.rect;
        const bw = fs * (0.8 + 0.62 * z.badge.length);
        const bh = fs * 1.35;
        if (r.w > bw * 1.2 && r.d > bh * 1.2) {
          const c = centreOf(r);
          labels.push(
            svgEl('g', z.id === sel?.id ? { class: 'selected' } : {}, [
              svgEl('rect', { x: r3(c.x - bw / 2), y: r3(c.y - bh / 2), width: r3(bw), height: r3(bh), rx: r3(bh / 2) }),
              svgEl('text', {
                x: r3(c.x),
                y: r3(c.y),
                'font-size': r3(fs),
                'text-anchor': 'middle',
                'dominant-baseline': 'central',
              }, [z.badge]),
            ]),
          );
        }
        const title = z.id === sel?.id ? `${z.name} (click again to select none)` : z.name;
        hits.push(svgEl('rect', { ...rectAttrs(r), 'data-id': z.id }, [svgEl('title', {}, [title])]));
      }
    }
    els.zoneLabels.replaceChildren(...labels);
    els.zoneHits.replaceChildren(...hits);
  }

  function renderZoneList(sel, multi, bad) {
    els.zoneList.classList.toggle('single', !multi);
    const items = zones.map((z) => {
      let item = listItems.get(z.id);
      if (!item) {
        const li = document.createElement('li');
        li.innerHTML = `
          <button type="button" class="zone-item">
            <span class="zone-badge" aria-hidden="true"></span>
            <span class="zone-text"><span class="zone-name"></span><span class="zone-meta"></span></span>
            <span class="zone-mark"></span>
          </button>`;
        const button = li.querySelector('button');
        button.dataset.id = z.id;
        item = {
          li,
          button,
          badge: li.querySelector('.zone-badge'),
          name: li.querySelector('.zone-name'),
          meta: li.querySelector('.zone-meta'),
          mark: li.querySelector('.zone-mark'),
        };
        listItems.set(z.id, item);
      }
      const ok = z.layout.valid && !bad.has(z.id);
      item.badge.textContent = z.badge;
      item.name.textContent = z.name;
      item.meta.textContent =
        `${fmtMm(z.rect.w)} × ${fmtMm(z.rect.d)} mm · ` +
        `${plural(z.layout.total, 'tile')} of ${fmtMm(z.obj.tileW)} × ${fmtMm(z.obj.tileD)}`;
      item.mark.textContent = ok ? '✓' : '✗';
      item.mark.setAttribute('aria-label', ok ? 'exact fit' : 'not an exact fit');
      item.li.classList.toggle('bad', !ok);
      item.button.setAttribute('aria-pressed', String(z.id === sel?.id));
      return item.li;
    });
    for (const id of listItems.keys()) {
      if (!zones.some((z) => z.id === id)) listItems.delete(id);
    }
    // Only touch the list's children when they change, so a focused button keeps focus.
    const current = [...els.zoneList.children];
    if (current.length !== items.length || current.some((li, i) => li !== items[i])) {
      els.zoneList.replaceChildren(...items);
    }
  }

  buildControls();
  render();
})();
