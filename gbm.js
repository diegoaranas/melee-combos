// Histogram gradient boosting for binary classification (log loss) with sample weights.
// Mirrors the settings rank.py used with scikit-learn's HistGradientBoostingClassifier:
// depth-limited trees, feature values bucketed into at most 255 quantile bins, L2 on leaves.
// Deterministic: no subsampling, no early stopping.

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// Per-feature bin edges from quantiles of the distinct values.
function makeBins(X, nFeat, maxBins) {
  const edges = [];
  for (let j = 0; j < nFeat; j++) {
    const vals = Float64Array.from(X, (row) => row[j]).sort();
    const distinct = [];
    for (let i = 0; i < vals.length; i++) if (i === 0 || vals[i] !== vals[i - 1]) distinct.push(vals[i]);
    let e;
    if (distinct.length <= maxBins) {
      e = distinct.slice(1).map((v, i) => (v + distinct[i]) / 2); // midpoints
    } else {
      e = [];
      for (let k = 1; k < maxBins; k++) {
        const v = vals[Math.floor((k * vals.length) / maxBins)];
        if (!e.length || v > e[e.length - 1]) e.push(v);
      }
    }
    edges.push(Float64Array.from(e));
  }
  return edges;
}

function binIndex(edges, v) {
  let lo = 0, hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v > edges[mid]) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function binAll(X, edges) {
  const n = X.length, F = edges.length;
  const B = new Uint8Array(n * F);
  for (let i = 0; i < n; i++) for (let j = 0; j < F; j++) B[i * F + j] = binIndex(edges[j], X[i][j]);
  return B;
}

function train(X, y, w, opts = {}) {
  const { maxDepth = 3, learningRate = 0.05, maxIter = 200, minSamplesLeaf = 50, l2 = 1.0, maxBins = 255 } = opts;
  const n = X.length, F = X[0].length;
  const edges = makeBins(X, F, maxBins);
  const B = binAll(X, edges);
  const nb = edges.map((e) => e.length + 1);

  let sw = 0, swy = 0;
  for (let i = 0; i < n; i++) { sw += w[i]; swy += w[i] * y[i]; }
  const p0 = Math.min(1 - 1e-12, Math.max(1e-12, swy / sw));
  const base = Math.log(p0 / (1 - p0));
  const raw = new Float64Array(n).fill(base);
  const g = new Float64Array(n), h = new Float64Array(n);
  const trees = [];
  const histG = nb.map((k) => new Float64Array(k)), histH = nb.map((k) => new Float64Array(k));
  const histC = nb.map((k) => new Int32Array(k));

  function grow(idx, depth) {
    let G = 0, H = 0;
    for (const i of idx) { G += g[i]; H += h[i]; }
    const leaf = { value: (-G / (H + l2)) * learningRate };
    if (depth >= maxDepth || idx.length < 2 * minSamplesLeaf) return leaf;
    for (let j = 0; j < F; j++) { histG[j].fill(0); histH[j].fill(0); histC[j].fill(0); }
    for (const i of idx) {
      const gi = g[i], hi = h[i], off = i * F;
      for (let j = 0; j < F; j++) { const b = B[off + j]; histG[j][b] += gi; histH[j][b] += hi; histC[j][b]++; }
    }
    const parent = (G * G) / (H + l2);
    let best = { gain: 1e-7 };
    for (let j = 0; j < F; j++) {
      let gl = 0, hl = 0, cl = 0;
      for (let b = 0; b < nb[j] - 1; b++) {
        gl += histG[j][b]; hl += histH[j][b]; cl += histC[j][b];
        const cr = idx.length - cl;
        if (cl < minSamplesLeaf) continue;
        if (cr < minSamplesLeaf) break;
        const gr = G - gl, hr = H - hl;
        if (hl < 1e-3 || hr < 1e-3) continue;
        const gain = (gl * gl) / (hl + l2) + (gr * gr) / (hr + l2) - parent;
        if (gain > best.gain) best = { gain, feature: j, bin: b };
      }
    }
    if (best.feature === undefined) return leaf;
    const left = [], right = [];
    for (const i of idx) (B[i * F + best.feature] <= best.bin ? left : right).push(i);
    return {
      feature: best.feature,
      threshold: edges[best.feature][best.bin], // value <= threshold goes left
      left: grow(left, depth + 1),
      right: grow(right, depth + 1),
    };
  }

  const all = Array.from({ length: n }, (_, i) => i);
  for (let it = 0; it < maxIter; it++) {
    for (let i = 0; i < n; i++) {
      const p = sigmoid(raw[i]);
      g[i] = w[i] * (p - y[i]);
      h[i] = w[i] * p * (1 - p);
    }
    const tree = grow(all, 0);
    trees.push(tree);
    for (let i = 0; i < n; i++) raw[i] += predictTree(tree, X[i]);
  }
  return { base, trees };
}

function predictTree(t, x) {
  while (t.feature !== undefined) t = x[t.feature] <= t.threshold ? t.left : t.right;
  return t.value;
}

// Log-odds score (like scikit-learn's decision_function).
function score(model, x) {
  let s = model.base;
  for (const t of model.trees) s += predictTree(t, x);
  return s;
}

module.exports = { train, score };
