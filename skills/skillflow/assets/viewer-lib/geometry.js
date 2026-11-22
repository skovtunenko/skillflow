/* SkillFlow layout geometry on plain blocks of boxes, edges and labels: merge, shift, bounds, end placement, edge paths. */
var sfGeom = (function () {
  'use strict';
  var GAP_OUT = 40, GAP_X = 28;  // px: from a phase box to an end card outside it, and between columns or lanes
  function blank() { return { w: 0, h: 0, ax: 0, nodes: [], groups: [], edges: [], labels: [], joins: [], exit: true }; }
  function merge(out, b, dx, dy) {
    b.nodes.forEach(function (n) { out.nodes.push({ id: n.id, x: n.x + dx, y: n.y + dy, w: n.w, h: n.h, att: n.att ? [n.att[0] + dx, n.att[1] + dy] : null }); });
    b.groups.forEach(function (g) { out.groups.push({ id: g.id, x: g.x + dx, y: g.y + dy, w: g.w, h: g.h, ax: g.ax, hw: g.hw }); });
    b.edges.forEach(function (e) { out.edges.push({ kind: e.kind, arrow: e.arrow, to: e.to, cond: e.cond, after: e.after, pts: e.pts.map(function (p) { return [p[0] + dx, p[1] + dy]; }) }); });
    b.labels.forEach(function (l) { out.labels.push({ el: l.el, w: l.w, h: l.h, kind: l.kind, x: l.x + dx, y: l.y + dy }); });
    b.joins.forEach(function (j) { out.joins.push([j[0] + dx, j[1] + dy]); });
  }
  // shift a block so nothing it draws sits left of x=0 (a loop-back can reach past the block's left edge)
  function normalize(out) {
    var minX = 0, maxX = out.w;
    out.nodes.forEach(function (n) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x + n.w); });
    out.edges.forEach(function (e) { e.pts.forEach(function (p) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); }); });
    out.labels.forEach(function (l) { minX = Math.min(minX, l.x - l.w / 2); maxX = Math.max(maxX, l.x + l.w / 2); });
    if (minX >= 0 && maxX <= out.w) return out;
    var res = blank(); merge(res, out, -minX, 0);
    res.w = maxX - minX; res.h = out.h; res.ax = out.ax - minX; res.exit = out.exit;
    if (out.ex != null) res.ex = out.ex - minX;
    return res;
  }
  // where an end card goes outside the box: {nx: card left, ax: where the arrow meets the card, y: the arrow's line}, or null
  function placeEnd(out, self, inc, att, boxW, columns) {
    var x = att[0], ym = self.y + self.h / 2, sides = self.x + self.w / 2 >= boxW / 2 ? [true, false] : [false, true];
    function spot(right, k, y) {
      var nx = right ? boxW + GAP_OUT + k * (self.w + GAP_X) : -GAP_OUT - self.w - k * (self.w + GAP_X);
      return { nx: nx, ax: right ? nx : nx + self.w, y: y };
    }
    function cardIn(x0, x1, y0, y1) { return out.nodes.some(function (q) { return q !== self && q.x < x1 && q.x + q.w > x0 && q.y < y1 && q.y + q.h > y0; }); }
    // an edge segment that meets the line: running along it (same line, overlapping), or any crossing when `cross` is set
    function meets(vertical, at, from, to, cross) {
      var k = vertical ? 0 : 1, o = 1 - k;
      return out.edges.some(function (e) {
        return e !== inc && e.pts.some(function (a, i) {
          var b = e.pts[i + 1]; if (!b) return false;
          var overlaps = Math.max(a[o], b[o]) + 0.1 > from && Math.min(a[o], b[o]) - 0.1 < to;
          var parallel = Math.abs(a[k] - b[k]) < 0.5;
          if (parallel) return overlaps && Math.abs(a[k] - at) < 4;
          return cross && overlaps && Math.min(a[k], b[k]) - 2 < at && Math.max(a[k], b[k]) + 2 > at;
        });
      });
    }
    // strict: the line crosses no edge (the first choice); otherwise it may cross an edge at a right angle
    function clear(s, strict) {
      var x0 = Math.min(x, s.ax), x1 = Math.max(x, s.ax);
      return !cardIn(x0, x1, s.y - 8, s.y + 8) && !cardIn(s.nx - 8, s.nx + self.w + 8, s.y - self.h / 2 - 8, s.y + self.h / 2 + 8) &&
        !meets(false, s.y, x0, x1, strict) &&
        !out.labels.some(function (l) { return l.x - l.w / 2 < x1 && l.x + l.w / 2 > x0 && Math.abs(l.y - s.y) < l.h / 2 + 4; }) &&
        !out.joins.some(function (j) { return j[0] > x0 - 6 && j[0] < x1 + 6 && Math.abs(j[1] - s.y) < 8; });
    }
    function drop(y) { return y === att[1] || (!cardIn(x - 1, x + 1, att[1], y + 8) && !meets(true, x, att[1], y, false)); }
    // 1. beside the box on the end's own line, crossing nothing
    for (var i = 0; i < 2; i++) if (clear(spot(sides[i], 0, ym), true)) return spot(sides[i], 0, ym);
    // edges that the arrow's line to the spot crosses at a right angle
    function crossings(s) {
      var x0 = Math.min(x, s.ax), x1 = Math.max(x, s.ax);
      return out.edges.filter(function (e) {
        return e !== inc && e.pts.some(function (a, i) {
          var b = e.pts[i + 1];
          return b && Math.abs(a[0] - b[0]) < 0.5 && a[0] > x0 + 0.1 && a[0] < x1 - 0.1 && Math.min(a[1], b[1]) - 2 < s.y && Math.max(a[1], b[1]) + 2 > s.y;
        });
      }).length;
    }
    // 2. down the end's branch to a clear line inside the box. Each side and column gives its first clear line, at the
    // middle of that clear stretch; the line that crosses the fewest edges wins, then the higher line, the nearer
    // column, and the end's own side. So an end never runs across its sibling branches when the other side is free.
    function less(a, b) { for (var j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j] < b[j]; return false; }
    var best = null;
    for (var k = 0; k < columns; k++) for (i = 0; i < 2; i++) {
      for (var y = ym; y <= out.h - 2 && drop(y); y += 2) {
        if (!clear(spot(sides[i], k, y), false)) continue;
        var last = y;
        while (last + 2 <= out.h - 2 && drop(last + 2) && clear(spot(sides[i], k, last + 2), false)) last += 2;
        var s = spot(sides[i], k, y + Math.floor((last - y) / 4) * 2), rank = [crossings(s), y, k, i];
        if (!best || less(rank, best.rank)) best = { s: s, rank: rank };
        break;
      }
    }
    return best && best.s;
  }
  function bounds(all) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    function box(x, y, w, h) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x + w); b[3] = Math.max(b[3], y + h); }
    all.nodes.forEach(function (n) { box(n.x, n.y, n.w, n.h); });
    all.groups.forEach(function (g) { box(g.x, g.y, g.w, g.h); });
    all.labels.forEach(function (l) { box(l.x - l.w / 2, l.y - l.h / 2, l.w, l.h); });
    all.edges.forEach(function (e) { e.pts.forEach(function (p) { box(p[0], p[1], 0, 0); }); });
    return b;
  }
  function n1(v) { return v.toFixed(1); }
  function rounded(p) {
    var R = 10, d = 'M' + n1(p[0][0]) + ' ' + n1(p[0][1]);
    for (var i = 1; i < p.length - 1; i++) {
      var a = p[i - 1], b = p[i], c = p[i + 1], l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]), r = Math.min(R, l1 / 2, l2 / 2);
      if (r < 0.5) { d += ' L' + n1(b[0]) + ' ' + n1(b[1]); continue; }
      d += ' L' + n1(b[0] - (b[0] - a[0]) / l1 * r) + ' ' + n1(b[1] - (b[1] - a[1]) / l1 * r) + ' Q' + n1(b[0]) + ' ' + n1(b[1]) + ' ' + n1(b[0] + (c[0] - b[0]) / l2 * r) + ' ' + n1(b[1] + (c[1] - b[1]) / l2 * r);
    }
    var z = p[p.length - 1];
    return d + ' L' + n1(z[0]) + ' ' + n1(z[1]);
  }
  return { GAP_X: GAP_X, blank: blank, merge: merge, normalize: normalize, placeEnd: placeEnd, bounds: bounds, n1: n1, rounded: rounded };
})();
