/* Canvas-based path-diagram editor & renderer for the PLS-SEM model builder
 * and for the annotated results diagram. No external dependencies. */

class PathDiagram {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.editable = !!opts.editable;
    this.onSelect = opts.onSelect || (() => {});
    this.onChange = opts.onChange || (() => {});

    this.constructs = []; // {id, name, mode, indicators:[], x, y}
    this.paths = []; // {source, target}
    this.annotate = null; // results overlay data

    this.selected = null; // {type:'node'|'edge', id}
    this.pathMode = false;
    this.pendingSource = null;
    this.dragging = null;
    this.dragMoved = false;

    this.RADIUS_X = 64;
    this.RADIUS_Y = 36;

    if (this.editable) this._bindEvents();
    this.render();
  }

  // ---------- data API ----------
  addConstruct(name, mode, x, y, interactionOf = null, calcMethod = "two_stage", productTermGeneration = "standardized") {
    const id = "c" + Math.random().toString(36).slice(2, 9);
    this.constructs.push({
      id, name, mode, indicators: [], x, y,
      interaction_of: interactionOf,
      calc_method: mode === "I" ? calcMethod : undefined,
      product_term_generation: mode === "I" ? productTermGeneration : undefined,
    });
    this.render();
    this.onChange();
    return id;
  }

  removeConstruct(id) {
    this.constructs = this.constructs.filter((c) => c.id !== id);
    this.paths = this.paths.filter((p) => p.source !== id && p.target !== id);
    this.render();
    this.onChange();
  }

  getConstruct(id) {
    return this.constructs.find((c) => c.id === id);
  }

  addPath(source, target) {
    if (source === target) return false;
    // an interaction/moderation construct is always exogenous (it's a computed
    // product of two other constructs' scores) — it can never be a path target
    const targetConstruct = this.getConstruct(target);
    if (targetConstruct && targetConstruct.mode === "I") return false;
    if (this.paths.some((p) => p.source === source && p.target === target)) return false;
    // reject reverse duplicate (would immediately create a 2-cycle)
    if (this.paths.some((p) => p.source === target && p.target === source)) return false;
    this.paths.push({ source, target });
    this.render();
    this.onChange();
    return true;
  }

  removePath(source, target) {
    this.paths = this.paths.filter((p) => !(p.source === source && p.target === target));
    this.render();
    this.onChange();
  }

  setSelected(sel) {
    this.selected = sel;
    this.onSelect(sel ? this._resolveSelection(sel) : null);
    this.render();
  }

  _resolveSelection(sel) {
    if (sel.type === "node") return { type: "node", construct: this.getConstruct(sel.id) };
    return { type: "edge", edge: sel.id };
  }

  serialize() {
    return {
      constructs: this.constructs.map((c) => ({
        id: c.id,
        name: c.name,
        mode: c.mode,
        indicators: c.indicators,
        interaction_of: c.interaction_of || null,
        calc_method: c.calc_method || null,
        product_term_generation: c.product_term_generation || null,
      })),
      paths: this.paths.map((p) => ({ source: p.source, target: p.target })),
    };
  }

  loadFrom(constructs, paths) {
    this.constructs = constructs.map((c) => ({ ...c }));
    this.paths = paths.map((p) => ({ ...p }));
    this.render();
  }

  // Renders the full SmartPLS-style diagram (construct ellipses *and* their
  // measurement-model indicator boxes with loading/weight labels) — used for
  // the read-only results diagrams and for the exported report image, not
  // for the editable model builder (which stays uncluttered on purpose).
  // `loadingsOrWeights` maps indicator name -> the value to print on its arrow
  // (outer loading for Mode A blocks, outer weight for Mode B).
  renderWithMeasurement(loadingsOrWeights) {
    this._loadings = loadingsOrWeights || {};
    const boxes = this._layoutIndicators();
    this._indicatorBoxes = boxes;

    const PAD = 40;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const ctx = this.ctx;
    for (const c of this.constructs) {
      ctx.font = "11px sans-serif";
      const subWidth = ctx.measureText(this._subLabel(c)).width;
      const halfWidth = Math.max(this.RADIUS_X, subWidth / 2 + 4);
      minX = Math.min(minX, c.x - halfWidth);
      maxX = Math.max(maxX, c.x + halfWidth);
      minY = Math.min(minY, c.y - this.RADIUS_Y);
      maxY = Math.max(maxY, c.y + this.RADIUS_Y);
    }
    for (const b of boxes) {
      minX = Math.min(minX, b.x - b.w / 2);
      maxX = Math.max(maxX, b.x + b.w / 2);
      minY = Math.min(minY, b.y - b.h / 2);
      maxY = Math.max(maxY, b.y + b.h / 2);
    }
    if (!isFinite(minX)) return this.render();

    const offX = PAD - minX, offY = PAD - minY;
    for (const c of this.constructs) { c.x += offX; c.y += offY; }
    for (const b of boxes) { b.x += offX; b.y += offY; }

    // The diagram's own content determines its *shape* (aspect ratio) —
    // still stretched up to fill the panel's actual CSS width by
    // _syncCanvasResolution() below, exactly like the CSS `width:100%`
    // rule used to do, but via a sharp re-render at the target size
    // instead of the browser blurrily upscaling a small raster.
    this._naturalWidth = Math.ceil(maxX - minX + PAD * 2);
    this._naturalHeight = Math.ceil(maxY - minY + PAD * 2);
    this.render();
  }

  // Places each construct's indicator boxes in a column/row on whichever
  // side of the construct points away from the diagram's centroid (e.g. a
  // construct on the far left gets its indicators further left, one near
  // the top gets them above) — mirrors SmartPLS's default layout.
  _layoutIndicators() {
    const BOX_W = 92, BOX_H = 24, BOX_GAP = 8, STEM = 46;
    if (this.constructs.length === 0) return [];
    const cx = this.constructs.reduce((s, c) => s + c.x, 0) / this.constructs.length;
    const cy = this.constructs.reduce((s, c) => s + c.y, 0) / this.constructs.length;
    const boxes = [];
    for (const c of this.constructs) {
      const inds = c.indicators || [];
      if (inds.length === 0 || c.mode === "I") continue;
      const dx = c.x - cx, dy = c.y - cy;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const dir = horizontal ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "down" : "up");
      const n = inds.length;
      inds.forEach((ind, i) => {
        const spreadV = (i - (n - 1) / 2) * (BOX_H + BOX_GAP);
        const spreadH = (i - (n - 1) / 2) * (BOX_W + BOX_GAP);
        let bx, by;
        if (dir === "right") { bx = c.x + this.RADIUS_X + STEM + BOX_W / 2; by = c.y + spreadV; }
        else if (dir === "left") { bx = c.x - this.RADIUS_X - STEM - BOX_W / 2; by = c.y + spreadV; }
        else if (dir === "down") { bx = c.x + spreadH; by = c.y + this.RADIUS_Y + STEM + BOX_H / 2; }
        else { bx = c.x + spreadH; by = c.y - this.RADIUS_Y - STEM - BOX_H / 2; }
        boxes.push({ ind, cid: c.id, x: bx, y: by, w: BOX_W, h: BOX_H, mode: c.mode });
      });
    }
    return boxes;
  }

  // Same text `render()` prints under a construct's name — factored out so
  // renderWithMeasurement() can measure it when sizing the canvas (a long
  // interaction-term label like "A × B" can be wider than the ellipse itself).
  _subLabel(c) {
    const isInteraction = c.mode === "I";
    let sub;
    if (isInteraction) {
      const [a, b] = (c.interaction_of || []).map((sid) => this.getConstruct(sid));
      sub = a && b ? `${a.name} × ${b.name}` : t("s2_summary_interaction");
    } else {
      sub = t(c.mode === "A" ? "diagram_reflective" : "diagram_formative");
    }
    if (this.annotate) {
      const r2 = this.annotate.r2 ? this.annotate.r2[c.id] : null;
      if (r2 !== null && r2 !== undefined) sub = `R² = ${r2.toFixed(3)}`;
    } else if (!isInteraction) {
      sub += ` · ${c.indicators.length} ${t("s2_summary_item_suffix")}`;
    }
    return sub;
  }

  _boxEdgeToward(box, point) {
    const dx = point.x - box.x, dy = point.y - box.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      return { x: box.x + Math.sign(dx) * box.w / 2, y: box.y };
    }
    return { x: box.x, y: box.y + Math.sign(dy) * box.h / 2 };
  }

  // ---------- geometry ----------
  // Maps a pointer event to *logical* drawing coordinates — i.e. the same
  // space render()'s draw calls use, which since _syncCanvasResolution()
  // is DPR-scaled no longer equals `this.canvas.width`/`height` (those are
  // now the physical raster size). rect.width/height is normally identical
  // to logicalWidth/logicalHeight (both are the CSS-rendered size), but
  // going through the ratio rather than assuming 1:1 keeps this correct
  // under a CSS zoom/transform on the canvas too.
  _canvasPoint(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = (this._logicalWidth || this.canvas.width) / rect.width;
    const scaleY = (this._logicalHeight || this.canvas.height) / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
    };
  }

  _nodeAt(x, y) {
    for (let i = this.constructs.length - 1; i >= 0; i--) {
      const c = this.constructs[i];
      const dx = (x - c.x) / this.RADIUS_X;
      const dy = (y - c.y) / this.RADIUS_Y;
      if (dx * dx + dy * dy <= 1) return c;
    }
    return null;
  }

  _edgeAt(x, y) {
    const THRESH = 8;
    for (const p of this.paths) {
      const a = this.getConstruct(p.source);
      const b = this.getConstruct(p.target);
      if (!a || !b) continue;
      const d = this._pointToSegmentDist(x, y, a.x, a.y, b.x, b.y);
      if (d < THRESH) return p;
    }
    return null;
  }

  _pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  _borderIntersection(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const angle = Math.atan2(dy, dx);
    const rx = this.RADIUS_X, ry = this.RADIUS_Y;
    const denom = Math.sqrt(Math.pow(ry * Math.cos(angle), 2) + Math.pow(rx * Math.sin(angle), 2));
    const scale = (rx * ry) / denom;
    return { x: to.x - Math.cos(angle) * scale, y: to.y - Math.sin(angle) * scale };
  }

  // ---------- events (editable mode) ----------
  _bindEvents() {
    const c = this.canvas;
    // Touch devices don't reliably synthesize mouse events for drag gestures
    // on <canvas>, and have no dblclick — so pointer handling is factored
    // into shared methods that both the mouse and touch listeners drive.
    c.style.touchAction = "none";

    const handleDoubleTap = (pt) => {
      if (this._nodeAt(pt.x, pt.y)) return;
      this.onChange({ requestAddConstruct: pt });
    };

    c.addEventListener("dblclick", (e) => handleDoubleTap(this._canvasPoint(e)));

    c.addEventListener("mousedown", (e) => this._pointerDown(this._canvasPoint(e)));
    window.addEventListener("mousemove", (e) => this._pointerMove(this._canvasPoint(e)));
    window.addEventListener("mouseup", () => this._pointerUp());

    let lastTapAt = 0;
    c.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const pt = this._canvasPoint(e.touches[0]);
      const now = Date.now();
      if (now - lastTapAt < 350) {
        lastTapAt = 0;
        handleDoubleTap(pt);
        return;
      }
      lastTapAt = now;
      this._pointerDown(pt);
    }, { passive: false });

    window.addEventListener("touchmove", (e) => {
      if (!this.dragging || e.touches.length !== 1) return;
      e.preventDefault();
      this._pointerMove(this._canvasPoint(e.touches[0]));
    }, { passive: false });

    window.addEventListener("touchend", () => this._pointerUp());
  }

  _pointerDown(pt) {
    const node = this._nodeAt(pt.x, pt.y);
    if (node) {
      if (this.pathMode) {
        if (!this.pendingSource) {
          this.pendingSource = node.id;
        } else {
          const ok = this.addPath(this.pendingSource, node.id);
          if (!ok && this.pendingSource !== node.id) {
            this.onChange({ pathRejected: true });
          }
          this.pendingSource = null;
        }
        this.render();
        return;
      }
      this.dragging = node;
      this.dragMoved = false;
      this.setSelected({ type: "node", id: node.id });
      return;
    }
    const edge = this._edgeAt(pt.x, pt.y);
    if (edge) {
      this.setSelected({ type: "edge", id: edge });
    } else {
      this.setSelected(null);
    }
  }

  _pointerMove(pt) {
    if (!this.dragging) return;
    const w = this._logicalWidth || this.canvas.width, h = this._logicalHeight || this.canvas.height;
    this.dragging.x = Math.max(this.RADIUS_X, Math.min(w - this.RADIUS_X, pt.x));
    this.dragging.y = Math.max(this.RADIUS_Y, Math.min(h - this.RADIUS_Y, pt.y));
    this.dragMoved = true;
    this.render();
  }

  _pointerUp() {
    if (this.dragging && this.dragMoved) this.onChange();
    this.dragging = null;
  }

  deleteSelected() {
    if (!this.selected) return;
    if (this.selected.type === "node") this.removeConstruct(this.selected.id);
    else this.removePath(this.selected.id.source, this.selected.id.target);
    this.selected = null;
    this.onSelect(null);
  }

  setPathMode(on) {
    this.pathMode = on;
    this.pendingSource = null;
    this.render();
  }

  // ---------- rendering ----------
  // Syncs the canvas's raster resolution to its actual CSS-rendered size
  // (times devicePixelRatio, so text/lines are crisp instead of the
  // browser blurrily upscaling a fixed-resolution buffer to fill a wider
  // container) and establishes the transform that lets every draw call
  // below keep using plain "logical" coordinates unchanged.
  //
  // Two modes, both converging on the same _logicalWidth/_logicalHeight +
  // transform setup:
  //  - Editable model builder (no _naturalWidth set): logical space is
  //    simply the canvas's current CSS size (clientWidth/clientHeight, per
  //    the `canvas{width:100%}` rule) — matches the pre-fix behavior where
  //    canvas.width/height directly WAS that CSS size, just now sharp.
  //  - Read-only results diagram (_naturalWidth set by
  //    renderWithMeasurement): logical space is the diagram's own content
  //    layout, uniformly scaled up to fill the panel's actual CSS width —
  //    same visual stretch CSS used to do, done as a sharp re-render
  //    instead of a blurry bitmap upscale.
  _syncCanvasResolution() {
    const dpr = window.devicePixelRatio || 1;
    const naturalW = this._naturalWidth || this.canvas.clientWidth || this.canvas.width;
    const naturalH = this._naturalHeight || this.canvas.clientHeight || this.canvas.height;
    const cssWidth = this._naturalWidth ? (this.canvas.clientWidth || naturalW) : naturalW;
    const stretch = this._naturalWidth ? cssWidth / naturalW : 1;
    const cssHeight = naturalH * stretch;

    if (this._naturalWidth) {
      // Pin height explicitly (width already fills via `canvas{width:100%}`)
      // so the browser's own layout doesn't fight the aspect ratio we want.
      this.canvas.style.height = cssHeight + "px";
    }
    const rasterW = Math.max(1, Math.round(cssWidth * dpr));
    const rasterH = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== rasterW || this.canvas.height !== rasterH) {
      this.canvas.width = rasterW;
      this.canvas.height = rasterH;
    }
    this._logicalWidth = naturalW;
    this._logicalHeight = naturalH;
    this.ctx.setTransform(dpr * stretch, 0, 0, dpr * stretch, 0, 0);
  }

  render() {
    this._syncCanvasResolution();
    const ctx = this.ctx;
    const W = this._logicalWidth, H = this._logicalHeight;
    ctx.clearRect(0, 0, W, H);

    // edges
    for (const p of this.paths) {
      const a = this.getConstruct(p.source);
      const b = this.getConstruct(p.target);
      if (!a || !b) continue;
      const start = this._borderIntersection(b, a);
      const end = this._borderIntersection(a, b);
      const isSel = this.selected && this.selected.type === "edge" &&
        this.selected.id.source === p.source && this.selected.id.target === p.target;

      let coeff = null;
      let found = null;
      if (this.annotate && this.annotate.paths) {
        found = this.annotate.paths.find((x) => x.source === p.source && x.target === p.target);
        if (found) coeff = found.coefficient;
      }
      const hasSig = found && found.significant !== undefined && found.significant !== null;
      const isSig = hasSig ? found.significant : null;

      ctx.strokeStyle = isSel ? "#d64545" : (coeff !== null ? this._coeffColor(coeff) : "#8a93ab");
      ctx.lineWidth = coeff !== null ? Math.max(1.5, Math.min(6, Math.abs(coeff) * 6)) : 2;
      ctx.setLineDash(hasSig && !isSig ? [6, 4] : []);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);

      this._drawArrowHead(start, end, ctx.strokeStyle);

      const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
      if (coeff !== null) {
        ctx.font = "bold 13px sans-serif";
        let label = coeff.toFixed(3);
        if (found && found.t_stat !== undefined && found.t_stat !== null) {
          label += ` (t=${found.t_stat.toFixed(2)})`;
        }
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "#fff";
        ctx.fillRect(mx - tw / 2 - 4, my - 10, tw + 8, 18);
        ctx.fillStyle = coeff >= 0 ? "#1c2333" : "#a12a2a";
        ctx.fillText(label, mx - tw / 2, my + 4);
      }
    }

    // pending path source highlight
    if (this.pathMode && this.pendingSource) {
      const a = this.getConstruct(this.pendingSource);
      if (a) {
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = "#3457d5";
        ctx.arc(a.x, a.y, this.RADIUS_X + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // indicator boxes (measurement model) — only present after
    // renderWithMeasurement() has been called (results diagrams/report export)
    if (this._indicatorBoxes) {
      for (const b of this._indicatorBoxes) {
        const c = this.getConstruct(b.cid);
        if (!c) continue;
        const boxAnchor = this._boxEdgeToward(b, c);
        const nodeAnchor = this._borderIntersection(boxAnchor, c);
        // reflective (Mode A): construct causes the indicator, so the arrow
        // points construct -> box; formative (Mode B): the reverse.
        const reflective = b.mode !== "B";
        const from = reflective ? nodeAnchor : boxAnchor;
        const to = reflective ? boxAnchor : nodeAnchor;

        ctx.strokeStyle = "#8a93ab";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        this._drawArrowHead(from, to, "#8a93ab");

        const val = this._loadings ? this._loadings[b.ind] : null;
        if (val !== null && val !== undefined && !Number.isNaN(val)) {
          const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
          const label = Number(val).toFixed(3);
          ctx.font = "10px sans-serif";
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = "#fff";
          ctx.fillRect(mx - tw / 2 - 3, my - 8, tw + 6, 14);
          ctx.fillStyle = "#1c2333";
          ctx.textAlign = "center";
          ctx.fillText(label, mx, my + 3);
          ctx.textAlign = "start";
        }

        ctx.fillStyle = "#fff6cf";
        ctx.strokeStyle = "#c9a227";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#1c2333";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(b.ind, b.x, b.y + 4);
        ctx.textAlign = "start";
      }
    }

    // nodes
    for (const c of this.constructs) {
      const isSel = this.selected && this.selected.type === "node" && this.selected.id === c.id;
      const isInteraction = c.mode === "I";
      const isResults = !!this.annotate;
      const strokeColor = isInteraction ? "#c98a1f" : "#3457d5";
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, this.RADIUS_X, this.RADIUS_Y, 0, 0, Math.PI * 2);
      if (isResults && !isInteraction) {
        ctx.fillStyle = "#2f8fe0";
      } else {
        ctx.fillStyle = isSel ? "#dfe7ff" : (isInteraction ? "#fdf3e0" : "#eef1fd");
      }
      ctx.fill();
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.strokeStyle = strokeColor;
      ctx.setLineDash(isInteraction ? [5, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      const onBlue = isResults && !isInteraction;
      ctx.fillStyle = onBlue ? "#ffffff" : "#1c2333";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      this._wrapText(c.name, c.x, c.y - 4, this.RADIUS_X * 2 - 12, 14);

      ctx.font = "11px sans-serif";
      ctx.fillStyle = onBlue ? "#eaf2ff" : "#6b7385";
      const sub = this._subLabel(c);
      ctx.fillText(sub, c.x, c.y + this.RADIUS_Y - 10);
      ctx.textAlign = "start";
    }
  }

  _coeffColor(v) {
    return v >= 0 ? "#3457d5" : "#d64545";
  }

  _drawArrowHead(from, to, color) {
    const ctx = this.ctx;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = 10;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 7), to.y - size * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 7), to.y - size * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }

  _wrapText(text, x, y, maxWidth, lineHeight) {
    const ctx = this.ctx;
    const words = text.split(" ");
    let line = "";
    const lines = [];
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    lines.push(line);
    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
  }
}
