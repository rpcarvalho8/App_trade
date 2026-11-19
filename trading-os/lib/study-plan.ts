/**
 * Plano de estudo semanal (6 semanas + ciclo de consolidação) derivado de
 * knowledge/guia-estudo-xau-sol.md, com agenda fixa ao fim de semana e uma micro-tarefa
 * diária de 15 min nos dias úteis. Funções puras (datas em Europe/Lisbon, formato YYYY-MM-DD).
 *
 * Usado pelo Morning Brief (cartão "Estudo"), pelo lembrete do fim de semana e pelo .ics.
 */

export interface StudySession {
  id: string;
  /** 6 = sábado, 0 = domingo. */
  weekday: 0 | 6;
  start: string; // "HH:MM" hora de Portugal
  end: string;
  title: string;
  tasks: string[];
}

export interface StudyWeek {
  week: number;
  title: string;
  goal: string;
  /** Secções do guia a ler (cabeçalhos de knowledge/guia-estudo-xau-sol.md). */
  guideSections: string[];
  /** Material do teu vault / da app para esta semana. */
  references: string[];
  /** Micro-tarefa de 15 min nos dias úteis (antes ou depois da sessão de mercado). */
  weekdayDrill: string;
  sessions: StudySession[];
  /** Entregável que fecha a semana. */
  deliverable: string;
}

/** Horário fixo do fim de semana. Mudar aqui muda o brief, o lembrete e o .ics. */
export const WEEKEND_SLOTS = {
  satTheory: { start: "09:00", end: "11:30" },
  sunPractice: { start: "09:00", end: "11:00" },
  sunReview: { start: "18:00", end: "18:45" },
} as const;

const sat = (id: string, title: string, tasks: string[]): StudySession => ({ id, weekday: 6, ...WEEKEND_SLOTS.satTheory, title, tasks });
const sunP = (id: string, title: string, tasks: string[]): StudySession => ({ id, weekday: 0, ...WEEKEND_SLOTS.sunPractice, title, tasks });
const sunR = (id: string, tasks: string[]): StudySession => ({
  id,
  weekday: 0,
  ...WEEKEND_SLOTS.sunReview,
  title: "Revisão da semana + plano da próxima",
  tasks: [
    ...tasks,
    "Rever os Daily Report Cards da semana: o erro que mais se repetiu e a trade mais fácil.",
    "Marcar no calendário as notícias de alto impacto da próxima semana (ouro).",
  ],
});

export const STUDY_PLAN: StudyWeek[] = [
  {
    week: 1,
    title: "Wyckoff completo",
    goal: "Saber nomear cada evento e fase de acumulação e distribuição, e distinguir reacumulação de distribuição.",
    guideSections: ["2. Wyckoff: o que falta além da Fase A", "1. O mapa único"],
    references: ["Vault: Wyckoff/Análise de força e debilidade", "Vault: Wyckoff/*_fases.png e *_exemplos.png", "App: /methodology/wyckoff_*.png", "PDF: resumo-libertario-a-metodologia-wyckoff"],
    weekdayDrill: "No H1 do ouro e H4 da SOL: em que fase de Wyckoff está o range atual? Escreve 1 linha no journal.",
    sessions: [
      sat("w1-sat", "Teoria: fases B–E da acumulação e A–E da distribuição", [
        "Ler a secção 2 do guia e o resumo Wyckoff (fases e eventos).",
        "Escrever por palavras tuas as fases B a E (acumulação) e A a E (distribuição) no vault.",
        "Lei de Causa e Efeito: como projetar o alvo a partir da largura do range.",
      ]),
      sunP("w1-sun", "Prática: marcar ranges reais", [
        "Marcar 5 ranges no XAUUSD H1 com PS/SC/AR/ST/Spring/SOS/LPS.",
        "Marcar 5 ranges na SOLUSD H4 (pelo menos 1 distribuição).",
        "Para cada um: reacumulação ou distribuição? Que evidência de volume?",
      ]),
      sunR("w1-rev", ["Guardar os 10 gráficos marcados e analisar 2 deles em /analise-visual para comparar com a IA."]),
    ],
    deliverable: "Nota escrita das fases + 10 gráficos marcados.",
  },
  {
    week: 2,
    title: "Ondas de Elliott",
    goal: "Aplicar as 3 regras invioláveis, reconhecer as 4 correções e manter sempre uma contagem alternativa.",
    guideSections: ["3. Elliott: regras escritas e uso prático"],
    references: ["Vault: Elliott/correções_Elliott.png, correções_complexas*.png", "Vault: regras_Elliott.png", "PDF: Elliott Wave Principle (Balan)", "App: /methodology/elliott_*.png"],
    weekdayDrill: "Contar as ondas da última perna H1 do ouro: qual nível invalida a contagem?",
    sessions: [
      sat("w2-sat", "Teoria: regras, diretrizes e correções", [
        "Escrever as 3 regras do impulso e as diretrizes (alternância, extensão).",
        "Zigzag, flat (incl. expandido = Spring/UTAD), triângulo, W-X-Y: desenhar cada um.",
        "Projeções de Fibonacci para ondas 3, 5 e C.",
      ]),
      sunP("w2-sun", "Prática: contagens D1", [
        "Contar o último impulso D1 do ouro com contagem principal e alternativa.",
        "Idem na SOLUSD D1.",
        "Assinalar onde a onda 2/4 coincide com OB/FVG ou com um Spring.",
      ]),
      sunR("w2-rev", ["Comparar as contagens com a leitura de Wyckoff da semana 1: concordam?"]),
    ],
    deliverable: "2 contagens D1 com alternativa e nível de invalidação.",
  },
  {
    week: 3,
    title: "SMC: estrutura e liquidez",
    goal: "BOS só com corpo, CHoCH vs fake CHoCH, mapa diário de liquidez (PDH/PDL, PWH/PWL, equal highs/lows).",
    guideSections: ["4. SMC: as notas que faltam no teu currículo", "5. Específico de XAUUSD"],
    references: ["Vault: SMC/BOS_CHOCK_SMC.png, BSL_SSL.png, fake_chock_fake_boss.png", "Vault: Liquidez/Fundos válidos", "Currículo SMC semanas 1–2"],
    weekdayDrill: "Antes da sessão: marcar PDH/PDL e PWH/PWL do ouro e da SOL. Depois: foram varridos?",
    sessions: [
      sat("w3-sat", "Teoria: estrutura e liquidez", [
        "Preencher as notas vazias Break_of_Structure e Liquidity_Pools no vault.",
        "Fundos válidos (3 ondas, quebra expressiva) vs swing qualquer.",
        "Sequência liquidez interna → externa.",
      ]),
      sunP("w3-sun", "Prática: diário de liquidez", [
        "Rever os registos PDH/PDL da semana: quantos foram varridos e o que aconteceu a seguir?",
        "Encontrar 5 fake CHoCH/BOS no M15 do ouro.",
      ]),
      sunR("w3-rev", ["Escrever a regra pessoal: quando é que um sweep é entrada e quando é só ruído?"]),
    ],
    deliverable: "Tabela da semana com PDH/PDL varridos + 5 exemplos de fake BOS.",
  },
  {
    week: 4,
    title: "SMC: entradas (OB, FVG, Premium/Discount)",
    goal: "Executar o modelo sweep → MSS → reteste de OB/FVG em desconto, com SL técnico e R:R calculado.",
    guideSections: ["4. SMC: as notas que faltam no teu currículo", "7. Day Trade vs Swing Trade"],
    references: ["Vault: SMC/Premium_vs_discount.png, SMC.png", "Vault: exemplo_order_block_instituicional.png", "Currículo SMC semanas 3–4", "App: /smc/*.png"],
    weekdayDrill: "1 setup por dia no M15 do ouro (sem operar): zona, SL, TP, R:R. Registar se resultaria.",
    sessions: [
      sat("w4-sat", "Teoria: OB, FVG e modelos de entrada", [
        "Preencher Order_Blocks e Fair_Value_Gap no vault.",
        "Reversão vs continuação: onde fica o SL em cada uma.",
        "Premium/Discount e OTE 0,618–0,786.",
      ]),
      sunP("w4-sun", "Prática: backtest de 20 setups", [
        "20 exemplos sweep → MSS → OB/FVG no M15 do ouro, com resultado em R.",
        "Calcular win rate e R médio destes 20.",
      ]),
      sunR("w4-rev", ["Que filtro teria eliminado as piores 5 das 20?"]),
    ],
    deliverable: "Folha com 20 setups backtestados e o filtro que melhora o resultado.",
  },
  {
    week: 5,
    title: "Integração Wyckoff + Elliott + SMC",
    goal: "Ler cada setup nas três linguagens e só considerar trades quando as três concordam.",
    guideSections: ["1. O mapa único", "6. Específico de SOLUSD", "9. Checklist universal antes de qualquer entrada"],
    references: ["Guia: tabela do mapa único", "App: /analise-visual (comparar a tua leitura com a da IA)"],
    weekdayDrill: "Antes de qualquer trade: escrever a leitura em 3 linhas (Wyckoff / Elliott / SMC).",
    sessions: [
      sat("w5-sat", "Teoria: o mesmo fenómeno em 3 linguagens", [
        "Rever a tabela do mapa único e a checklist universal.",
        "SOLUSD: beta BTC, funding, OI e cascatas de liquidação como clímax.",
      ]),
      sunP("w5-sun", "Prática: 10 leituras triplas", [
        "10 gráficos (5 XAU, 5 SOL): leitura nas 3 linguagens + decisão.",
        "Passar 3 deles em /analise-visual e anotar onde discordas da IA.",
      ]),
      sunR("w5-rev", ["Que escola te dá mais falsos positivos? Ajustar o playbook."]),
    ],
    deliverable: "10 leituras triplas com decisão e comparação com a IA.",
  },
  {
    week: 6,
    title: "Execução e dados (Daily Report Card)",
    goal: "Preencher o DRC todos os dias para que a IA aprenda com os teus erros reais, não só com teoria.",
    guideSections: ["9. Checklist universal antes de qualquer entrada", "8. Plano de estudo de 6 semanas"],
    references: ["Vault: Templates/Daily Report Card", "App: Journal e Journal Semanal"],
    weekdayDrill: "Preencher o Daily Report Card no fim do dia: o que aprendi, o que mudo, trades.",
    sessions: [
      sat("w6-sat", "Teoria: processo e psicologia", [
        "Reler as regras operacionais (playbook, máx. 2 trades, BE no novo fundo H1).",
        "The Mental Game of Trading: identificar o teu padrão de erro principal.",
      ]),
      sunP("w6-sun", "Prática: revisão de execução", [
        "Rever todas as trades da semana contra a checklist universal.",
        "Reindexar a base de conhecimento com os DRC preenchidos (POST /api/knowledge).",
      ]),
      sunR("w6-rev", ["Fechar o ciclo: o que entra no playbook e o que sai."]),
    ],
    deliverable: "5 DRC preenchidos e playbook atualizado.",
  },
];

/** Depois da semana 6: ciclo de consolidação de 2 semanas que se repete. */
export const CONSOLIDATION: StudyWeek[] = [
  {
    week: 7,
    title: "Consolidação A — XAUUSD",
    goal: "Repetir o ciclo completo só no ouro com os teus próprios dados.",
    guideSections: ["5. Específico de XAUUSD", "9. Checklist universal antes de qualquer entrada"],
    references: ["Journal: trades de ouro das últimas 2 semanas"],
    weekdayDrill: "DRC diário + marcar PDH/PDL.",
    sessions: [
      sat("ca-sat", "Rever a teoria onde mais erraste", ["Escolher a secção do guia ligada ao erro mais frequente do journal e relê-la.", "Atualizar a nota correspondente no vault."]),
      sunP("ca-sun", "Backtest focado", ["10 setups de ouro do tipo que mais perdeu: o que os distingue dos vencedores?"]),
      sunR("ca-rev", ["Uma regra nova ou uma regra a cortar no playbook."]),
    ],
    deliverable: "1 regra do playbook revista.",
  },
  {
    week: 8,
    title: "Consolidação B — SOLUSD",
    goal: "Repetir o ciclo na Solana, com funding e BTC no contexto.",
    guideSections: ["6. Específico de SOLUSD", "7. Day Trade vs Swing Trade"],
    references: ["Journal: trades de SOL das últimas 2 semanas"],
    weekdayDrill: "DRC diário + estrutura do BTC H1 antes de cada trade em SOL.",
    sessions: [
      sat("cb-sat", "Rever a teoria onde mais erraste", ["Funding, OI e liquidações: rever 3 cascatas recentes.", "Atualizar a nota correspondente no vault."]),
      sunP("cb-sun", "Backtest focado", ["10 setups de SOL: com e sem BTC alinhado. Diferença de resultado?"]),
      sunR("cb-rev", ["Uma regra nova ou uma regra a cortar no playbook."]),
    ],
    deliverable: "1 regra do playbook revista.",
  },
];

// ---------- datas ----------

const DAY_MS = 86_400_000;
const parse = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 0 = domingo … 6 = sábado. */
export function weekdayOf(date: string): number {
  return new Date(parse(date)).getUTCDay();
}

/** Segunda-feira da semana de `date` (semana de estudo = segunda a domingo). */
export function mondayOf(date: string): string {
  const wd = weekdayOf(date);
  return iso(parse(date) - ((wd + 6) % 7) * DAY_MS);
}

export function addDays(date: string, n: number): string {
  return iso(parse(date) + n * DAY_MS);
}

/** Índice 1-based da semana do plano. Antes do início devolve 0. */
export function weekNumber(start: string, date: string): number {
  const diff = Math.floor((parse(mondayOf(date)) - parse(mondayOf(start))) / (7 * DAY_MS));
  return diff < 0 ? 0 : diff + 1;
}

/** Semana do plano para um número (1–6 = plano; 7+ alterna consolidação A/B). */
export function weekFor(n: number): StudyWeek {
  if (n >= 1 && n <= STUDY_PLAN.length) return STUDY_PLAN[n - 1];
  const c = CONSOLIDATION[(Math.max(n, 7) - 7) % CONSOLIDATION.length];
  return { ...c, week: n };
}

export interface StudyToday {
  date: string;
  start: string;
  weekNumber: number;
  week: StudyWeek;
  isWeekend: boolean;
  /** Sessões de hoje (vazio nos dias úteis). */
  todaySessions: StudySession[];
  /** Próxima sessão de fim de semana a partir de hoje (data + sessão). */
  next: { date: string; session: StudySession } | null;
  /** Datas de sábado e domingo desta semana de estudo. */
  weekend: { saturday: string; sunday: string };
}

export function studyForDate(start: string, date: string): StudyToday {
  const n = Math.max(1, weekNumber(start, date));
  const week = weekFor(n);
  const wd = weekdayOf(date);
  const monday = mondayOf(date);
  const weekend = { saturday: addDays(monday, 5), sunday: addDays(monday, 6) };
  const todaySessions = week.sessions.filter((s) => s.weekday === wd);
  const upcoming = week.sessions
    .map((s) => ({ date: s.weekday === 6 ? weekend.saturday : weekend.sunday, session: s }))
    .filter((x) => x.date >= date)
    .sort((a, b) => (a.date + a.session.start).localeCompare(b.date + b.session.start));
  return { date, start, weekNumber: n, week, isWeekend: wd === 0 || wd === 6, todaySessions, next: upcoming[0] ?? null, weekend };
}

/** Início por omissão: segunda-feira da semana atual (o 1.º fim de semana de estudo é o desta semana). */
export function defaultStart(today: string): string {
  return mondayOf(today);
}

// ---------- calendário (.ics) ----------

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Exporta as sessões de fim de semana das próximas `weeks` semanas (a partir do início do plano)
 * em iCalendar, com hora local de Lisboa e alarme 15 min antes.
 */
export function buildIcs(start: string, weeks = STUDY_PLAN.length + CONSOLIDATION.length, stamp = "20260101T000000Z"): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TradingOS//Plano de Estudo//PT",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Trading OS — Estudo",
    "X-WR-TIMEZONE:Europe/Lisbon",
  ];
  const monday0 = mondayOf(start);
  for (let i = 0; i < weeks; i++) {
    const w = weekFor(i + 1);
    const monday = addDays(monday0, i * 7);
    for (const s of w.sessions) {
      const day = addDays(monday, s.weekday === 6 ? 5 : 6).replace(/-/g, "");
      const desc = [`Semana ${i + 1}: ${w.title}`, `Objetivo: ${w.goal}`, "", ...s.tasks.map((t) => `- ${t}`), "", `Guia: ${w.guideSections.join(" · ")}`].join("\n");
      lines.push(
        "BEGIN:VEVENT",
        `UID:tos-study-${start}-${i + 1}-${s.id}@trading-os`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=Europe/Lisbon:${day}T${s.start.replace(":", "")}00`,
        `DTEND;TZID=Europe/Lisbon:${day}T${s.end.replace(":", "")}00`,
        `SUMMARY:${icsEscape(`📚 S${i + 1} · ${s.title}`)}`,
        `DESCRIPTION:${icsEscape(desc)}`,
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape(s.title)}`,
        "END:VALARM",
        "END:VEVENT"
      );
    }
  }
  lines.push("END:VCALENDAR");
  // RFC 5545: CRLF e linhas ≤75 octetos (dobra simples por caracteres).
  return lines
    .flatMap((l) => {
      const out: string[] = [];
      let rest = l;
      while (rest.length > 74) {
        out.push(out.length ? " " + rest.slice(0, 73) : rest.slice(0, 74));
        rest = rest.slice(out.length === 1 ? 74 : 73);
      }
      out.push(out.length ? " " + rest : rest);
      return out;
    })
    .join("\r\n") + "\r\n";
}
