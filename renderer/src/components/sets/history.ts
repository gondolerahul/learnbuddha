// History and geography sets.
//   Timeline   a long band of years, to scale, with eras and events; a gold line draws on to the latest event and
//              the camera can travel along it (it may be longer than the frame).
//   WorldMap   the real world (Natural Earth country shapes via world-atlas, public domain), any region of it:
//              countries light up, an empire floods out from a point, routes draw on, pins drop on places.
import type { Component, Env, Rect } from "../../types";
import { feature } from "topojson-client";
import countries110 from "world-atlas/countries-110m.json";
import { artFor, circle, line, mix } from "../../art/paint";
import { drawText, layoutText } from "../../text";
import { clamp, color, lerp, num } from "../../util";
import { frameOf, P, world } from "./common";

// ───────────────────────────── Timeline ─────────────────────────────

interface TEvent { year: number; label: string; at: number; icon?: string }

function niceStep(span: number): number {
  const raw = span / 6;
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw))));
  for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

function yearText(y: number): string {
  if (y < 0) return `${Math.round(-y)} BCE`;
  return String(Math.round(y));
}

function timelineGeom(p: any) {
  const evs: TEvent[] = (Array.isArray(p.events) ? p.events : []).map((e: any) => ({ year: num(e.year, 0), label: String(e.label ?? ""), at: num(e.at, 0), icon: e.icon }));
  const years = evs.map((e) => e.year);
  const y0 = num(p.start, years.length ? Math.min(...years) : 0);
  const y1 = num(p.end, years.length ? Math.max(...years) : 100);
  const len = Math.max(400, Math.min(4000, num(p.length, 1100)));
  const x0 = num(p.x, 640) - len / 2;
  const y = num(p.y, 400);
  const xOf = (yr: number) => x0 + ((yr - y0) / Math.max(1e-9, y1 - y0)) * len;
  return { evs, y0, y1, len, x0, y, xOf };
}

export const Timeline: Component = {
  inDur: () => 1.2,
  bounds: (_env, p) => {
    const g = timelineGeom(p);
    return { x: g.x0 - 40, y: g.y - 200, w: g.len + 80, h: 400 };
  },
  anchors: (_env, p) => {
    const g = timelineGeom(p);
    const out: Record<string, P> = { start: [g.x0, g.y], end: [g.x0 + g.len, g.y], center: [g.x0 + g.len / 2, g.y] };
    g.evs.forEach((e, i) => (out[`e${i}`] = [g.xOf(e.year), g.y]));
    return out;
  },
  parts: (_env, p) => {
    const g = timelineGeom(p);
    return [{ name: "band", rect: { x: g.x0, y: g.y - 16, w: g.len, h: 32 } }];
  },
  draw: (env, p, ph, el) => {
    const g = timelineGeom(p);
    const absT = el.at + ph.local;
    const { ctx, tokens } = env;
    const A = artFor(env, 1, { seed: 81 });
    const build = clamp(ph.local / 1.2);
    ctx.save();
    ctx.globalAlpha *= ph.alpha;
    // eras: soft bands above the line
    const eras = Array.isArray(p.eras) ? p.eras : [];
    eras.forEach((er: any, i: number) => {
      const a = g.xOf(num(er.from, g.y0)), b = g.xOf(num(er.to, g.y1));
      const k = clamp(build * 2 - 0.3 - i * 0.1);
      ctx.save();
      ctx.globalAlpha *= 0.28 * k;
      ctx.fillStyle = color(tokens, er.color ?? ["indigo", "sage", "ochre", "accent"][i % 4]);
      ctx.fillRect(a, g.y - 60, (b - a) * k, 44);
      ctx.restore();
      if (er.label) {
        const bl = layoutText(env, { text: String(er.label), x: (a + b) / 2, y: g.y - 104, size: "sm", align: "center", maxWidth: Math.max(80, b - a - 10), maxLines: 1, role: "label" });
        drawText(env, bl, "center", clamp(k * 1.4 - 0.4), "inkSoft", 1);
      }
    });
    // the band with year ticks, drawn on left to right
    const drawn = g.x0 + g.len * build;
    line(A, [[g.x0, g.y], [drawn, g.y]], "ink", 6);
    const step = niceStep(g.y1 - g.y0);
    for (let yr = Math.ceil(g.y0 / step) * step; yr <= g.y1 + 1e-9; yr += step) {
      const x = g.xOf(yr);
      if (x > drawn) break;
      line(A, [[x, g.y - 8], [x, g.y + 8]], "ink", 2);
      const tb = layoutText(env, { text: yearText(yr), x, y: g.y + 16, size: "sm", align: "center", maxWidth: 140, maxLines: 1, family: "mono" });
      drawText(env, tb, "center", 1, "muted", 0.85);
    }
    // the gold line: how far the story has come (to the latest event revealed so far)
    const shown = g.evs.filter((e) => absT >= e.at).sort((a, b) => a.year - b.year);
    if (shown.length) {
      const last = shown[shown.length - 1];
      const lead = g.evs.reduce((m, e) => (absT >= e.at ? Math.max(m, e.at) : m), -Infinity);
      const grow = clamp((absT - lead) / 0.9);
      const prevX = shown.length > 1 ? g.xOf(shown[shown.length - 2].year) : g.x0;
      const x = lerp(prevX, g.xOf(last.year), grow * grow * (3 - 2 * grow));
      line(A, [[g.x0, g.y], [x, g.y]], "gold", 7);
      // a glint riding the tip as it draws
      if (grow < 1) {
        ctx.save();
        const r = ctx.createRadialGradient(x, g.y, 0, x, g.y, 22);
        r.addColorStop(0, "rgba(255,248,210,0.95)");
        r.addColorStop(1, "rgba(255,248,210,0)");
        ctx.fillStyle = r;
        ctx.fillRect(x - 22, g.y - 22, 44, 44);
        ctx.restore();
      }
    }
    // events: a stem and a card, alternating above and below
    g.evs.forEach((e, i) => {
      if (absT < e.at) return;
      const k = clamp((absT - e.at) / 0.6);
      const x = g.xOf(e.year);
      const up = i % 2 === 0;
      const stemEnd = g.y + (up ? -1 : 1) * 70 * k;
      line(A, [[x, g.y], [x, stemEnd]], "inkSoft", 2);
      circle(A, x, g.y, 9, "accent", { lw: 2 });
      const tb = layoutText(env, { text: e.label, x, y: up ? g.y - 70 - 78 : g.y + 80, size: "md", align: "center", maxWidth: 240, maxLines: 2, role: "label" });
      const yb = layoutText(env, { text: yearText(e.year), x, y: up ? g.y - 70 - 30 : g.y + 80 + tb.rect.h + 2, size: "sm", align: "center", maxWidth: 160, maxLines: 1, family: "mono" });
      drawText(env, tb, "center", clamp(k * 1.5 - 0.3), "ink", 1);
      drawText(env, yb, "center", clamp(k * 1.5 - 0.5), "accent", 1);
    });
    ctx.restore();
  },
};

// ───────────────────────────── WorldMap ─────────────────────────────

type Ring = [number, number][];
interface Country { name: string; rings: Ring[]; lon: number; lat: number }

let COUNTRIES: Country[] | null = null;
function countries(): Country[] {
  if (COUNTRIES) return COUNTRIES;
  const fc: any = feature(countries110 as any, (countries110 as any).objects.countries);
  COUNTRIES = fc.features.map((f: any) => {
    const polys: any[] = f.geometry?.type === "Polygon" ? [f.geometry.coordinates] : f.geometry?.type === "MultiPolygon" ? f.geometry.coordinates : [];
    const rings: Ring[] = [];
    let best: Ring = [];
    for (const poly of polys) {
      rings.push(...poly);
      if ((poly[0]?.length ?? 0) > best.length) best = poly[0];
    }
    // the centroid of the largest outer ring (good enough to pin a label or aim the camera)
    let lon = 0, lat = 0;
    for (const [x, y] of best) {
      lon += x;
      lat += y;
    }
    const n = Math.max(1, best.length);
    return { name: String(f.properties?.name ?? ""), rings, lon: lon / n, lat: lat / n };
  });
  return COUNTRIES!;
}

const ALIAS: Record<string, string> = {
  usa: "United States of America", "united states": "United States of America", us: "United States of America", america: "United States of America",
  uk: "United Kingdom", britain: "United Kingdom", "great britain": "United Kingdom", england: "United Kingdom",
  russia: "Russia", "south korea": "South Korea", "north korea": "North Korea", congo: "Dem. Rep. Congo", drc: "Dem. Rep. Congo",
  "czech republic": "Czechia", "ivory coast": "Côte d'Ivoire", burma: "Myanmar", persia: "Iran", holland: "Netherlands",
  "south sudan": "S. Sudan", "central african republic": "Central African Rep.", "bosnia": "Bosnia and Herz.", "dominican republic": "Dominican Rep.",
};

function findCountry(name: string): Country | undefined {
  const n = String(name).trim().toLowerCase();
  const target = (ALIAS[n] ?? name).toLowerCase();
  return countries().find((c) => c.name.toLowerCase() === target) ?? countries().find((c) => c.name.toLowerCase().startsWith(target));
}

/** Places a lesson may name (approximate latitude, longitude). */
const CITIES: Record<string, [number, number]> = {
  london: [51.51, -0.13], paris: [48.86, 2.35], berlin: [52.52, 13.4], rome: [41.9, 12.5], madrid: [40.42, -3.7], lisbon: [38.72, -9.14],
  athens: [37.98, 23.73], istanbul: [41.01, 28.98], constantinople: [41.01, 28.98], moscow: [55.76, 37.62], cairo: [30.04, 31.24],
  alexandria: [31.2, 29.92], baghdad: [33.31, 44.36], babylon: [32.54, 44.42], tehran: [35.69, 51.39], jerusalem: [31.77, 35.21],
  mecca: [21.39, 39.86], delhi: [28.61, 77.21], "new delhi": [28.61, 77.21], mumbai: [19.08, 72.88], kolkata: [22.57, 88.36],
  chennai: [13.08, 80.27], bengaluru: [12.97, 77.59], bangalore: [12.97, 77.59], karachi: [24.86, 67.01], kathmandu: [27.72, 85.32],
  dhaka: [23.81, 90.41], beijing: [39.9, 116.41], shanghai: [31.23, 121.47], "hong kong": [22.32, 114.17], "xi'an": [34.34, 108.94],
  tokyo: [35.68, 139.69], seoul: [37.57, 126.98], bangkok: [13.76, 100.5], singapore: [1.35, 103.82], jakarta: [-6.21, 106.85],
  manila: [14.6, 120.98], sydney: [-33.87, 151.21], melbourne: [-37.81, 144.96], canberra: [-35.28, 149.13], auckland: [-36.85, 174.76],
  "new york": [40.71, -74.01], washington: [38.91, -77.04], "los angeles": [34.05, -118.24], chicago: [41.88, -87.63],
  "san francisco": [37.77, -122.42], toronto: [43.65, -79.38], "mexico city": [19.43, -99.13], havana: [23.11, -82.37], lima: [-12.05, -77.04],
  bogota: [4.71, -74.07], "rio de janeiro": [-22.91, -43.17], "sao paulo": [-23.55, -46.63], "buenos aires": [-34.6, -58.38],
  santiago: [-33.45, -70.67], lagos: [6.52, 3.38], nairobi: [-1.29, 36.82], "addis ababa": [8.98, 38.76], johannesburg: [-26.2, 28.05],
  "cape town": [-33.92, 18.42], kinshasa: [-4.44, 15.27], casablanca: [33.57, -7.59], timbuktu: [16.77, -3.01], carthage: [36.86, 10.33],
  ulaanbaatar: [47.89, 106.91], karakorum: [47.2, 102.82], samarkand: [39.65, 66.96], kabul: [34.56, 69.21], riyadh: [24.71, 46.68],
  dubai: [25.2, 55.27], venice: [45.44, 12.32], vienna: [48.21, 16.37], amsterdam: [52.37, 4.9], stockholm: [59.33, 18.07],
  oslo: [59.91, 10.75], copenhagen: [55.68, 12.57], warsaw: [52.23, 21.01], kyiv: [50.45, 30.52], honolulu: [21.31, -157.86],
  anchorage: [61.22, -149.9], reykjavik: [64.15, -21.94],
};

const VIEWS: Record<string, [number, number, number, number]> = {
  // lon0, lat0, lon1, lat1
  world: [-170, -58, 180, 80], europe: [-14, 33, 45, 66], asia: [25, -10, 150, 60], africa: [-20, -36, 54, 38],
  americas: [-170, -56, -30, 72], "north america": [-170, 12, -50, 72], "south america": [-85, -56, -32, 14], india: [66, 5, 99, 37],
  "south asia": [60, 2, 100, 38], "middle east": [24, 12, 63, 42], "east asia": [95, 15, 150, 52], oceania: [105, -48, 180, 0],
  mediterranean: [-8, 28, 40, 48],
};

/** Natural Earth I projection (Šavrič et al.), as d3-geo implements it; λ, φ in radians. */
function ne1(lon: number, lat: number): P {
  const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180;
  const p2 = p * p, p4 = p2 * p2;
  return [
    l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
    p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
  ];
}

function mapGeom(p: any) {
  const v = Array.isArray(p.view) && p.view.length === 4 ? (p.view as number[]) : VIEWS[String(p.view ?? "world").toLowerCase()] ?? VIEWS.world;
  const [lon0, lat0, lon1, lat1] = v;
  const a = ne1(lon0, lat0), b = ne1(lon1, lat1), c = ne1(lon0, lat1), d = ne1(lon1, lat0);
  const minX = Math.min(a[0], c[0]), maxX = Math.max(b[0], d[0]);
  const minY = Math.min(a[1], d[1]), maxY = Math.max(b[1], c[1]);
  const w = num(p.width, 1120), h = num(p.height, 600);
  const s = Math.min(w / (maxX - minX), h / (maxY - minY));
  const cx = num(p.x, 640), cy = num(p.y, 390);
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const proj = (lon: number, lat: number): P => {
    const q = ne1(lon, lat);
    return [cx + (q[0] - mx) * s, cy - (q[1] - my) * s];
  };
  const box: Rect = { x: cx - ((maxX - minX) * s) / 2, y: cy - ((maxY - minY) * s) / 2, w: (maxX - minX) * s, h: (maxY - minY) * s };
  return { proj, box, s, key: `${v.join(",")}|${w}|${h}|${cx}|${cy}` };
}

function placeOf(ref: any): [number, number] | null {
  if (Array.isArray(ref) && ref.length >= 2) return [num(ref[1], 0), num(ref[0], 0)]; // [lat, lon] → (lon, lat) below
  const n = String(ref ?? "").toLowerCase().trim();
  if (CITIES[n]) return [CITIES[n][1], CITIES[n][0]];
  const c = findCountry(n);
  return c ? [c.lon, c.lat] : null;
}

function tracePoly(ctx: any, proj: (lon: number, lat: number) => P, ring: Ring) {
  let prevLon: number | null = null;
  ring.forEach(([lon, lat], i) => {
    const [x, y] = proj(lon, lat);
    if (i === 0 || (prevLon !== null && Math.abs(lon - prevLon) > 180)) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    prevLon = lon;
  });
  ctx.closePath();
}

const baseCache = new Map<string, any>();

/** The land, ocean and graticule, painted once per kit and view at twice the logical resolution. */
function mapBase(env: Env, p: any, g: ReturnType<typeof mapGeom>): any {
  const key = `${env.tokens.id}|${g.key}|${p.ocean ?? ""}|${p.land ?? ""}`;
  let c = baseCache.get(key);
  if (c) return c;
  const S = 2;
  c = env.makeCanvas(Math.ceil(g.box.w * S) + 4, Math.ceil(g.box.h * S) + 4);
  const gc = c.getContext("2d");
  gc.scale(S, S);
  gc.translate(-g.box.x + 1, -g.box.y + 1);
  const { tokens } = env;
  const A = artFor({ ...env, ctx: gc } as Env, S, { seed: 91 });
  // ocean
  gc.fillStyle = A.c(p.ocean ?? "waterLight");
  gc.globalAlpha = 0.55;
  gc.fillRect(g.box.x - 1, g.box.y - 1, g.box.w + 2, g.box.h + 2);
  gc.globalAlpha = 1;
  // graticule
  gc.strokeStyle = mix(A.c(p.ocean ?? "waterLight"), -0.15);
  gc.lineWidth = 0.6;
  gc.globalAlpha = 0.5;
  for (let lon = -180; lon <= 180; lon += 30) {
    gc.beginPath();
    for (let lat = -80; lat <= 85; lat += 5) {
      const [x, y] = g.proj(lon, lat);
      if (lat === -80) gc.moveTo(x, y);
      else gc.lineTo(x, y);
    }
    gc.stroke();
  }
  for (let lat = -60; lat <= 80; lat += 20) {
    gc.beginPath();
    for (let lon = -180; lon <= 180; lon += 5) {
      const [x, y] = g.proj(lon, lat);
      if (lon === -180) gc.moveTo(x, y);
      else gc.lineTo(x, y);
    }
    gc.stroke();
  }
  gc.globalAlpha = 1;
  // land, then borders
  gc.fillStyle = A.c(p.land ?? "sand");
  gc.beginPath();
  for (const c2 of countries()) for (const r of c2.rings) tracePoly(gc, g.proj, r);
  gc.fill("evenodd");
  gc.strokeStyle = color(tokens, "inkSoft");
  gc.lineWidth = 0.8;
  gc.globalAlpha = 0.55;
  gc.stroke();
  baseCache.set(key, c);
  if (baseCache.size > 12) baseCache.delete(baseCache.keys().next().value!);
  return c;
}

export const WorldMap: Component = {
  inDur: () => 1,
  bounds: (_env, p) => mapGeom(p).box,
  anchors: (_env, p) => {
    const g = mapGeom(p);
    const out: Record<string, P> = { center: [g.box.x + g.box.w / 2, g.box.y + g.box.h / 2] };
    const names = new Set<string>();
    for (const r of Array.isArray(p.regions) ? p.regions : []) names.add(String(r?.name ?? r));
    for (const r of Array.isArray(p.pins) ? p.pins : []) names.add(String(r?.place ?? r?.name ?? ""));
    for (const r of Array.isArray(p.routes) ? p.routes : []) {
      names.add(String(r?.from ?? ""));
      names.add(String(r?.to ?? ""));
    }
    if (p.flood?.from) names.add(String(p.flood.from));
    for (const n of names) {
      const pl = placeOf(n);
      if (pl) out[n.replace(/\s+/g, "")] = g.proj(pl[0], pl[1]);
    }
    return out;
  },
  draw: (env, p, ph, el) => {
    const g = mapGeom(p);
    const absT = el.at + ph.local;
    const { ctx, tokens } = env;
    const A = artFor(env, 1, { seed: 93 });
    ctx.save();
    ctx.globalAlpha *= ph.alpha * clamp(ph.local / 0.8);
    const base = mapBase(env, p, g);
    ctx.drawImage(base, g.box.x - 1, g.box.y - 1, base.width / 2, base.height / 2);
    // everything on the map stays inside its frame (a highlighted Russia must not spill over the page)
    ctx.beginPath();
    ctx.rect(g.box.x, g.box.y, g.box.w, g.box.h);
    ctx.clip();
    // regions light up (a fill that rises in, then holds)
    const fillCountry = (c: Country, col: string, a: number) => {
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.beginPath();
      for (const r of c.rings) tracePoly(ctx, g.proj, r);
      ctx.fillStyle = col;
      ctx.fill("evenodd");
      ctx.strokeStyle = mix(col, -0.35);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    };
    for (const r of Array.isArray(p.regions) ? p.regions : []) {
      const c = findCountry(String(r?.name ?? r));
      if (!c) {
        env.warn(el.id, `no country named '${r?.name ?? r}' on the map`);
        continue;
      }
      const at = num(r?.at, el.at);
      if (absT < at) continue;
      fillCountry(c, color(tokens, r?.color ?? "accent"), clamp((absT - at) / 0.6) * 0.92);
    }
    // an empire (or a language, a disease…) spreading from a point: each country fills as the wave reaches it
    if (p.flood && Array.isArray(p.flood.regions)) {
      const o = placeOf(p.flood.from);
      const at = num(p.flood.at, el.at);
      if (o && absT >= at) {
        const [ox, oy] = g.proj(o[0], o[1]);
        const dur = Math.max(0.5, num(p.flood.dur, 3));
        const list = p.flood.regions.map((n: any) => findCountry(String(n))).filter(Boolean) as Country[];
        const far = Math.max(1, ...list.map((c) => Math.hypot(g.proj(c.lon, c.lat)[0] - ox, g.proj(c.lon, c.lat)[1] - oy)));
        const front = ((absT - at) / dur) * far * 1.1;
        for (const c of list) {
          const [cx, cy] = g.proj(c.lon, c.lat);
          const d = Math.hypot(cx - ox, cy - oy);
          fillCountry(c, color(tokens, p.flood.color ?? "accent"), clamp((front - d) / 60) * 0.92);
        }
        const pulse = (absT - at) % 1.2;
        ctx.save();
        ctx.strokeStyle = color(tokens, p.flood.color ?? "accent");
        ctx.lineWidth = 2.5;
        ctx.globalAlpha *= 1 - pulse / 1.2;
        ctx.beginPath();
        ctx.arc(ox, oy, 6 + pulse * 40, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        circle(A, ox, oy, 6, p.flood.color ?? "accent", { lw: 2 });
      }
    }
    // routes: a bowed path draws on, with a traveller at its tip
    for (const r of Array.isArray(p.routes) ? p.routes : []) {
      const a = placeOf(r?.from), b = placeOf(r?.to);
      if (!a || !b) {
        env.warn(el.id, `route place not found: ${r?.from} → ${r?.to}`);
        continue;
      }
      const at = num(r?.at, el.at);
      if (absT < at) continue;
      const k = clamp((absT - at) / Math.max(0.4, num(r?.dur, 1.8)));
      const pa = g.proj(a[0], a[1]), pb = g.proj(b[0], b[1]);
      const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2 - Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * 0.22;
      const pts: P[] = [];
      for (let i = 0; i <= 40 * k; i++) {
        const s = i / 40, u = 1 - s;
        pts.push([u * u * pa[0] + 2 * u * s * mx + s * s * pb[0], u * u * pa[1] + 2 * u * s * my + s * s * pb[1]]);
      }
      ctx.save();
      ctx.setLineDash([10, 7]);
      if (pts.length > 1) line(A, pts, r?.color ?? "accent", 3.5);
      ctx.restore();
      if (pts.length) circle(A, pts[pts.length - 1][0], pts[pts.length - 1][1], 7, r?.color ?? "accent", { lw: 2 });
      circle(A, pa[0], pa[1], 5, "ink", { stroke: false });
      if (r?.label && k > 0.5) {
        const lb = layoutText(env, { text: String(r.label), x: mx, y: my - 34, size: "sm", align: "center", maxWidth: 220, maxLines: 1, role: "label" });
        drawText(env, lb, "center", clamp((k - 0.5) * 2), "ink", 1);
      }
    }
    // pins on named places
    for (const pin of Array.isArray(p.pins) ? p.pins : []) {
      const pl = placeOf(pin?.place ?? pin?.name);
      if (!pl) continue;
      const at = num(pin?.at, el.at);
      if (absT < at) continue;
      const k = clamp((absT - at) / 0.5);
      const [x, y] = g.proj(pl[0], pl[1]);
      const drop = (1 - k) * -30;
      line(A, [[x, y + drop - 26], [x, y + drop]], "ink", 3, k);
      circle(A, x, y + drop - 30, 9, pin?.color ?? "accent", { lw: 2, alpha: k });
      const text = String(pin?.label ?? pin?.place ?? pin?.name ?? "");
      if (text) {
        const lb = layoutText(env, { text, x: x + 14, y: y + drop - 52, size: "sm", align: "left", maxWidth: 220, maxLines: 1, role: "label" });
        drawText(env, lb, "left", clamp(k * 1.5 - 0.3), "ink", 1);
      }
    }
    ctx.restore();
  },
};

export const MAP_VIEWS = Object.keys(VIEWS);
export const MAP_PLACES = Object.keys(CITIES);
export { world, frameOf };
