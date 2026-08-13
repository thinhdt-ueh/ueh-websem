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
  addConstruct(name, mode, x, y) {
    const id = "c" + Math.random().toString(36).slice(2, 9);
    this.constructs.push({ id, name, mode, indicators: [], x, y });
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
      })),
      paths: this.paths.map((p) => ({ source: p.source, target: p.target })),
    };
  }

  loadFrom(constructs, paths) {
    this.constructs = constructs.map((c) => ({ ...c }));
    this.paths = paths.map((p) => ({ ...p }));
    this.render();
  }

  // ---------- geometry ----------
  _canvasPoint(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
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
    c.addEventListener("dblclick", (e) => {
      const pt = this._canvasPoint(e);
      if (this._nodeAt(pt.x, pt.y)) return;
      this.onChange({ requestAddConstruct: pt });
    });

    c.addEventListener("mousedown", (e) => {
      const pt = this._canvasPoint(e);
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
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.dragging) return;
      const pt = this._canvasPoint(e);
      this.dragging.x = Math.max(this.RADIUS_X, Math.min(this.canvas.width - this.RADIUS_X, pt.x));
      this.dragging.y = Math.max(this.RADIUS_Y, Math.min(this.canvas.height - this.RADIUS_Y, pt.y));
      this.dragMoved = true;
      this.render();
    });

    window.addEventListener("mouseup", () => {
      if (this.dragging && this.dragMoved) this.onChange();
      this.dragging = null;
    });
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
  render() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
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

    // nodes
    for (const c of this.constructs) {
      const isSel = this.selected && this.selected.type === "node" && this.selected.id === c.id;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, this.RADIUS_X, this.RADIUS_Y, 0, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? "#dfe7ff" : "#eef1fd";
      ctx.fill();
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.strokeStyle = "#3457d5";
      ctx.stroke();

      ctx.fillStyle = "#1c2333";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      this._wrapText(c.name, c.x, c.y - 4, this.RADIUS_X * 2 - 12, 14);

      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#6b7385";
      let sub = t(c.mode === "A" ? "diagram_reflective" : "diagram_formative");
      if (this.annotate) {
        const r2 = this.annotate.r2 ? this.annotate.r2[c.id] : null;
        sub = r2 !== null && r2 !== undefined ? `R² = ${r2.toFixed(3)}` : sub;
      } else {
        sub += ` · ${c.indicators.length} ${t("s2_summary_item_suffix")}`;
      }
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
