/*
 * UI wiring and rendering for the hearth tiling simulator. Depends on layout.js.
 */
(() => {
  'use strict';

  const GROUP_NAMES = { hearth: 'Hearth', tile: 'Tile', grout: 'Grout' };

  // Defaults give an exact 12 × 4 fit with flush edges, so the app starts in the valid state.
  const PARAMS = [
    { key: 'hearthW', group: 'hearth', label: 'Width (↔)', min: 100, max: 3000, step: 1, value: 1255, allowZero: false },
    { key: 'hearthD', group: 'hearth', label: 'Depth (↕)', min: 100, max: 2000, step: 1, value: 415, allowZero: false },
    { key: 'tileW', group: 'tile', label: 'Width (↔)', min: 10, max: 1200, step: 1, value: 100, allowZero: false },
    { key: 'tileD', group: 'tile', label: 'Depth (↕)', min: 10, max: 1200, step: 1, value: 100, allowZero: false },
    { key: 'gapX', group: 'grout', label: 'Gap between columns (↔)', min: 0, max: 20, step: 0.5, value: 5, allowZero: true },
    { key: 'gapY', group: 'grout', label: 'Gap between rows (↕)', min: 0, max: 20, step: 0.5, value: 5, allowZero: true },
  ];

  // Upper bound on rectangles drawn, so absurd inputs cannot freeze the page.
  const MAX_DRAWN = 40000;

  const state = { border: false };
  const controls = {}; // key -> { def, slider, num }

  const $ = (id) => document.getElementById(id);
  const els = {
    border: $('border'),
    summary: $('summary'),
    issues: $('issues'),
    view: $('view'),
    hearth: $('hearth'),
    tiles: $('tiles'),
    ghosts: $('ghosts'),
    labelW: $('label-w'),
    labelD: $('label-d'),
  };

  // ---------- Number helpers ----------

  const round = (n, places) => {
    const f = 10 ** places;
    const r = Math.round(n * f) / f;
    return Object.is(r, -0) ? 0 : r;
  };
  const fmtInput = (n) => String(round(n, 6)); // number boxes: keep typed precision
  const fmtMm = (n) => String(round(n, 2)); // human-readable readouts
  const r3 = (n) => round(n, 3); // SVG coordinates

  function parseValue(str, allowZero) {
    if (str.trim() === '') return null;
    const n = Number(str);
    if (!Number.isFinite(n) || n < 0 || (n === 0 && !allowZero)) return null;
    return n;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // ---------- Controls ----------

  function buildControls() {
    for (const def of PARAMS) {
      const id = `in-${def.key}`;
      const name = `${GROUP_NAMES[def.group]} ${def.label}`;

      const row = document.createElement('div');
      row.className = 'param';
      row.innerHTML = `
        <label for="${id}">${def.label}</label>
        <input type="range" min="${def.min}" max="${def.max}" step="${def.step}"
               aria-label="${name} slider">
        <input type="number" id="${id}" min="0" step="any" inputmode="decimal">
        <span class="unit">mm</span>`;
      document.querySelector(`[data-group="${def.group}"] .rows`).appendChild(row);

      const slider = row.querySelector('input[type="range"]');
      const num = row.querySelector('input[type="number"]');
      controls[def.key] = { def, slider, num };

      state[def.key] = def.value;
      slider.value = def.value;
      num.value = fmtInput(def.value);

      slider.addEventListener('input', () => setValue(def.key, Number(slider.value), 'slider'));

      num.addEventListener('input', () => {
        const v = parseValue(num.value, def.allowZero);
        num.classList.toggle('error', v === null);
        if (v !== null) setValue(def.key, v, 'number');
      });

      // On blur / Enter, an invalid entry reverts to the last good value.
      num.addEventListener('change', () => {
        if (parseValue(num.value, def.allowZero) === null) {
          num.value = fmtInput(state[def.key]);
          num.classList.remove('error');
        }
      });

      // Arrow keys step by the slider step (Shift = ×10) instead of the browser default of 1.
      num.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const delta = (e.key === 'ArrowUp' ? 1 : -1) * def.step * (e.shiftKey ? 10 : 1);
        const floor = def.allowZero ? 0 : def.step;
        setValue(def.key, Math.max(floor, round(state[def.key] + delta, 6)), 'key');
      });
    }

    els.border.checked = state.border;
    els.border.addEventListener('change', () => {
      state.border = els.border.checked;
      render();
    });
  }

  function setValue(key, v, source) {
    const { def, slider, num } = controls[key];
    state[key] = v;

    // Widen the slider range when a typed value falls outside it.
    if (v > Number(slider.max)) {
      slider.max = Math.ceil(v / def.step) * def.step;
    }
    if (v < Number(slider.min)) {
      const floor = def.allowZero ? 0 : def.step;
      slider.min = Math.max(floor, Math.floor(v / def.step) * def.step);
    }

    if (source !== 'slider') slider.value = v;
    if (source !== 'number') {
      num.value = fmtInput(v);
      num.classList.remove('error');
    }
    render();
  }

  // ---------- Rendering ----------

  function axisIssue(name, unit, axis, tile, gap) {
    if (axis.valid) return null;
    if (axis.count === 0) {
      const need = state.border ? tile + 2 * gap : tile;
      return `${name}: no whole tile fits (one ${unit} needs ${fmtMm(need)} mm).`;
    }
    const left = round(axis.leftover, 2) > 0 ? `${fmtMm(axis.leftover)} mm` : '< 0.01 mm';
    return `${name}: ${left} left over, not enough for another whole ${unit} plus grout, so it is omitted.`;
  }

  function render() {
    const layout = TilingLayout.computeLayout(state);
    const { x, y } = layout;
    const W = state.hearthW;
    const D = state.hearthD;

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

    // Tiles, plus one extra ghost column/row on each axis that does not fit exactly.
    const nCols = x.count + (x.valid ? 0 : 1);
    const nRows = y.count + (y.valid ? 0 : 1);
    const drawable = nCols * nRows <= MAX_DRAWN;
    let tilesPath = '';
    let ghostsPath = '';
    if (drawable) {
      const tw = r3(state.tileW);
      const th = r3(state.tileD);
      const shape = `h${tw}v${th}h${-tw}z`;
      const tiles = [];
      const ghosts = [];
      for (let j = 0; j < nRows; j++) {
        const py = r3(y.start + j * y.step);
        for (let i = 0; i < nCols; i++) {
          const px = r3(x.start + i * x.step);
          (i < x.count && j < y.count ? tiles : ghosts).push(`M${px} ${py}${shape}`);
        }
      }
      tilesPath = tiles.join('');
      ghostsPath = ghosts.join('');
    }
    els.tiles.setAttribute('d', tilesPath);
    els.ghosts.setAttribute('d', ghostsPath);

    // Status readout.
    const counts = `${plural(x.count, 'column')} × ${plural(y.count, 'row')} = ${plural(layout.total, 'tile')}`;
    els.summary.textContent = layout.valid ? `Exact fit: ${counts}` : `Not an exact fit: ${counts} placed`;

    const issues = [
      axisIssue('Width', 'column', x, state.tileW, state.gapX),
      axisIssue('Depth', 'row', y, state.tileD, state.gapY),
    ].filter(Boolean);
    if (!drawable) {
      issues.push(`Preview hidden: too many tiles to draw (${nCols * nRows}).`);
    }
    els.issues.replaceChildren(
      ...issues.map((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      }),
    );

    document.body.classList.toggle('invalid', !layout.valid);
  }

  buildControls();
  render();
})();
