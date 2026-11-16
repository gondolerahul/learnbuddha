// LearnBuddha Stream (client): one WebSocket → one MediaSource timeline.
// Entries arrive as JSON {type:"entry"} followed by binary init + fragments. Each entry is placed on the
// timeline with timestampOffset; truncate() cuts the buffer for splices (answers, recaps, explain-again).

export interface Word { w: string; s: number; e: number }
export interface Sentence { text: string; start: number; end: number; words: Word[] }
export interface Entry {
  eid: string; scene_id: string; kind: string; title: string; tag: string; lesson_id: string | null; lesson_title: string;
  tl_start: number; src_from: number; src_to: number; pts_offset: number; codec: string | null; timings: Sentence[]; duration: number;
}

type Op =
  | { k: "entry"; e: Entry }
  | { k: "append"; data: ArrayBuffer; eid: string }
  | { k: "remove"; start: number; end: number };

export type ServerMsg = { type: string; [k: string]: any };

const MIME = (codec: string | null) => `video/mp4; codecs="${codec ?? "avc1.4D401F"}, mp4a.40.2"`;

export class LessonStream {
  video: HTMLVideoElement;
  ws: WebSocket | null = null;
  ms: MediaSource | null = null;
  sb: SourceBuffer | null = null;
  ops: Op[] = [];
  busy = false;
  entries: Entry[] = [];
  onMessage: (m: ServerMsg) => void = () => {};
  onTts: (pcm: Int16Array, rate: number) => void = () => {};
  closed = false;
  private playheadTimer = 0;
  private gcTimer = 0;
  private sessionId: string;

  constructor(video: HTMLVideoElement, sessionId: string) {
    this.video = video;
    this.sessionId = sessionId;
  }

  start() {
    this.ms = new MediaSource();
    this.video.src = URL.createObjectURL(this.ms);
    this.ms.addEventListener("sourceopen", () => this.connect(), { once: true });
    this.playheadTimer = window.setInterval(() => this.send({ type: "playhead", tl: this.video.currentTime, playing: !this.video.paused }), 500);
    this.gcTimer = window.setInterval(() => this.gc(), 15000);
  }

  private connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/sessions/${this.sessionId}`);
    ws.binaryType = "arraybuffer";
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") this.handleJson(JSON.parse(ev.data));
      else this.handleBinary(ev.data as ArrayBuffer);
    };
    ws.onclose = () => {
      if (!this.closed) this.onMessage({ type: "disconnected" });
    };
    this.ws = ws;
  }

  close() {
    this.closed = true;
    clearInterval(this.playheadTimer);
    clearInterval(this.gcTimer);
    this.ws?.close();
    try {
      if (this.ms?.readyState === "open") this.ms.endOfStream();
    } catch { /* already closed */ }
  }

  send(m: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  sendBinary(header: object, payload: ArrayBuffer) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const h = new TextEncoder().encode(JSON.stringify(header));
    const buf = new Uint8Array(4 + h.length + payload.byteLength);
    new DataView(buf.buffer).setUint32(0, h.length, true);
    buf.set(h, 4);
    buf.set(new Uint8Array(payload), 4 + h.length);
    this.ws.send(buf);
  }

  private handleJson(m: ServerMsg) {
    // small ring buffer for debugging in devtools: window.__lbLog
    if (import.meta.env.DEV) {
      const log = ((window as any).__lbLog ??= []);
      log.push({ at: this.video.currentTime, ...m, timings: undefined, playlist: undefined, scenes: undefined });
      if (log.length > 200) log.shift();
    }
    if (m.type === "entry") {
      const e = m as unknown as Entry;
      this.entries = this.entries.filter((x) => x.tl_start < e.tl_start - 1e-6);
      this.entries.push(e);
      this.ops.push({ k: "entry", e });
      this.pump();
    } else if (m.type === "truncate") {
      const tl = m.tl as number;
      this.ops = this.ops.filter((o) => o.k === "remove");
      this.entries = this.entries.filter((x) => x.tl_start < tl - 1e-6);
      this.ops.push({ k: "remove", start: tl, end: Infinity });
      this.pump();
    }
    this.onMessage(m);
  }

  private handleBinary(buf: ArrayBuffer) {
    const n = new DataView(buf).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
    const payload = buf.slice(4 + n);
    if (header.k === "tts") {
      this.onTts(new Int16Array(payload), header.rate ?? 24000);
      return;
    }
    // ignore data for entries cut by a truncate
    if (!this.entries.some((e) => e.eid === header.eid)) return;
    this.ops.push({ k: "append", data: payload, eid: header.eid });
    this.pump();
  }

  private ensureBuffer(codec: string | null) {
    if (this.sb || !this.ms || this.ms.readyState !== "open") return;
    this.sb = this.ms.addSourceBuffer(MIME(codec));
    this.sb.mode = "segments";
    this.sb.addEventListener("updateend", () => {
      this.busy = false;
      this.pump();
    });
    this.sb.addEventListener("error", () => console.error("SourceBuffer error"));
  }

  private pump() {
    if (this.busy || !this.ops.length) return;
    const op = this.ops[0];
    if (op.k === "entry") this.ensureBuffer(op.e.codec);
    const sb = this.sb;
    if (!sb) {
      if (op.k === "remove") this.ops.shift();
      return;
    }
    if (sb.updating) return;
    this.ops.shift();
    try {
      if (op.k === "entry") {
        const e = op.e;
        sb.appendWindowEnd = Infinity;
        sb.appendWindowStart = Math.max(0, e.tl_start - 0.06);
        sb.appendWindowEnd = e.tl_start + (e.src_to - e.src_from);
        sb.timestampOffset = e.tl_start - e.src_from - (e.pts_offset || 0);
        this.pump();
      } else if (op.k === "append") {
        this.busy = true;
        sb.appendBuffer(op.data);
      } else if (op.k === "remove") {
        const end = Math.max(op.start + 0.01, this.bufferedEnd() + 1);
        if (this.bufferedEnd() > op.start) {
          this.busy = true;
          sb.remove(op.start, end);
        } else this.pump();
      }
    } catch (err) {
      console.error("MSE op failed", op.k, err);
      this.busy = false;
      if ((err as DOMException)?.name === "QuotaExceededError" && op.k === "append") {
        this.ops.unshift(op);
        this.gc(true);
      }
    }
  }

  bufferedEnd(): number {
    const b = this.sb?.buffered;
    if (!b || !b.length) return 0;
    return b.end(b.length - 1);
  }

  /** Is media buffered from t to t+ahead? */
  hasBuffered(t: number, ahead = 0.3): boolean {
    const b = this.video.buffered;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.05 && b.end(i) >= t + ahead) return true;
    return false;
  }

  private gc(force = false) {
    const sb = this.sb;
    const t = this.video.currentTime;
    if (!sb || sb.updating || !sb.buffered.length) return;
    const keep = force ? 30 : 180;
    if (t - keep > sb.buffered.start(0) + 1) {
      this.ops.unshift({ k: "remove", start: 0, end: t - keep });
      this.pump();
    }
  }

  // ── timeline helpers ──

  entryAt(tl: number): Entry | null {
    let cur: Entry | null = null;
    for (const e of this.entries) if (e.tl_start <= tl + 1e-6) cur = e;
    return cur;
  }

  mediaTime(tl: number): { e: Entry; t: number } | null {
    const e = this.entryAt(tl);
    return e ? { e, t: e.src_from + (tl - e.tl_start) } : null;
  }

  sentenceAt(tl: number): { e: Entry; i: number; s: Sentence; t: number } | null {
    const m = this.mediaTime(tl);
    if (!m) return null;
    const ts = m.e.timings || [];
    let i = -1;
    for (let j = 0; j < ts.length; j++) if (ts[j].start <= m.t + 1e-3) i = j;
    if (i < 0) return null;
    return { e: m.e, i, s: ts[i], t: m.t };
  }

  /** Timeline time of the start of the sentence playing at tl (for resume / repeat). */
  sentenceStartTl(tl: number): number {
    const s = this.sentenceAt(tl);
    if (!s) return tl;
    return Math.max(s.e.tl_start, s.e.tl_start + (s.s.start - s.e.src_from));
  }
}

// ───────────────────────────── tutor audio (24 kHz PCM) ─────────────────────────────

export class PcmPlayer {
  ctx: AudioContext | null = null;
  next = 0;
  sources = new Set<AudioBufferSourceNode>();
  onIdle: () => void = () => {};

  play(pcm: Int16Array, rate: number) {
    if (!this.ctx) this.ctx = new AudioContext();
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    this.next = Math.max(this.next, ctx.currentTime + 0.03);
    src.start(this.next);
    this.next += buf.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size) this.onIdle();
    };
  }

  get playing() {
    return this.sources.size > 0;
  }

  stop() {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    this.sources.clear();
    this.next = 0;
  }
}

// ───────────────────────────── mic capture + VAD ─────────────────────────────

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; this.acc = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    // naive decimation to 16 kHz
    for (let i = 0; i < ch.length; i++) {
      this.acc += 1;
      if (this.acc >= this.ratio) { this.acc -= this.ratio; this.buf.push(ch[i]); }
    }
    if (this.buf.length >= 320) {
      const out = new Int16Array(this.buf.length);
      for (let i = 0; i < this.buf.length; i++) out[i] = Math.max(-32768, Math.min(32767, this.buf[i] * 32767));
      this.port.postMessage({ pcm: out.buffer, rms: Math.sqrt(sum / ch.length) }, [out.buffer]);
      this.buf = [];
    }
    return true;
  }
}
registerProcessor('lb-capture', Capture);
`;

export interface MicEvents {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onChunk: (pcm: ArrayBuffer) => void;
  onLevel?: (rms: number) => void;
}

/** Always-on mic with an energy VAD: ~0.2 s of speech triggers onSpeechStart (with 0.4 s pre-roll),
 *  0.9 s of quiet ends the utterance. Echo cancellation keeps the lesson's own audio from triggering it. */
export class Mic {
  ctx: AudioContext | null = null;
  stream: MediaStream | null = null;
  node: AudioWorkletNode | null = null;
  speaking = false;
  streaming = false; // forward chunks while true
  forceTalk = false; // push-to-talk held
  private voiced = 0;
  private quiet = 0;
  private preroll: ArrayBuffer[] = [];
  private floor = 0.004;

  constructor(private ev: MicEvents) {}

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "lb-capture");
    this.node.port.onmessage = (e) => this.onFrame(e.data.pcm, e.data.rms);
    src.connect(this.node);
  }

  private onFrame(pcm: ArrayBuffer, rms: number) {
    this.ev.onLevel?.(rms);
    // adaptive noise floor
    if (!this.speaking) this.floor = this.floor * 0.995 + rms * 0.005;
    const threshold = Math.max(0.012, this.floor * 3.2);
    const voiced = this.forceTalk || rms > threshold;
    const frameSec = 320 / 16000;
    if (!this.speaking) {
      this.preroll.push(pcm);
      if (this.preroll.length > 20) this.preroll.shift();
      this.voiced = voiced ? this.voiced + frameSec : Math.max(0, this.voiced - frameSec);
      if (this.voiced >= 0.2) {
        this.speaking = true;
        this.quiet = 0;
        this.ev.onSpeechStart();
        if (this.streaming) for (const p of this.preroll) this.ev.onChunk(p);
        this.preroll = [];
      }
    } else {
      if (this.streaming) this.ev.onChunk(pcm);
      this.quiet = voiced ? 0 : this.quiet + frameSec;
      if (this.quiet >= 0.9 && !this.forceTalk) {
        this.speaking = false;
        this.voiced = 0;
        this.ev.onSpeechEnd();
      }
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null;
    this.node = null;
    this.speaking = false;
  }
}

// Browser speech recognition (text-mode fallback when the server has no live voice model).
export function speechRecognition(): any | null {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  return SR ? new SR() : null;
}
