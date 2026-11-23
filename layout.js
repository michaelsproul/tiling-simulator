/*
 * Pure layout math for the hearth tiling simulator (no DOM access).
 * All lengths are in millimetres.
 */
const TilingLayout = (() => {
  'use strict';

  // Tolerance used only to absorb floating-point error, not as a practical fitting allowance.
  const EPS = 1e-6;

  /**
   * Lay whole tiles along one axis.
   *
   * @param {number} length  Hearth length along this axis.
   * @param {number} tile    Tile length along this axis (> 0).
   * @param {number} gap     Grout gap between neighbouring tiles (>= 0).
   * @param {boolean} border If true, a grout gap also separates the outer tiles from the hearth
   *                         edge (length = n·tile + (n+1)·gap); otherwise the outer tiles sit
   *                         flush against the edge (length = n·tile + (n−1)·gap).
   * @returns {{count:number, start:number, step:number, used:number, leftover:number, valid:boolean}}
   *   Tile i occupies [start + i·step, start + i·step + tile]. Any leftover space ends up after the
   *   last tile, i.e. the tile that would need cutting is omitted.
   */
  function computeAxis(length, tile, gap, border) {
    const step = tile + gap;
    const raw = border ? (length - gap) / step : (length + gap) / step;
    const count = Math.max(0, Math.floor(raw + EPS / step));
    const gapCount = border ? count + 1 : count - 1;
    const used = count > 0 ? count * tile + gapCount * gap : 0;
    const leftover = length - used;
    return {
      count,
      start: border ? gap : 0,
      step,
      used,
      leftover,
      valid: count > 0 && Math.abs(leftover) < EPS,
    };
  }

  /**
   * Lay whole tiles over the full hearth rectangle.
   *
   * @param {{hearthW:number, hearthD:number, tileW:number, tileD:number,
   *          gapX:number, gapY:number, border:boolean}} p
   *   gapX is the left-right gap (between columns), gapY the up-down gap (between rows).
   */
  function computeLayout(p) {
    const x = computeAxis(p.hearthW, p.tileW, p.gapX, p.border);
    const y = computeAxis(p.hearthD, p.tileD, p.gapY, p.border);
    return {
      x,
      y,
      cols: x.count,
      rows: y.count,
      total: x.count * y.count,
      valid: x.valid && y.valid,
    };
  }

  return { EPS, computeAxis, computeLayout };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TilingLayout;
}
