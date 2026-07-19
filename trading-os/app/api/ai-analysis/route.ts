import { NextResponse } from "next/server";
import { initDB, db } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST() {
  await initDB();

  const trades = await db.execute("SELECT * FROM trades ORDER BY date DESC LIMIT 50");
  const mentalLogs = await db.execute("SELECT * FROM mental_logs ORDER BY date DESC LIMIT 30");
  const stats = await db.execute(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN outcome='LOSS' THEN 1 ELSE 0 END) as losses,
      COALESCE(SUM(pnl),0) as total_pnl,
      COALESCE(AVG(rr_real),0) as avg_rr,
      COALESCE(AVG(sleep_quality),0) as avg_sleep,
      COALESCE(AVG(stress_level),0) as avg_stress,
      COALESCE(AVG(anxiety_level),0) as avg_anxiety,
      COALESCE(AVG(focus_level),0) as avg_focus,
      SUM(CASE WHEN followed_plan=0 THEN 1 ELSE 0 END) as violations
    FROM trades WHERE outcome != 'RUNNING'`);
  const bySetup = await db.execute(`
    SELECT setup, COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      COALESCE(SUM(pnl),0) as pnl,
      COALESCE(AVG(rr_real),0) as avg_rr
    FROM trades WHERE outcome != 'RUNNING' GROUP BY setup ORDER BY pnl DESC`);
  const mentalCorr = await db.execute(`
    SELECT mental_state, outcome,
      AVG(sleep_quality) as avg_sleep, AVG(stress_level) as avg_stress,
      AVG(anxiety_level) as avg_anxiety, AVG(focus_level) as avg_focus,
      COUNT(*) as total, SUM(pnl) as pnl
    FROM trades WHERE outcome != 'RUNNING'
    GROUP BY mental_state, outcome ORDER BY mental_state`);
  const setupPsych = await db.execute(`
    SELECT setup, outcome,
      AVG(sleep_quality) as avg_sleep, AVG(stress_level) as avg_stress,
      AVG(focus_level) as avg_focus, COUNT(*) as total
    FROM trades WHERE outcome != 'RUNNING' GROUP BY setup, outcome`);

  const prompt = `És um coach de trading de elite especializado em Wyckoff, Elliott Wave, ICT e psicologia de trading.
Analisa os dados completos abaixo — técnicos E psicológicos — e devolve APENAS JSON puro (sem markdown):

{
  "overall_score": <1-10>,
  "psychological_score": <1-10>,
  "technical_score": <1-10>,
  "summary": "<resumo 2 frases>",
  "psychological_profile": {
    "dominant_pattern": "<padrão psicológico dominante identificado>",
    "sleep_impact": "<como o sono afeta a performance com dados>",
    "stress_impact": "<como stress/ansiedade afeta os resultados>",
    "best_mental_conditions": "<quando rendes melhor — que combinação de scores>",
    "worst_mental_conditions": "<quando rendes pior>"
  },
  "technical_insights": {
    "best_setup": "<nome e porquê com dados>",
    "setup_psychology_link": "<como o estado mental afeta a execução de cada setup>",
    "elliott_wyckoff_alignment": "<análise de quando os dois sistemas estão alinhados vs não>",
    "entry_quality": "<análise da qualidade das entradas — chocks, confirmações>"
  },
  "strengths": [{"title": "<título>", "detail": "<detalhe com dados concretos>"}],
  "weaknesses": [{"title": "<título>", "detail": "<detalhe>", "severity": "high|medium|low"}],
  "patterns": [{"pattern": "<padrão detectado>", "trigger": "<o que despoleta>", "impact": "<impacto financeiro>", "action": "<ação concreta>"}],
  "pre_session_rules": ["<regra 1 baseada nos dados>", "<regra 2>", "<regra 3>"],
  "study_plan": [{"priority": 1, "topic": "<tópico>", "reason": "<porquê>", "resource": "<como estudar>"}],
  "decision_framework": "<framework de decisão personalizado baseado no teu perfil psicológico e técnico>",
  "sizing_rules": "<regras de sizing baseadas no estado mental — ex: se stress>7 então 0.5%>",
  "next_week_focus": "<foco da próxima semana>",
  "avoid_this_week": "<o que evitar absolutamente>"
}

TRADES (últimos 50): ${JSON.stringify(trades.rows)}
LOGS MENTAIS: ${JSON.stringify(mentalLogs.rows)}
ESTATÍSTICAS: ${JSON.stringify(stats.rows[0])}
POR SETUP: ${JSON.stringify(bySetup.rows)}
CORRELAÇÃO MENTAL/RESULTADO: ${JSON.stringify(mentalCorr.rows)}
PSICOLOGIA POR SETUP: ${JSON.stringify(setupPsych.rows)}

Sê muito específico. Usa os números reais. Identifica padrões psicológicos concretos (FOMO triggers, revenge patterns, overconfidence, fatigue correlation). Liga estado mental ao desempenho técnico.`;

  const message = await client.messages.create({
    model: "claude-opus-4-20250514",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected type");
  let analysis;
  try { analysis = JSON.parse(content.text); }
  catch { const m = content.text.match(/\{[\s\S]*\}/); if (m) analysis = JSON.parse(m[0]); else throw new Error("Parse error"); }

  await db.execute({
    sql: "INSERT INTO ai_analyses (period, analysis) VALUES (?, ?)",
    args: ["full_analysis", JSON.stringify(analysis)],
  });
  return NextResponse.json(analysis);
}

export async function GET() {
  await initDB();
  const result = await db.execute("SELECT * FROM ai_analyses ORDER BY created_at DESC LIMIT 1");
  if (result.rows.length === 0) return NextResponse.json(null);
  return NextResponse.json(JSON.parse((result.rows[0] as any).analysis));
}
