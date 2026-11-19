"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

/**
 * Análise visual com zoom.
 * 1) Carrega/cola o gráfico. 2) Arrasta para selecionar a zona (zoom do palco para precisão).
 * 3) A IA analisa SÓ essa zona, com o gráfico inteiro como contexto. O recorte é feito no servidor
 *    a partir do ficheiro original, por isso chega à IA na resolução nativa (ampliado se for pequeno).
 */

type Region = { x: number; y: number; w: number; h: number };
type Asset = "XAUUSD" | "SOLUSD";

type Scenario = {
  probability: number;
  thesis: string;
  triggers: string[];
  entry_zone: { low: number; high: number } | null;
  invalidation: { price: number; reason: string } | null;
  targets: { price: number; label?: string }[];
} | null;

type Result = {
  id?: number;
  asset: Asset;
  horizon: "day" | "swing";
  timeframe: string | null;
  analysis: {
    data_quality: { price_axis_readable: boolean; timeframe_detected: string | null; notes: string };
    zone_summary: string;
    reading: Record<"candles" | "volume" | "structure" | "liquidity" | "wyckoff" | "elliott", string>;
    context_from_full_chart: string;
    key_levels: { price: number; type: string; note: string }[];
    bias: "bullish" | "bearish" | "neutral";
    scenarios: { bullish: Scenario; bearish: Scenario };
    trade_plan: { confluences: string[]; stop_logic: string; invalidation: string; confidence: number; checklist: Record<string, boolean> } | null;
    no_trade_reason: string;
    kb_refs: string[];
  };
  plan: {
    direction: "long" | "short";
    entryZone: { low: number; high: number };
    stopLoss: number;
    targets: { price: number; label?: string }[];
    confluences: string[];
    checklist: Record<string, boolean>;
  } | null;
  validation: {
    status: "valid" | "watch" | "rejected";
    errors: string[];
    warnings: string[];
    entryMid: number;
    stopPct: number;
    rrWorst: number | null;
    targetsRR: { price: number; label?: string; rr: number }[];
    missingChecklist: string[];
    limits: { minStopPct: number; maxStopPct: number; rrMin: number };
  } | null;
  scenarioChecks: { side: "bullish" | "bearish"; warnings: string[] }[];
  sizing: { lots: number; actualRisk: number; ok: boolean; reason?: string } | null;
  riskPct: number;
  kb: { ref: string; title: string; source: string }[];
  images?: { cropPreview?: string; meta?: { sourceWidth: number; sourceHeight: number; upscale: number; priceAxisAppended: boolean; cropOutPx: { width: number; height: number } } };
};

type HistoryRow = { id: number; asset: string; horizon: string; timeframe: string | null; summary: string; bias: string; plan_status: string; created_at: string };

const TFS = ["", "M5", "M15", "H1", "H4", "D1", "W1"];
const ZOOMS = [1, 1.5, 2, 3];
const READING_LABELS: Record<string, string> = {
  candles: "Velas", volume: "Volume", structure: "Estrutura (SMC)", liquidity: "Liquidez", wyckoff: "Wyckoff", elliott: "Elliott",
};
const CHECK_LABELS: Record<string, string> = {
  htf_bias_aligned: "Bias HTF alinhado",
  liquidity_taken: "Liquidez capturada",
  structure_shift_confirmed: "CHoCH/MSS confirmado",
  entry_at_poi: "Entrada em POI (desconto/prémio)",
  sl_beyond_invalidation: "SL além da invalidação",
  rr_ok: "R:R mínimo",
  no_high_impact_news: "Sem notícia forte",
};
const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  valid: { bg: "var(--green-dim)", fg: "var(--green)", label: "EXECUTÁVEL" },
  watch: { bg: "var(--amber-dim)", fg: "var(--amber)", label: "VIGIAR — falta gatilho" },
  rejected: { bg: "var(--red-dim)", fg: "var(--red)", label: "REJEITADO" },
};

const fmt = (n: number | null | undefined, asset: Asset) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: asset === "SOLUSD" ? 3 : 2 });

export default function AnaliseVisualPage() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number } | null>(null);
  /** Faixa do eixo de preço (fracções da largura). null = margem direita do gráfico. */
  const [axis, setAxis] = useState<{ x: number; w: number } | null>(null);
  const [mode, setMode] = useState<"zone" | "axis">("zone");
  const [stageZoom, setStageZoom] = useState(1);
  const [asset, setAsset] = useState<Asset>("XAUUSD");
  const [horizon, setHorizon] = useState<"auto" | "day" | "swing">("auto");
  const [timeframe, setTimeframe] = useState("");
  const [question, setQuestion] = useState("");
  const [priceHint, setPriceHint] = useState("");
  const [includeAxis, setIncludeAxis] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const loadHistory = useCallback(() => {
    fetch("/api/chart-zoom").then((r) => r.json()).then((d) => setHistory(d.analyses || [])).catch(() => {});
  }, []);
  useEffect(loadHistory, [loadHistory]);

  // A faixa do eixo repete-se entre screenshots do mesmo layout: lembra-a neste browser
  // (lida quando a imagem carrega, gravada sempre que muda).
  const restoreAxis = () => {
    try {
      const v = localStorage.getItem("zoom-axis");
      if (v) setAxis((a) => a ?? JSON.parse(v));
    } catch {}
  };
  useEffect(() => {
    try {
      if (axis) localStorage.setItem("zoom-axis", JSON.stringify(axis));
      else localStorage.removeItem("zoom-axis");
    } catch {}
  }, [axis]);

  // ---------- Upload (ficheiro, arrastar ou colar) ----------
  const upload = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Falha no upload");
      setImageUrl(d.url);
      setRegion(null);
      setResult(null);
      setStageZoom(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no upload");
    } finally {
      setUploading(false);
    }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      const f = item?.getAsFile();
      if (f) upload(f);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRegion(null);
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, [upload]);

  // ---------- Seleção (coordenadas normalizadas à imagem) ----------
  const toNorm = (e: React.PointerEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const onDown = (e: React.PointerEvent) => {
    if (!imgRef.current) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toNorm(e);
    setDrag({ x0: p.x, y0: p.y });
    if (mode === "axis") setAxis({ x: p.x, w: 0 });
    else setRegion({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toNorm(e);
    if (mode === "axis") setAxis({ x: Math.min(drag.x0, p.x), w: Math.abs(p.x - drag.x0) });
    else setRegion({ x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) });
  };
  const onUp = () => {
    setDrag(null);
    if (mode === "axis") {
      setAxis((a) => (a && a.w < 0.005 ? null : a));
      setMode("zone");
    } else setRegion((r) => (r && (r.w < 0.01 || r.h < 0.01) ? null : r));
  };

  // ---------- Pré-visualização ampliada (píxeis nativos) ----------
  useEffect(() => {
    const img = imgRef.current;
    const cv = previewRef.current;
    if (!img || !cv || !region || region.w < 0.01 || region.h < 0.01 || !img.naturalWidth) return;
    const sx = region.x * img.naturalWidth;
    const sy = region.y * img.naturalHeight;
    const sw = region.w * img.naturalWidth;
    const sh = region.h * img.naturalHeight;
    const maxW = cv.parentElement?.clientWidth || 420;
    const k = Math.min(maxW / sw, 360 / sh, 4);
    cv.width = Math.round(sw * k);
    cv.height = Math.round(sh * k);
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  }, [region]);

  const nativeSize = region && natural ? `${Math.round(region.w * natural.w)}×${Math.round(region.h * natural.h)} px nativos` : null;

  // ---------- Análise ----------
  const analyse = async (whole = false) => {
    if (!imageUrl) return;
    const r = whole || !region ? { x: 0, y: 0, w: 1, h: 1 } : region;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/chart-zoom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, region: r, asset, horizon, timeframe: timeframe || null, question: question || null, priceHint: priceHint || null, includePriceAxis: includeAxis, axis }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erro na análise");
      setResult(d);
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro na análise");
    } finally {
      setLoading(false);
    }
  };

  const openHistory = async (id: number) => {
    const d = await fetch(`/api/chart-zoom?id=${id}`).then((r) => r.json()).catch(() => null);
    if (!d) return;
    setImageUrl(d.imageUrl);
    setRegion(d.region);
    setAsset(d.asset);
    setResult(d);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 380px", gap: 16, alignItems: "start" }}>
      {/* ---------- Coluna esquerda: palco + resultado ---------- */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <div className="section-label" style={{ margin: 0 }}>Gráfico</div>
            <label className="btn-ghost" style={{ cursor: "pointer" }}>
              {uploading ? "A carregar…" : "Carregar imagem"}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>ou cola (Ctrl+V) / arrasta para aqui</span>
            {imageUrl && (
              <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)", marginRight: 4 }}>ZOOM</span>
                {ZOOMS.map((z) => (
                  <button key={z} onClick={() => setStageZoom(z)} className={stageZoom === z ? "btn-primary" : "btn-ghost"} style={{ padding: "2px 8px" }}>
                    {z}×
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) upload(f);
            }}
            style={{ border: "1px dashed var(--border-bright)", borderRadius: 6, overflow: "auto", maxHeight: "62vh", background: "var(--bg-surface)", minHeight: imageUrl ? undefined : 260, display: imageUrl ? "block" : "flex", alignItems: "center", justifyContent: "center" }}
          >
            {!imageUrl ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: 24 }}>
                Tira um screenshot do TradingView/MT5 com o eixo de preço visível e cola aqui.
              </div>
            ) : (
              <div
                style={{ position: "relative", overflow: "hidden", width: `${stageZoom * 100}%`, cursor: "crosshair", userSelect: "none", touchAction: "none" }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={imgRef} src={imageUrl} alt="Gráfico" draggable={false} style={{ display: "block", width: "100%", height: "auto" }} onLoad={(e) => {
                    setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
                    setRegion((r) => (r ? { ...r } : r));
                    restoreAxis();
                  }} />
                {axis && includeAxis && (
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: `${axis.x * 100}%`, width: `${axis.w * 100}%`, background: "rgba(96,165,250,0.18)", borderLeft: "1px solid var(--blue)", borderRight: "1px solid var(--blue)", pointerEvents: "none" }} />
                )}
                {region && (
                  <>
                    <div style={{ position: "absolute", left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%`, border: "2px dashed #facc15", boxShadow: "0 0 0 9999px rgba(5,8,16,0.55)", pointerEvents: "none" }} />
                  </>
                )}
              </div>
            )}
          </div>
          {imageUrl && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
              {mode === "axis" ? "Arrasta na horizontal sobre o eixo de preço (os números)." : "Arrasta para selecionar a zona. Esc limpa."} {nativeSize && <span style={{ color: "var(--accent)" }}>Seleção: {nativeSize}</span>}
            </div>
          )}
        </div>

        {error && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>{error}</div>}
        {loading && <div className="card" style={{ color: "var(--text-secondary)" }}>A analisar a zona em alta resolução… (20–60 s)</div>}
        {result && <ResultView r={result} />}
      </div>

      {/* ---------- Coluna direita: controlos ---------- */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 0 }}>
        <div className="card">
          <div className="section-label">Zona ampliada</div>
          {region && region.w >= 0.01 ? (
            <canvas ref={previewRef} style={{ width: "100%", borderRadius: 4, border: "1px solid var(--border)" }} />
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Sem seleção: a análise usa o gráfico inteiro.</div>
          )}
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="section-label" style={{ margin: 0 }}>Pedido</div>
          <Row label="Activo">
            {(["XAUUSD", "SOLUSD"] as Asset[]).map((a) => (
              <button key={a} onClick={() => setAsset(a)} className={asset === a ? "btn-primary" : "btn-ghost"} style={{ flex: 1 }}>{a}</button>
            ))}
          </Row>
          <Row label="Tipo">
            {([["auto", "Auto"], ["day", "Day"], ["swing", "Swing"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setHorizon(v)} className={horizon === v ? "btn-primary" : "btn-ghost"} style={{ flex: 1 }}>{l}</button>
            ))}
          </Row>
          <Row label="Timeframe">
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} style={{ flex: 1 }}>
              {TFS.map((t) => <option key={t} value={t}>{t || "Detetar na imagem"}</option>)}
            </select>
          </Row>
          <input placeholder="Calibração opcional (ex.: preço atual 2384,20)" value={priceHint} onChange={(e) => setPriceHint(e.target.value)} />
          <textarea rows={3} placeholder="Pergunta opcional (ex.: isto é um Spring ou só um sweep?)" value={question} onChange={(e) => setQuestion(e.target.value)} style={{ resize: "vertical" }} />
          <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={includeAxis} onChange={(e) => setIncludeAxis(e.target.checked)} />
            Juntar o eixo de preço ao recorte
          </label>
          {includeAxis && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "var(--text-muted)" }}>
              <span style={{ flex: 1 }}>Eixo: {axis ? `faixa marcada (${(axis.x * 100).toFixed(0)}%)` : "margem direita"}</span>
              <button className={mode === "axis" ? "btn-primary" : "btn-ghost"} style={{ padding: "2px 8px" }} disabled={!imageUrl} onClick={() => setMode((m) => (m === "axis" ? "zone" : "axis"))}>
                {mode === "axis" ? "A marcar…" : "Marcar eixo"}
              </button>
              {axis && <button className="btn-ghost" style={{ padding: "2px 8px" }} onClick={() => setAxis(null)}>Repor</button>}
            </div>
          )}
          <button className="btn-primary" disabled={!imageUrl || loading} onClick={() => analyse(false)} style={{ padding: "10px 14px", opacity: !imageUrl || loading ? 0.5 : 1 }}>
            {region ? "Analisar zona selecionada" : "Analisar gráfico inteiro"}
          </button>
        </div>

        {history.length > 0 && (
          <div className="card">
            <div className="section-label">Últimas análises</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
              {history.map((h) => (
                <button key={h.id} onClick={() => openHistory(h.id)} className="btn-ghost" style={{ textAlign: "left", padding: "6px 8px" }}>
                  <div style={{ fontSize: 11, color: "var(--text-primary)" }}>
                    #{h.id} {h.asset} · {h.horizon}{h.timeframe ? ` · ${h.timeframe}` : ""} · <span style={{ color: h.bias === "bullish" ? "var(--green)" : h.bias === "bearish" ? "var(--red)" : "var(--text-muted)" }}>{h.bias}</span>
                    {h.plan_status && h.plan_status !== "none" && <span style={{ marginLeft: 6, color: STATUS_STYLE[h.plan_status]?.fg }}>{h.plan_status}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.summary}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 70, fontSize: 10, color: "var(--text-muted)" }}>{label}</span>
      <div style={{ display: "flex", gap: 4, flex: 1 }}>{children}</div>
    </div>
  );
}

function ResultView({ r }: { r: Result }) {
  const a = r.analysis;
  const biasColor = a.bias === "bullish" ? "var(--green)" : a.bias === "bearish" ? "var(--red)" : "var(--text-secondary)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Resumo */}
      <div className="card">
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <span className="section-label" style={{ margin: 0 }}>Leitura da zona</span>
          <span className="badge" style={{ background: "var(--bg-elevated)", color: biasColor }}>{a.bias.toUpperCase()}</span>
          <span className="badge" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>{r.asset} · {r.horizon === "day" ? "Day" : "Swing"}{r.timeframe ? ` · ${r.timeframe}` : ""}</span>
          {!a.data_quality.price_axis_readable && <span className="badge" style={{ background: "var(--amber-dim)", color: "var(--amber)" }}>eixo de preço pouco legível — níveis aproximados</span>}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 12 }}>{a.zone_summary}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
          {Object.entries(READING_LABELS).map(([k, l]) =>
            a.reading[k as keyof typeof a.reading] ? (
              <div key={k} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6, padding: 10 }}>
                <div style={{ fontSize: 9, letterSpacing: 1.5, color: "var(--accent)", marginBottom: 4 }}>{l.toUpperCase()}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{a.reading[k as keyof typeof a.reading]}</div>
              </div>
            ) : null
          )}
        </div>
        {a.context_from_full_chart && (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 10 }}>
            <span style={{ color: "var(--text-muted)" }}>Contexto do gráfico completo: </span>{a.context_from_full_chart}
          </div>
        )}
        {a.data_quality.notes && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{a.data_quality.notes}</div>}
      </div>

      {/* Cenários */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ScenarioCard side="bullish" s={a.scenarios.bullish} asset={r.asset} warnings={r.scenarioChecks.find((c) => c.side === "bullish")?.warnings || []} />
        <ScenarioCard side="bearish" s={a.scenarios.bearish} asset={r.asset} warnings={r.scenarioChecks.find((c) => c.side === "bearish")?.warnings || []} />
      </div>

      {/* Plano validado */}
      <PlanCard r={r} />

      {/* Níveis + o que a IA viu */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
        <div className="card">
          <div className="section-label">Níveis-chave</div>
          {a.key_levels.length === 0 ? <div style={{ fontSize: 11, color: "var(--text-muted)" }}>—</div> : (
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <tbody>
                {[...a.key_levels].sort((x, y) => y.price - x.price).map((l, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "4px 6px", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{fmt(l.price, r.asset)}</td>
                    <td style={{ padding: "4px 6px", color: "var(--accent)", whiteSpace: "nowrap" }}>{l.type}</td>
                    <td style={{ padding: "4px 6px", color: "var(--text-secondary)" }}>{l.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {r.kb.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="section-label">Notas usadas</div>
              {r.kb.map((k) => (
                <div key={k.ref} style={{ fontSize: 11, color: a.kb_refs.includes(k.ref) ? "var(--accent)" : "var(--text-muted)" }}>
                  [{k.ref}] {k.title}
                </div>
              ))}
            </div>
          )}
        </div>
        {r.images?.cropPreview && (
          <div className="card">
            <div className="section-label">O que a IA recebeu (recorte)</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.images.cropPreview} alt="Recorte enviado" style={{ width: "100%", borderRadius: 4 }} />
            {r.images.meta && (
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
                Enviado a {r.images.meta.cropOutPx.width}×{r.images.meta.cropOutPx.height} px (×{r.images.meta.upscale}){r.images.meta.priceAxisAppended ? " + eixo de preço" : ""} · original {r.images.meta.sourceWidth}×{r.images.meta.sourceHeight}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ScenarioCard({ side, s, asset, warnings }: { side: "bullish" | "bearish"; s: Scenario; asset: Asset; warnings: string[] }) {
  const bull = side === "bullish";
  const color = bull ? "var(--green)" : "var(--red)";
  if (!s) return <div className="card" style={{ color: "var(--text-muted)" }}>Sem cenário {side}.</div>;
  return (
    <div className="card" style={{ borderTop: `2px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color, fontWeight: 600, fontSize: 12 }}>{bull ? "▲ CENÁRIO BULLISH" : "▼ CENÁRIO BEARISH"}</span>
        <span style={{ fontSize: 18, color }}>{Number.isFinite(s.probability) ? `${Math.round(s.probability)}%` : "—"}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>{s.thesis}</div>
      <div className="section-label">Gatilhos de confirmação</div>
      <ul style={{ margin: "0 0 10px", paddingLeft: 16, fontSize: 12, color: "var(--text-primary)" }}>
        {s.triggers.filter(Boolean).map((t, i) => <li key={i}>{t}</li>)}
      </ul>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", fontSize: 12 }}>
        {s.entry_zone && (<><span style={{ color: "var(--text-muted)" }}>Entrada</span><span>{fmt(Math.min(s.entry_zone.low, s.entry_zone.high), asset)} – {fmt(Math.max(s.entry_zone.low, s.entry_zone.high), asset)}</span></>)}
        {s.invalidation && (<><span style={{ color: "var(--text-muted)" }}>Invalidação</span><span style={{ color: "var(--red)" }}>{fmt(s.invalidation.price, asset)} <span style={{ color: "var(--text-muted)" }}>— {s.invalidation.reason}</span></span></>)}
        {s.targets.map((t, i) => (
          <Fragment key={i}>
            <span style={{ color: "var(--text-muted)" }}>{`Alvo ${i + 1}`}</span>
            <span style={{ color: "var(--green)" }}>{fmt(t.price, asset)} <span style={{ color: "var(--text-muted)" }}>{t.label}</span></span>
          </Fragment>
        ))}
      </div>
      {warnings.length > 0 && <div style={{ marginTop: 8, fontSize: 11, color: "var(--amber)" }}>{warnings.join(" ")}</div>}
    </div>
  );
}

function PlanCard({ r }: { r: Result }) {
  const a = r.analysis;
  if (!r.plan || !r.validation) {
    return (
      <div className="card" style={{ borderLeft: "3px solid var(--text-muted)" }}>
        <div className="section-label">Sinal</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Sem trade. {a.no_trade_reason}</div>
      </div>
    );
  }
  const v = r.validation;
  const p = r.plan;
  const st = STATUS_STYLE[v.status];
  const long = p.direction === "long";
  return (
    <div className="card" style={{ borderLeft: `3px solid ${st.fg}` }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <span className="section-label" style={{ margin: 0 }}>Sinal</span>
        <span style={{ fontWeight: 700, color: long ? "var(--green)" : "var(--red)" }}>{r.asset} · {long ? "LONG ▲" : "SHORT ▼"} · {r.horizon === "day" ? "DAY" : "SWING"}</span>
        <span className="badge" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
        {Number.isFinite(a.trade_plan?.confidence) && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>confiança IA {Math.round(a.trade_plan!.confidence)}%</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 12 }}>
        <Metric label="Zona de entrada" value={`${fmt(p.entryZone.low, r.asset)} – ${fmt(p.entryZone.high, r.asset)}`} />
        <Metric label="Stop Loss" value={`${fmt(p.stopLoss, r.asset)}`} sub={`${v.stopPct}% · ${a.trade_plan?.stop_logic || ""}`} color="var(--red)" />
        <Metric label="R:R (pior preço)" value={v.rrWorst != null ? `${v.rrWorst}R` : "—"} sub={`mín ${v.limits.rrMin}R`} color={v.rrWorst != null && v.rrWorst >= v.limits.rrMin ? "var(--green)" : "var(--red)"} />
        <Metric
          label={`Lote (${r.riskPct}% risco)`}
          value={r.sizing ? (r.sizing.ok ? String(r.sizing.lots) : "—") : "sem conta"}
          sub={r.sizing ? (r.sizing.ok ? `risco ${r.sizing.actualRisk.toFixed(2)}` : r.sizing.reason) : "define o capital em Contas"}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div className="section-label">Alvos</div>
          {v.targetsRR.map((t, i) => (
            <div key={i} style={{ fontSize: 12 }}>
              <span style={{ color: "var(--green)" }}>TP{i + 1} {fmt(t.price, r.asset)}</span> <span style={{ color: "var(--text-muted)" }}>· {t.rr}R {t.label ? `· ${t.label}` : ""}</span>
            </div>
          ))}
          <div className="section-label" style={{ marginTop: 10 }}>Confluências</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>{p.confluences.map((c, i) => <li key={i}>{c}</li>)}</ul>
          {a.trade_plan?.invalidation && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>Invalidação: {a.trade_plan.invalidation}</div>}
        </div>
        <div>
          <div className="section-label">Checklist</div>
          {Object.entries(CHECK_LABELS).map(([k, l]) => (
            <div key={k} style={{ fontSize: 12, color: p.checklist[k] ? "var(--green)" : "var(--text-muted)" }}>
              {p.checklist[k] ? "✓" : "○"} {l}
            </div>
          ))}
        </div>
      </div>

      {(v.errors.length > 0 || v.warnings.length > 0) && (
        <div style={{ marginTop: 12, fontSize: 12 }}>
          {v.errors.map((e, i) => <div key={`e${i}`} style={{ color: "var(--red)" }}>✕ {e}</div>)}
          {v.warnings.map((w, i) => <div key={`w${i}`} style={{ color: "var(--amber)" }}>! {w}</div>)}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6, padding: 10 }}>
      <div style={{ fontSize: 9, letterSpacing: 1.5, color: "var(--text-muted)" }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 15, color: color || "var(--text-primary)" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}
