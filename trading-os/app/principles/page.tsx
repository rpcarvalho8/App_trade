"use client";
import { useState, useEffect } from "react";

const C = {
  accent: "#4af0c4", green: "#4ade80", red: "#f87171", amber: "#fbbf24",
  muted: "#475569", secondary: "#94a3b8", border: "#1e2d45", card: "#0d1929", elevated: "#111827",
};

const CATEGORIES = [
  { value: "discipline", label: "Disciplina", color: C.accent, icon: "◈" },
  { value: "risk", label: "Gestão de Risco", color: C.amber, icon: "◆" },
  { value: "psychology", label: "Psicologia", color: "#c084fc", icon: "◎" },
  { value: "strategy", label: "Estratégia", color: C.green, icon: "▲" },
  { value: "general", label: "Geral", color: C.muted, icon: "○" },
];

export default function PrinciplesPage() {
  const [principles, setPrinciples] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", category: "discipline" });
  const [filter, setFilter] = useState("");

  const fetchAll = () => { fetch("/api/principles").then(r => r.json()).then(setPrinciples); };
  useEffect(fetchAll, []);

  const save = async () => {
    if (!form.title || !form.body) return;
    await fetch("/api/principles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ title: "", body: "", category: "discipline" });
    setShowForm(false);
    fetchAll();
  };

  const remove = async (id: number) => {
    if (!confirm("Apagar este princípio?")) return;
    await fetch(`/api/principles?id=${id}`, { method: "DELETE" });
    fetchAll();
  };

  const grouped = CATEGORIES.reduce((acc, cat) => {
    acc[cat.value] = principles.filter(p =>
      p.category === cat.value &&
      (!filter || p.title.toLowerCase().includes(filter.toLowerCase()) || p.body.toLowerCase().includes(filter.toLowerCase()))
    );
    return acc;
  }, {} as any);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2 }}>TRADING OS</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: C.accent }}>Princípios de Trading</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>As tuas regras de ouro — revê antes de cada sessão</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Pesquisar..." style={{ width: 180 }} />
          <button className="btn-primary" onClick={() => setShowForm(f => !f)}>
            {showForm ? "✕ Fechar" : "+ Novo Princípio"}
          </button>
        </div>
      </div>

      {showForm && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 14 }}>NOVO PRINCÍPIO</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5, marginBottom: 4 }}>TÍTULO</div>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="ex: Nunca entrar sem setup válido" style={{ width: "100%" }} />
            </div>
            <div>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5, marginBottom: 4 }}>CATEGORIA</div>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={{ width: "100%" }}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5, marginBottom: 4 }}>REGRA / EXPLICAÇÃO</div>
            <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder="Escreve a regra em detalhe. Porquê existe? O que acontece quando quebras?" rows={4}
              style={{ width: "100%", resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="btn-primary" onClick={save}>Guardar</button>
          </div>
        </div>
      )}

      {CATEGORIES.map(cat => {
        const items = grouped[cat.value] || [];
        if (items.length === 0 && filter) return null;
        return (
          <div key={cat.value}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ color: cat.color, fontSize: 12 }}>{cat.icon}</span>
              <span style={{ fontSize: 11, color: cat.color, letterSpacing: 1, fontWeight: 500 }}>{cat.label.toUpperCase()}</span>
              <span style={{ fontSize: 10, color: C.muted }}>({items.length})</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>
            {items.length === 0 && (
              <div style={{ color: C.muted, fontSize: 11, padding: "8px 0 16px" }}>
                Sem princípios nesta categoria. Adiciona um acima.
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12, marginBottom: 16 }}>
              {items.map((p: any) => (
                <div key={p.id} style={{
                  background: C.card, borderLeft: `3px solid ${cat.color}`,
                  border: `1px solid ${C.border}`, borderLeftWidth: 3,
                  borderRadius: 8, padding: 16, position: "relative",
                }}>
                  <button onClick={() => remove(p.id)} style={{
                    position: "absolute", top: 10, right: 10,
                    background: "none", border: "none", color: C.muted, fontSize: 12,
                  }}>✕</button>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 8, paddingRight: 20 }}>
                    {p.title}
                  </div>
                  <div style={{ fontSize: 12, color: C.secondary, lineHeight: 1.7 }}>{p.body}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
