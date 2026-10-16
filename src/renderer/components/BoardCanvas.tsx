import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { Bounds, Motion, Stroke, XYZ } from "../../shared/model";
import { motionPoint } from "../../core/program";
import { useT } from "../i18n";

interface Props {
  strokes: (Stroke & { muted?: boolean })[];
  bounds: Bounds;
  width?: number;
  motions?: Motion[];
  motionIndex?: number;
  motionFraction?: number;
  cursor?: XYZ;
  showTravel?: boolean;
  dimensions?: boolean;
  fitKey?: string;
  children?: React.ReactNode;
}
const cyan = "#19e2db",
  gray = "#758b99";

function appendMotion(
  ctx: CanvasRenderingContext2D,
  motion: Motion,
  fraction: number,
  width: number,
) {
  if (motion.operation !== "draw" || fraction <= 0) return;
  const end = motionPoint(motion, fraction);
  ctx.moveTo(motion.from[0], motion.from[1]);
  ctx.lineTo(end[0], end[1]);
  if (motion.from[0] === motion.to[0] && motion.from[1] === motion.to[1])
    ctx.arc(end[0], end[1], width / 2, 0, 2 * Math.PI);
}
export function BoardCanvas({
  strokes,
  bounds,
  width = 0.22,
  motions,
  motionIndex = -1,
  motionFraction = 1,
  cursor,
  showTravel = false,
  dimensions = true,
  fitKey,
  children,
}: Props) {
  const t = useT(),
    host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<[number, number]>([900, 650]);
  const backdrop = useRef<HTMLCanvasElement | null>(null);
  const completed = useRef<{
    canvas: HTMLCanvasElement;
    through: number;
  } | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1, baseScale: 1 });
  const [zoomMenu, setZoomMenu] = useState(false);
  const zoomControls = useRef<HTMLDivElement>(null);
  const fitScale = Math.max(
    0.01,
    Math.min(
      (size[0] - 170) / Math.max(bounds[2] - bounds[0], 1),
      (size[1] - 155) / Math.max(bounds[3] - bounds[1], 1),
    ),
  );
  const drag = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);
  const fit = () => {
    const w = bounds[2] - bounds[0],
      h = bounds[3] - bounds[1];
    const scale = fitScale;
    setCamera({
      x: size[0] / 2 - (bounds[0] + w / 2) * scale,
      y: size[1] / 2 + (bounds[1] + h / 2) * scale + 12,
      scale,
      baseScale: scale,
    });
  };
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) setSize([r.width, r.height]);
    });
    if (host.current) ro.observe(host.current);
    return () => ro.disconnect();
  }, []);
  useEffect(fit, [size[0], size[1], fitKey]);
  const basePath = useMemo(() => {
    const paths = {
      normal: new Path2D(),
      muted: new Path2D(),
      pads: new Path2D(),
      mutedPads: new Path2D(),
    };
    for (const s of strokes) {
      const p =
        s.kind === "pad"
          ? s.muted
            ? paths.mutedPads
            : paths.pads
          : s.muted
            ? paths.muted
            : paths.normal;
      s.points.forEach((v, i) =>
        i ? p.lineTo(v[0], v[1]) : p.moveTo(v[0], v[1]),
      );
      if (s.points.length === 1)
        p.arc(s.points[0][0], s.points[0][1], width / 2, 0, 2 * Math.PI);
    }
    return paths;
  }, [strokes, width]);
  const zoom = (direction: number, x = size[0] / 2, y = size[1] / 2) =>
    setCamera((c) => {
      const percent = Math.round((c.scale / c.baseScale) * 100);
      const scale =
        (Math.max(10, Math.min(2000, percent + direction * 10)) / 100) *
        c.baseScale;
      const f = scale / c.scale;
      return { ...c, scale, x: x - (x - c.x) * f, y: y - (y - c.y) * f };
    });
  useEffect(() => {
    const el = host.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.deltaY) return;
      const r = el.getBoundingClientRect();
      zoom(
        event.deltaY < 0 ? 1 : -1,
        event.clientX - r.left,
        event.clientY - r.top,
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [size, fitScale]);
  useEffect(() => {
    if (!zoomMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (!zoomControls.current?.contains(event.target as Node))
        setZoomMenu(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomMenu(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", key);
    };
  }, [zoomMenu]);
  useEffect(() => {
    // Grid, unvisited paths, transfers and rulers change only with the view.
    const element = (backdrop.current ??= document.createElement("canvas"));
    completed.current = null;
    const ctx = element.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(size[0] * dpr);
    element.height = Math.round(size[1] * dpr);
    ctx.scale(dpr, dpr);
    const [w, h] = size,
      { x: ox, y: oy, scale } = camera;
    ctx.fillStyle = "#09181f";
    ctx.fillRect(0, 0, w, h);
    const left = 38,
      top = 39;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, w - left - 12, h - top - 12);
    ctx.clip();
    const step = scale > 4 ? 1 : scale > 1 ? 5 : 10;
    const x0 = Math.floor((left - ox) / scale / step) * step,
      x1 = (w - ox) / scale;
    const y0 = Math.floor((oy - h) / scale / step) * step,
      y1 = (oy - top) / scale;
    ctx.lineWidth = 0.6;
    for (let x = x0; x <= x1; x += step) {
      ctx.strokeStyle = x % 10 === 0 ? "#29404a" : "#152c35";
      ctx.beginPath();
      ctx.moveTo(ox + x * scale, top);
      ctx.lineTo(ox + x * scale, h);
      ctx.stroke();
    }
    for (let y = y0; y <= y1; y += step) {
      ctx.strokeStyle = y % 10 === 0 ? "#29404a" : "#152c35";
      ctx.beginPath();
      ctx.moveTo(left, oy - y * scale);
      ctx.lineTo(w, oy - y * scale);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, -scale);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(width, 1.15 / scale);
    ctx.strokeStyle = motions ? "#607685" : "#237c86";
    ctx.stroke(basePath.muted);
    ctx.strokeStyle = motions ? "#607685" : cyan;
    ctx.stroke(basePath.normal);
    ctx.strokeStyle = motions ? "#607685" : "#8195a2";
    ctx.stroke(basePath.mutedPads);
    ctx.strokeStyle = motions ? "#607685" : "#c5d1da";
    ctx.stroke(basePath.pads);
    if (motions) {
      if (showTravel) {
        ctx.strokeStyle = "#6c8592";
        ctx.lineWidth = 1 / scale;
        ctx.setLineDash([2 / scale, 4 / scale]);
        ctx.beginPath();
        for (const m of motions)
          if (m.operation === "travel") {
            ctx.moveTo(m.from[0], m.from[1]);
            ctx.lineTo(m.to[0], m.to[1]);
          }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
    if (dimensions) {
      const [bx0, by0, bx1, by1] = bounds,
        l = ox + bx0 * scale,
        r = ox + bx1 * scale,
        b = oy - by0 * scale,
        tp = oy - by1 * scale;
      ctx.strokeStyle = cyan;
      ctx.fillStyle = "#d7e5ec";
      ctx.lineWidth = 1;
      ctx.font = '14px "JetBrains Mono"';
      ctx.textAlign = "center";
      const arrow = (x: number, y: number, dx: number, dy: number) => {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx * 7 - dy * 3, y + dy * 7 + dx * 3);
        ctx.lineTo(x + dx * 7 + dy * 3, y + dy * 7 - dx * 3);
        ctx.closePath();
        ctx.fillStyle = cyan;
        ctx.fill();
      };
      ctx.beginPath();
      ctx.moveTo(l, tp - 12);
      ctx.lineTo(l, tp - 40);
      ctx.moveTo(r, tp - 12);
      ctx.lineTo(r, tp - 40);
      ctx.moveTo(l, tp - 28);
      ctx.lineTo(r, tp - 28);
      ctx.moveTo(l - 12, tp);
      ctx.lineTo(l - 40, tp);
      ctx.moveTo(l - 12, b);
      ctx.lineTo(l - 40, b);
      ctx.moveTo(l - 28, tp);
      ctx.lineTo(l - 28, b);
      ctx.stroke();
      arrow(l, tp - 28, 1, 0);
      arrow(r, tp - 28, -1, 0);
      arrow(l - 28, tp, 0, 1);
      arrow(l - 28, b, 0, -1);
      ctx.fillStyle = "#d7e5ec";
      ctx.fillText(
        `${+(bx1 - bx0).toFixed(2)} ${t("mm")}`,
        (l + r) / 2,
        tp - 37,
      );
      ctx.save();
      ctx.translate(l - 39, (tp + b) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`${+(by1 - by0).toFixed(2)} ${t("mm")}`, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = "#3d515e";
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, w - left - 12, h - top - 12);
    ctx.fillStyle = "#9cafbc";
    ctx.font = '10px "JetBrains Mono"';
    ctx.textAlign = "center";
    const rulerStep = scale > 5 ? 10 : 20;
    for (let x = Math.ceil((left - ox) / scale); ox + x * scale < w - 12; x++) {
      const sx = ox + x * scale;
      ctx.beginPath();
      ctx.moveTo(sx, top);
      ctx.lineTo(sx, top - (x % rulerStep === 0 ? 10 : 5));
      ctx.stroke();
      if (x % rulerStep === 0) ctx.fillText(String(x), sx, top - 16);
    }
    ctx.textAlign = "right";
    for (let y = Math.ceil((oy - h + 12) / scale); oy - y * scale > top; y++) {
      const sy = oy - y * scale;
      ctx.beginPath();
      ctx.moveTo(left, sy);
      ctx.lineTo(left - (y % rulerStep === 0 ? 10 : 5), sy);
      ctx.stroke();
      if (y % rulerStep === 0) ctx.fillText(String(y), left - 14, sy + 3);
    }
    ctx.fillStyle = gray;
    ctx.fillText(t("mm"), left - 7, top - 13);
  }, [
    basePath,
    camera,
    size,
    width,
    motions,
    showTravel,
    dimensions,
    bounds,
    t,
  ]);
  useEffect(() => {
    const background = backdrop.current;
    const element = canvas.current;
    if (!background || !element) return;
    const ctx = element.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const { x: ox, y: oy, scale } = camera;
    const [w, h] = size;
    if (element.width !== background.width) element.width = background.width;
    if (element.height !== background.height)
      element.height = background.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(background, 0, 0);
    const clip = (context: CanvasRenderingContext2D) => {
      context.scale(dpr, dpr);
      context.beginPath();
      context.rect(38, 39, w - 50, h - 51);
      context.clip();
    };
    const routeTransform = (context: CanvasRenderingContext2D) => {
      context.translate(ox, oy);
      context.scale(scale, -scale);
      context.lineJoin = "round";
      context.lineCap = "round";
      context.strokeStyle = cyan;
      context.lineWidth = Math.max(width, 1.15 / scale);
    };
    if (motions) {
      const through = Math.min(motionIndex - 1, motions.length - 1);
      if (!completed.current || through < completed.current.through) {
        const layer = document.createElement("canvas");
        layer.width = background.width;
        layer.height = background.height;
        const context = layer.getContext("2d")!;
        clip(context);
        routeTransform(context);
        completed.current = { canvas: layer, through: -1 };
      }
      const cache = completed.current;
      if (through > cache.through) {
        const context = cache.canvas.getContext("2d")!;
        context.beginPath();
        for (let i = cache.through + 1; i <= through; i++)
          appendMotion(context, motions[i], 1, width);
        context.stroke();
        cache.through = through;
      }
      ctx.drawImage(cache.canvas, 0, 0);
    }
    ctx.save();
    clip(ctx);
    const current = motions?.[motionIndex];
    if (current) {
      ctx.save();
      routeTransform(ctx);
      ctx.beginPath();
      appendMotion(ctx, current, motionFraction, width);
      ctx.stroke();
      ctx.restore();
    }
    if (cursor) {
      const x = ox + cursor[0] * scale,
        y = oy - cursor[1] * scale;
      ctx.strokeStyle = "#ffcc54";
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, 2 * Math.PI);
      ctx.moveTo(x - 12, y);
      ctx.lineTo(x + 12, y);
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x, y + 12);
      ctx.stroke();
    }
    ctx.restore();
  }, [
    basePath,
    camera,
    size,
    width,
    motions,
    motionIndex,
    motionFraction,
    cursor,
    showTravel,
    dimensions,
    bounds,
    t,
  ]);
  return (
    <div className="board-canvas" ref={host}>
      <canvas
        ref={canvas}
        onPointerDown={(e) => {
          if (![0, 1].includes(e.button)) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            startX: camera.x,
            startY: camera.y,
          };
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const d = drag.current;
            setCamera((c) => ({
              ...c,
              x: d.startX + e.clientX - d.x,
              y: d.startY + e.clientY - d.y,
            }));
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
      <div className="zoom-tools" ref={zoomControls}>
        {zoomMenu && (
          <div className="zoom-menu" role="menu">
            <button
              role="menuitem"
              autoFocus
              onClick={() => {
                fit();
                setZoomMenu(false);
              }}
            >
              {t("reset")}
            </button>
          </div>
        )}
        <div className="zoom-pill">
          <button title={t("zoomOut")} onClick={() => zoom(-1)}>
            <Minus size={17} />
          </button>
          <button
            className="zoom-value"
            aria-haspopup="menu"
            aria-expanded={zoomMenu}
            onClick={() => setZoomMenu((v) => !v)}
          >
            {Math.round((camera.scale / camera.baseScale) * 100)}%
          </button>
          <button title={t("zoomIn")} onClick={() => zoom(1)}>
            <Plus size={17} />
          </button>
        </div>
        <button className="icon-button" title={t("fit")} onClick={fit}>
          <Maximize size={18} />
        </button>
      </div>
      {children}
    </div>
  );
}
