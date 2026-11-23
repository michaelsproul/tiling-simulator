/*
 * UI wiring and rendering for the hearth tiling simulator. Depends on layout.js.
 */
(() => {
  'use strict';

  const GROUP_NAMES = { hearth: 'Hearth', tile: 'Tile', grout: 'Grout' };

  // Defaults give an exact 12 × 4 fit with flush edges, so the app starts in the valid state.
  // `axis` marks the grout gaps: while auto-balance is on they are locked, display the balanced
  // gap for that axis, and use `balancedLabel`.
  const PARAMS = [
    { key: 'hearthW', group: 'hearth', label: 'Width (↔)', min: 100, max: 3000, step: 1, value: 1255, allowZero: false },
    { key: 'hearthD', group: 'hearth', label: 'Depth (↕)', min: 100, max: 2000, step: 1, value: 415, allowZero: false },
    { key: 'tileW', group: 'tile', label: 'Width (↔)', min: 10, max: 1200, step: 1, value: 100, allowZero: false },
    { key: 'tileD', group: 'tile', label: 'Depth (↕)', min: 10, max: 1200, step: 1, value: 100, allowZero: false },
    { key: 'gapX', group: 'grout', axis: 'x', label: 'Gap between columns (↔)', balancedLabel: 'Balanced gap between columns (↔)', min: 0, max: 20, step: 0.1, value: 5, allowZero: true },
    { key: 'gapY', group: 'grout', axis: 'y', label: 'Gap between rows (↕)', balancedLabel: 'Balanced gap between rows (↕)', min: 0, max: 20, step: 0.1, value: 5, allowZero: true },
  ];
  const GAP_PARAMS = PARAMS.filter((def) => def.axis);

  // Upper bound on rectangles drawn, so absurd inputs cannot freeze the page.
  const MAX_DRAWN = 40000;

  // Delay before flagging an unparsable entry, so half-typed values like "1 1/" don't flash red.
  const ERROR_DELAY_MS = 700;

  // While balancing, state.gapX/gapY hold the minimum gaps (the values when balancing was turned
  // on); the controls show the balanced gaps from the latest layout instead.
  const state = { border: false, balance: false };
  const controls = {}; // key -> { def, label, slider, num, errorTimer }
  let lastLayout = null;

  const $ = (id) => document.getElementById(id);
  const els = {
    border: $('border'),
    balance: $('balance'),
    summary: $('summary'),
    details: $('details'),
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

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // Next value on the step grid in direction `dir` (±1), moving `mult` steps. Off-grid values
  // (e.g. a balanced 9.0909) snap to the neighbouring grid point first: 9.1 up, 9.0 down.
  function stepValue(v, step, dir, mult) {
    const k = v / step;
    const base = dir > 0 ? Math.floor(k + 1e-9) : Math.ceil(k - 1e-9);
    return round((base + dir * mult) * step, 6);
  }

  // ---------- Controls ----------

  function buildControls() {
    for (const def of PARAMS) {
      const id = `in-${def.key}`;

      const row = document.createElement('div');
      row.className = 'param';
      row.innerHTML = `
        <label for="${id}"></label>
        <input type="range" min="${def.min}" max="${def.max}" step="${def.step}">
        <input type="text" id="${id}" inputmode="decimal" autocomplete="off" spellcheck="false">
        <span class="unit">mm</span>`;
      document.querySelector(`[data-group="${def.group}"] .rows`).appendChild(row);

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

      state[def.key] = def.value;
      slider.value = def.value;
      num.value = fmtInput(def.value);

      slider.addEventListener('input', () => setValue(def.key, round(Number(slider.value), 6), 'slider'));

      num.addEventListener('input', () => {
        clearTimeout(ctl.errorTimer);
        const v = TilingLayout.parseLength(num.value, def.allowZero);
        if (v === null) {
          ctl.errorTimer = setTimeout(() => num.classList.add('error'), ERROR_DELAY_MS);
          return;
        }
        num.classList.remove('error');
        setValue(def.key, v, 'number');
      });

      // On blur / Enter, an invalid entry reverts to the last good value.
      num.addEventListener('change', () => {
        if (TilingLayout.parseLength(num.value, def.allowZero) === null) {
          clearTimeout(ctl.errorTimer);
          num.value = fmtInput(state[def.key]);
          num.classList.remove('error');
        }
      });

      // Arrow keys step along the slider's step grid (Shift = ×10).
      num.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const next = stepValue(state[def.key], def.step, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1);
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
      if (!els.balance.checked && lastLayout) {
        // Keep the balanced gaps (full precision), so manual tweaking starts from them.
        for (const def of GAP_PARAMS) {
          state[def.key] = lastLayout[def.axis].gap;
          showValue(def.key, state[def.key]);
        }
      }
      state.balance = els.balance.checked;
      applyBalanceMode();
      render();
    });

    applyBalanceMode();
  }

  function setLabel(ctl, text) {
    ctl.label.textContent = text;
    ctl.slider.setAttribute('aria-label', `${GROUP_NAMES[ctl.def.group]} ${text} slider`);
  }

  // Lock/unlock the gap controls and switch their labels for the current balance setting.
  function applyBalanceMode() {
    for (const def of GAP_PARAMS) {
      const ctl = controls[def.key];
      setLabel(ctl, state.balance ? def.balancedLabel : def.label);
      ctl.slider.disabled = state.balance;
      ctl.num.disabled = state.balance;
    }
  }

  function setValue(key, v, source) {
    state[key] = v;
    showValue(key, v, source);
    render();
  }

  // Show `v` in a parameter's slider and text box (skipping whichever one `source` names, since
  // it already holds the value). Does not change state.
  function showValue(key, v, source) {
    const ctl = controls[key];
    const { def, slider, num } = ctl;

    // Widen the slider range when the value falls outside it.
    if (v > Number(slider.max)) {
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

  // ---------- Rendering ----------

  function axisIssue(name, unit, axis, tile, gap) {
    if (axis.valid) return null;
    if (axis.count === 0) {
      const need = state.border ? tile + 2 * gap : tile;
      return `${name}: no whole tile fits (one ${unit} needs ${fmtMm(need)} mm).`;
    }
    const left = round(axis.leftover, 2) > 0 ? `${fmtMm(axis.leftover)} mm` : '< 0.01 mm';
    if (state.balance && axis.gapCount === 0) {
      return `${name}: ${left} left over, and with a single flush ${unit} there are no grout gaps to spread it across.`;
    }
    return `${name}: ${left} left over, not enough for another whole ${unit} plus grout, so it is omitted.`;
  }

  function render() {
    const layout = TilingLayout.computeLayout(state);
    const { x, y } = layout;
    lastLayout = layout;

    if (state.balance) {
      for (const def of GAP_PARAMS) showValue(def.key, layout[def.axis].gap);
    }
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

    const gapText = (axis, units, min) =>
      axis.gapCount > 0
        ? `${fmtMm(axis.gap)} mm between ${units} (min ${fmtMm(min)})`
        : `no gaps between ${units}`;
    els.details.textContent = state.balance
      ? `Grout after balancing: ${gapText(x, 'columns', state.gapX)}, ${gapText(y, 'rows', state.gapY)}.`
      : '';

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
