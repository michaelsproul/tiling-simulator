/*
 * Pure logic for the hearth tiling simulator: layout math, zone geometry and input parsing, with
 * no DOM access. All lengths are in millimetres. Rectangles are {x, y, w, d} in the top-down view:
 * x and w run left to right (the hearth's width), y and d top to bottom (its depth).
 */
const TilingLayout = (() => {
  'use strict';

  // Tolerance used only to absorb floating-point error, not as a practical fitting allowance.
  const EPS = 1e-6;

  const round6 = (n) => Math.round(n * 1e6) / 1e6;

  /**
   * Lay whole tiles along one axis.
   *
   * @param {number} length   Length to fill along this axis.
   * @param {number} tile     Tile length along this axis (> 0).
   * @param {number} gap      Grout gap between neighbouring tiles (>= 0). When balancing, this is
   *                          the minimum gap.
   * @param {boolean|number[]} ends
   *                          Grout at the start and end of the axis, as [start, end] multiples of
   *                          the gap. `true` is short for [1, 1]: a grout gap also separates the
   *                          outer tiles from the edge (length = n·tile + (n+1)·gap). `false` is
   *                          short for [0, 0]: the outer tiles sit flush against the edge
   *                          (length = n·tile + (n−1)·gap). Zone edges inside the hearth use 0.5,
   *                          since the zones either side share the grout joint between them.
   * @param {boolean} [balance=false]
   *                          If true, space left over after placing the whole tiles is spread
   *                          evenly across all the grout on this axis (end grout in proportion to
   *                          its multiple), so the tiles fill it exactly. Not possible when there
   *                          is no grout (a single tile flush at both ends).
   * @returns {{count:number, gap:number, gapUnits:number, ends:number[], balanced:boolean,
   *            start:number, step:number, used:number, leftover:number, valid:boolean}}
   *   `gap` is the grout gap actually used, and `gapUnits` how many gaps' worth of grout there is
   *   (count − 1 + start + end, so possibly fractional). Tile i occupies
   *   [start + i·step, start + i·step + tile]. Any leftover space ends up after the last tile,
   *   i.e. the tile that would need cutting is omitted.
   */
  function computeAxis(length, tile, gap, ends, balance = false) {
    if (typeof ends === 'boolean') ends = ends ? [1, 1] : [0, 0];
    const endUnits = ends[0] + ends[1];
    // n tiles need n·tile + (n − 1 + endUnits)·gap.
    const raw = (length - (endUnits - 1) * gap) / (tile + gap);
    const count = Math.max(0, Math.floor(raw + EPS / (tile + gap)));
    const gapUnits = count === 0 ? 0 : count - 1 + endUnits;
    const minUsed = count * tile + gapUnits * gap;

    let actualGap = gap;
    let balanced = false;
    if (balance && gapUnits > 0 && length - minUsed > EPS) {
      actualGap = gap + (length - minUsed) / gapUnits;
      balanced = true;
    }

    const used = count * tile + gapUnits * actualGap;
    const leftover = length - used;
    return {
      count,
      gap: actualGap,
      gapUnits,
      ends,
      balanced,
      start: ends[0] * actualGap,
      step: tile + actualGap,
      used,
      leftover,
      valid: count > 0 && Math.abs(leftover) < EPS,
    };
  }

  /**
   * Lay whole tiles over a w × d rectangle with tile and grout settings
   * s = {tileW, tileD, gapX, gapY}. endsX/endsY are passed to computeAxis for each axis.
   */
  function layoutRect(w, d, s, endsX, endsY, balance) {
    const x = computeAxis(w, s.tileW, s.gapX, endsX, balance);
    const y = computeAxis(d, s.tileD, s.gapY, endsY, balance);
    return {
      x,
      y,
      cols: x.count,
      rows: y.count,
      total: x.count * y.count,
      valid: x.valid && y.valid,
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
    return layoutRect(p.hearthW, p.hearthD, p, p.border, p.border, p.balance);
  }

  // ---------- Zones ----------

  /**
   * Rectangle of a placed zone {zoneW, zoneD, zoneX, zoneY, centreX, centreY}. zoneX/zoneY are
   * the offsets from the hearth's left and top edges, ignored on an axis where the zone is centred.
   */
  function placeZone(z, hearthW, hearthD) {
    return {
      x: z.centreX ? (hearthW - z.zoneW) / 2 : z.zoneX,
      y: z.centreY ? (hearthD - z.zoneD) / 2 : z.zoneY,
      w: z.zoneW,
      d: z.zoneD,
    };
  }

  /** Which sides of a rectangle lie on the hearth's edge (the rest are inside the hearth). */
  function zoneEdges(rect, hearthW, hearthD) {
    return {
      left: Math.abs(rect.x) < EPS,
      right: Math.abs(rect.x + rect.w - hearthW) < EPS,
      top: Math.abs(rect.y) < EPS,
      bottom: Math.abs(rect.y + rect.d - hearthD) < EPS,
    };
  }

  /**
   * Lay whole tiles over one zone of the hearth. Sides on the hearth edge get a full grout gap
   * with `border`, or none without. Sides inside the hearth sit on the centre line of the grout
   * joint with the neighbouring zone, so they get half a gap.
   */
  function layoutZone(rect, s, hearthW, hearthD, border, balance) {
    const edges = zoneEdges(rect, hearthW, hearthD);
    const end = (onEdge) => (onEdge ? (border ? 1 : 0) : 0.5);
    const layout = layoutRect(
      rect.w,
      rect.d,
      s,
      [end(edges.left), end(edges.right)],
      [end(edges.top), end(edges.bottom)],
      balance,
    );
    return { ...layout, edges };
  }

  // Sorted, de-duplicated cut positions along one axis, always starting at 0 and ending at max.
  function cutLines(values, max) {
    const lines = [0];
    for (const v of values.slice().sort((a, b) => a - b)) {
      if (v - lines[lines.length - 1] > EPS && max - v > EPS) lines.push(v);
    }
    lines.push(max);
    return lines;
  }

  const byPosition = (a, b) => a.y - b.y || a.x - b.x;

  /**
   * Cut the part of the hearth not covered by `holes` (rectangles; overlaps and overhangs allowed)
   * into rectangles.
   *
   * mode 'rows': full-width bands first. Each row of the grid formed by the hole edges is split
   *   into runs between the holes, and runs in consecutive rows with the same span are merged, so
   *   a single centred hole leaves bands above and below plus a piece either side of it.
   * mode 'cols': the same with the axes swapped (full-depth pieces either side, plus pieces above
   *   and below the hole).
   *
   * Returns rectangles sorted top to bottom, then left to right.
   */
  function cutSurround(hearthW, hearthD, holes, mode = 'rows') {
    if (mode === 'cols') {
      const swap = (r) => ({ x: r.y, y: r.x, w: r.d, d: r.w });
      return cutSurround(hearthD, hearthW, holes.map(swap), 'rows').map(swap).sort(byPosition);
    }

    const clipped = holes
      .map((h) => ({
        x0: Math.max(0, h.x),
        x1: Math.min(hearthW, h.x + h.w),
        y0: Math.max(0, h.y),
        y1: Math.min(hearthD, h.y + h.d),
      }))
      .filter((h) => h.x1 - h.x0 > EPS && h.y1 - h.y0 > EPS);
    const xs = cutLines(clipped.flatMap((h) => [h.x0, h.x1]), hearthW);
    const ys = cutLines(clipped.flatMap((h) => [h.y0, h.y1]), hearthD);

    const pieces = [];
    let open = []; // pieces still growing downwards: {x0, x1, y0}
    for (let j = 0; j + 1 < ys.length; j++) {
      const cy = (ys[j] + ys[j + 1]) / 2;
      const runs = [];
      let runStart = null;
      for (let i = 0; i + 1 < xs.length; i++) {
        const cx = (xs[i] + xs[i + 1]) / 2;
        const covered = clipped.some((h) => cx > h.x0 && cx < h.x1 && cy > h.y0 && cy < h.y1);
        if (!covered && runStart === null) runStart = xs[i];
        if (covered && runStart !== null) {
          runs.push([runStart, xs[i]]);
          runStart = null;
        }
      }
      if (runStart !== null) runs.push([runStart, xs[xs.length - 1]]);

      const next = [];
      for (const [x0, x1] of runs) {
        const k = open.findIndex((p) => p.x0 === x0 && p.x1 === x1);
        next.push(k >= 0 ? open.splice(k, 1)[0] : { x0, x1, y0: ys[j] });
      }
      for (const p of open) pieces.push({ x: p.x0, y: p.y0, w: p.x1 - p.x0, d: ys[j] - p.y0 });
      open = next;
    }
    const bottom = ys[ys.length - 1];
    for (const p of open) pieces.push({ x: p.x0, y: p.y0, w: p.x1 - p.x0, d: bottom - p.y0 });
    return pieces.sort(byPosition);
  }

  /** Area shared by two rectangles. */
  function overlapArea(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const d = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
    return w > 0 && d > 0 ? w * d : 0;
  }

  /**
   * Match a new set of rectangles to an old one, so zones can keep their identity and settings
   * when the cut changes. For each new rectangle returns:
   *   keep: index of the old rectangle it continues, or -1. Pairs are taken greedily by overlap,
   *         largest first, so each old rectangle is continued by at most one new one.
   *   from: index of the old rectangle it overlaps most, or -1 if it overlaps none.
   */
  function matchRects(oldRects, newRects) {
    const pairs = [];
    const result = newRects.map((n, i) => {
      let from = -1;
      let best = EPS;
      oldRects.forEach((o, j) => {
        const area = overlapArea(n, o);
        if (area <= EPS) return;
        pairs.push({ i, j, area });
        if (area > best) {
          best = area;
          from = j;
        }
      });
      return { keep: -1, from };
    });
    pairs.sort((p, q) => q.area - p.area);
    const taken = new Set();
    for (const { i, j } of pairs) {
      if (result[i].keep === -1 && !taken.has(j)) {
        result[i].keep = j;
        taken.add(j);
      }
    }
    return result;
  }

  /**
   * Suggest a length for a new zone centred in an area that holds `count` tiles along this axis,
   * laid with the given tile and (actual) gap: about half the tiles, keeping the count's parity so
   * the equal margins either side still hold whole tiles. The length runs between joint centre
   * lines, n·(tile + gap), so if the tiles fitted the area exactly (with the same grout at both
   * ends) they also fit the zone and both margins. Returns the full length when there is no room
   * for a tile on each side.
   */
  function suggestZoneLength(length, count, tile, gap) {
    const n = count - 2 * Math.round(count / 4);
    if (count < 3 || n < 1) return length;
    return Math.min(length, round6(n * (tile + gap)));
  }

  // ---------- Input parsing ----------

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

  return {
    EPS,
    computeAxis,
    layoutRect,
    computeLayout,
    placeZone,
    zoneEdges,
    layoutZone,
    cutSurround,
    overlapArea,
    matchRects,
    suggestZoneLength,
    parseLength,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TilingLayout;
}
