/*
 * Pure logic for the hearth tiling simulator (layout math and input parsing, no DOM access).
 * All lengths are in millimetres.
 */
const TilingLayout = (() => {
  'use strict';

  // Tolerance used only to absorb floating-point error, not as a practical fitting allowance.
  const EPS = 1e-6;

  /**
   * Lay whole tiles along one axis.
   *
   * @param {number} length   Hearth length along this axis.
   * @param {number} tile     Tile length along this axis (> 0).
   * @param {number} gap      Grout gap between neighbouring tiles (>= 0). When balancing, this is
   *                          the minimum gap.
   * @param {boolean} border  If true, a grout gap also separates the outer tiles from the hearth
   *                          edge (length = n·tile + (n+1)·gap); otherwise the outer tiles sit
   *                          flush against the edge (length = n·tile + (n−1)·gap).
   * @param {boolean} [balance=false]
   *                          If true, space left over after placing the whole tiles is spread
   *                          evenly across all the grout gaps on this axis, so the tiles fill it
   *                          exactly. Not possible when there are no gaps (a single flush tile).
   * @returns {{count:number, gap:number, gapCount:number, balanced:boolean, start:number,
   *            step:number, used:number, leftover:number, valid:boolean}}
   *   `gap` is the grout gap actually used. Tile i occupies [start + i·step, start + i·step + tile].
   *   Any leftover space ends up after the last tile, i.e. the tile that would need cutting is
   *   omitted.
   */
  function computeAxis(length, tile, gap, border, balance = false) {
    const raw = border ? (length - gap) / (tile + gap) : (length + gap) / (tile + gap);
    const count = Math.max(0, Math.floor(raw + EPS / (tile + gap)));
    const gapCount = count === 0 ? 0 : border ? count + 1 : count - 1;
    const minUsed = count * tile + gapCount * gap;

    let actualGap = gap;
    let balanced = false;
    if (balance && gapCount > 0 && length - minUsed > EPS) {
      actualGap = gap + (length - minUsed) / gapCount;
      balanced = true;
    }

    const used = count * tile + gapCount * actualGap;
    const leftover = length - used;
    return {
      count,
      gap: actualGap,
      gapCount,
      balanced,
      start: border ? actualGap : 0,
      step: tile + actualGap,
      used,
      leftover,
      valid: count > 0 && Math.abs(leftover) < EPS,
    };
  }

  /**
   * Lay whole tiles over the full hearth rectangle.
   *
   * @param {{hearthW:number, hearthD:number, tileW:number, tileD:number,
   *          gapX:number, gapY:number, border:boolean, balance?:boolean}} p
   *   gapX is the left-right gap (between columns), gapY the up-down gap (between rows).
   */
  function computeLayout(p) {
    const x = computeAxis(p.hearthW, p.tileW, p.gapX, p.border, p.balance);
    const y = computeAxis(p.hearthD, p.tileD, p.gapY, p.border, p.balance);
    return {
      x,
      y,
      cols: x.count,
      rows: y.count,
      total: x.count * y.count,
      valid: x.valid && y.valid,
    };
  }

  const DECIMAL = /^(\d+\.?\d*|\.\d+)$/;
  const FRACTION = /^(?:(\d+(?:\.\d+)?)(?:\s+|\s*-\s*))?(\d+)\s*\/\s*(\d+)$/;

  /**
   * Parse a typed length in mm. Accepts decimals ("2.5", ".5", "2,5") and fractions
   * ("1/2", "2 1/2", "2-1/2"). Returns null for anything else, negatives, or 0 when not allowed.
   */
  function parseLength(str, allowZero) {
    const s = String(str).trim().replace(',', '.');
    let n = null;
    let m;
    if (DECIMAL.test(s)) {
      n = Number(s);
    } else if ((m = s.match(FRACTION))) {
      const den = Number(m[3]);
      if (den !== 0) n = (m[1] ? Number(m[1]) : 0) + Number(m[2]) / den;
    }
    if (n === null || !Number.isFinite(n) || (n === 0 && !allowZero)) return null;
    return n;
  }

  return { EPS, computeAxis, computeLayout, parseLength };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TilingLayout;
}
