"use client";
import { useEffect, useState } from "react";

export default function MorningBriefPage() {
  const [html, setHtml] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [generated, setGenerated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/morning-brief", { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Falha ao carregar o brief.");
      setDate(j.date);
      setGenerated(j.generated);
      // O HTML é gerado no servidor (conversor nativo em lib/md.ts) — sem dependências no cliente.
      setHtml(j.html || "");
    } catch (e: any) {
      setError(e?.message || "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 style={{ color: "#4af0c4", fontSize: 18, fontWeight: 600, margin: 0, letterSpacing: 0.5 }}>
            🌅 Morning Brief
          </h1>
          <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>
            Análise macro/mercados gerada às 06:00 (hora de Portugal) · estática durante o dia
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {date && (
            <span style={{ color: "#475569", fontSize: 11, border: "1px solid #1e2d45", padding: "3px 10px", borderRadius: 4 }}>
              {date}{generated === true ? " · gerado agora" : generated === false ? " · em cache" : ""}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            style={{
              background: "#1e293b", color: "#94a3b8", border: "1px solid #1e2d45",
              padding: "4px 12px", borderRadius: 4, fontSize: 11, cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "A carregar…" : "↻ Recarregar"}
          </button>
        </div>
      </div>

      {loading && !html && (
        <div style={{ color: "#64748b", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          A recolher dados e a gerar a análise… (pode demorar alguns segundos na primeira carga do dia)
        </div>
      )}

      {error && (
        <div style={{ background: "#2a1215", border: "1px solid #7f1d1d", color: "#fca5a5", padding: 14, borderRadius: 6, fontSize: 12 }}>
          <strong>Erro:</strong> {error}
          <div style={{ color: "#94a3b8", marginTop: 6 }}>
            Verifica se o <code>GEMINI_API_KEY</code> está definido em <code>.env.local</code>. A Gemini pode estar temporariamente sobrecarregada — tenta recarregar.
          </div>
        </div>
      )}

      {html && (
        <article
          className="brief-md"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      <style jsx global>{`
        .brief-md {
          background: #0a0e1a;
          border: 1px solid #1e2d45;
          border-radius: 10px;
          padding: 28px 32px;
          color: #cbd5e1;
          font-size: 13.5px;
          line-height: 1.7;
        }
        .brief-md h1 {
          color: #4af0c4;
          font-size: 20px;
          margin: 0 0 8px;
          font-weight: 700;
        }
        .brief-md h2 {
          color: #e2e8f0;
          font-size: 15px;
          margin: 26px 0 10px;
          padding-bottom: 6px;
          border-bottom: 1px solid #1e2d45;
          font-weight: 600;
        }
        .brief-md h3 {
          color: #94a3b8;
          font-size: 12px;
          letter-spacing: 1px;
          text-transform: uppercase;
          margin: 22px 0 8px;
        }
        .brief-md blockquote {
          border-left: 3px solid #0f4c3a;
          margin: 12px 0;
          padding: 6px 14px;
          color: #64748b;
          font-size: 11.5px;
          background: #0d1929;
          border-radius: 0 6px 6px 0;
        }
        .brief-md ul { padding-left: 20px; margin: 8px 0; }
        .brief-md li { margin: 6px 0; }
        .brief-md strong { color: #e2e8f0; }
        .brief-md hr { border: none; border-top: 1px solid #1e2d45; margin: 24px 0; }
        .brief-md table {
          width: 100%;
          border-collapse: collapse;
          margin: 12px 0;
          font-size: 12px;
        }
        .brief-md th {
          text-align: left;
          color: #64748b;
          font-weight: 600;
          padding: 8px 10px;
          border-bottom: 1px solid #1e2d45;
          background: #0d1929;
        }
        .brief-md td {
          padding: 7px 10px;
          border-bottom: 1px solid #12203a;
          color: #cbd5e1;
        }
        .brief-md tr:last-child td { border-bottom: none; }
        .brief-md em { color: #475569; font-style: normal; font-size: 11px; }
        .brief-md code {
          background: #12203a;
          padding: 1px 5px;
          border-radius: 3px;
          color: #4af0c4;
          font-size: 11.5px;
        }
      `}</style>
    </div>
  );
}
