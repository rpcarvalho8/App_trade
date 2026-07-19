import { createClient } from "@libsql/client";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "trading.db");

// Guard defensivo: valida se a base de dados existe fisicamente e não está vazia.
// Evita confusões quando o servidor arranca no diretório errado (process.cwd()
// diferente de trading-os/), caso em que uma DB nova e vazia seria criada.
try {
  const stats = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : null;
  if (!stats) {
    console.warn(
      `[Aviso DB] O ficheiro 'trading.db' não foi encontrado em ${DB_PATH}. ` +
        `Uma nova base de dados vazia poderá ser criada. ` +
        `Confirma que arrancaste o servidor dentro da pasta 'trading-os/'.`
    );
  } else if (stats.size === 0) {
    console.warn(
      `[Aviso DB] O ficheiro 'trading.db' em ${DB_PATH} tem 0 bytes (vazio). ` +
        `Os teus dados podem estar noutro diretório — confirma o local de arranque do servidor.`
    );
  }
} catch (e: any) {
  console.warn(`[Aviso DB] Falha ao validar '${DB_PATH}':`, e?.message || e);
}

export const db = createClient({ url: `file:${DB_PATH}` });

export async function initDB() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      pair TEXT NOT NULL,
      direction TEXT NOT NULL,
      setup TEXT NOT NULL,
      session TEXT DEFAULT 'London',
      entry REAL NOT NULL,
      exit_price REAL,
      stop_loss REAL DEFAULT 0,
      take_profit REAL,
      risk_percent REAL DEFAULT 1,
      pnl REAL DEFAULT 0,
      rr_planned REAL,
      rr_real REAL,
      outcome TEXT DEFAULT 'WIN',
      elliott_wave TEXT DEFAULT '',
      wyckoff_phase TEXT DEFAULT '',
      wyckoff_event TEXT DEFAULT '',
      imbalance_zone TEXT DEFAULT '',
      htf_bias TEXT DEFAULT '',
      confluences TEXT DEFAULT '',
      entry_reason TEXT DEFAULT '',
      shock_type TEXT DEFAULT '',
      shock_timeframe TEXT DEFAULT '',
      management TEXT DEFAULT '',
      lesson TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      screenshot_before TEXT DEFAULT '',
      screenshot_after TEXT DEFAULT '',
      screenshot_entry TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      mental_state TEXT DEFAULT 'B',
      followed_plan INTEGER DEFAULT 1,
      sleep_quality INTEGER DEFAULT 5,
      fatigue_level INTEGER DEFAULT 5,
      stress_level INTEGER DEFAULT 5,
      anxiety_level INTEGER DEFAULT 5,
      focus_level INTEGER DEFAULT 5,
      confidence_level INTEGER DEFAULT 5,
      emotional_state TEXT DEFAULT '',
      pre_session_notes TEXT DEFAULT '',
      post_trade_emotion TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS setups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT DEFAULT 'Custom',
      description TEXT DEFAULT '',
      steps TEXT DEFAULT '',
      timeframes TEXT DEFAULT '',
      markets TEXT DEFAULT '',
      confluence TEXT DEFAULT '',
      invalidation TEXT DEFAULT '',
      image_refs TEXT DEFAULT '[]',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS principles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mental_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      sleep_hours REAL DEFAULT 7,
      sleep_quality INTEGER DEFAULT 5,
      fatigue_level INTEGER DEFAULT 5,
      stress_level INTEGER DEFAULT 5,
      anxiety_level INTEGER DEFAULT 5,
      focus_level INTEGER DEFAULT 5,
      confidence_level INTEGER DEFAULT 5,
      mood_score INTEGER DEFAULT 5,
      physical_state TEXT DEFAULT '',
      before_session TEXT DEFAULT '',
      after_session TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS weekly_journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL UNIQUE,
      week_end TEXT NOT NULL,
      overall_grade TEXT DEFAULT 'B',
      pnl_total REAL DEFAULT 0,
      trades_count INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      violations INTEGER DEFAULT 0,
      best_trade TEXT DEFAULT '',
      worst_trade TEXT DEFAULT '',
      technical_review TEXT DEFAULT '',
      psychological_review TEXT DEFAULT '',
      rule_compliance TEXT DEFAULT '',
      setups_analysis TEXT DEFAULT '',
      goals_met TEXT DEFAULT '',
      goals_next_week TEXT DEFAULT '',
      mindset_notes TEXT DEFAULT '',
      lessons TEXT DEFAULT '',
      avg_sleep REAL DEFAULT 0,
      avg_stress REAL DEFAULT 0,
      avg_focus REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period TEXT NOT NULL,
      analysis TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrate ai_analyses for weekly reports (safe if columns already exist).
  const aiCols = await db.execute("PRAGMA table_info(ai_analyses)");
  const aiColNames = aiCols.rows.map((r: any) => r.name);
  if (!aiColNames.includes("week_start")) {
    await db.execute("ALTER TABLE ai_analyses ADD COLUMN week_start TEXT DEFAULT ''");
  }
  if (!aiColNames.includes("week_end")) {
    await db.execute("ALTER TABLE ai_analyses ADD COLUMN week_end TEXT DEFAULT ''");
  }

  // Always ensure main setups exist (upsert)
  await seedSetups();

  const cnt2 = await db.execute("SELECT COUNT(*) as c FROM principles");
  if ((cnt2.rows[0] as any).c === 0) {
    await seedPrinciples();
  }
}

async function seedSetups() {
  const setups = [
    {
      name: "W-E Macro Flow",
      category: "Wyckoff+Elliott",
      description: "Leitura macro Wyckoff-first combinada com Elliott Wave. Entry em chock nos imbalances macro. Confluência máxima — todos os timeframes alinhados.",
      steps: JSON.stringify([
        "1. Identificar a onda Elliott na macro (D1/W): determinar se impulso (1-3-5) ou correção (A-B-C, flat, triangle). Marcar onde estamos na contagem.",
        "2. Assinalar estrutura Wyckoff na macro: Acumulação, Distribuição, Re-acumulação ou Re-distribuição. Identificar a fase atual (A/B/C/D/E).",
        "3. Identificar Imbalances/Fair Values na macro (H4/D1): marcar FVGs e zonas de desequilíbrio não preenchidas. Estas são as zonas-alvo de entrada.",
        "4. Timeframes intermédios (H1/H4): identificar estruturas Wyckoff em curso — tipo, fase atual, eventos presentes (Spring/UTAD/SOS/SOW).",
        "5. Aguardar chock (Spring ou UTAD) nos M2/M5 dentro da região de imbalance macro. Confirmar com volume e SOS/SOW bar. SL além do chock."
      ]),
      timeframes: "D1/W (Elliott+Wyckoff macro) | H4/H1 (Wyckoff estrutura) | M15/M5/M2 (entrada)",
      markets: "Forex, Indices, Crypto, Futuros",
      confluence: "Onda Elliott clara + Wyckoff fase D/E + FVG H4 + Spring/UTAD M5 + volume + SOS/SOW bar",
      invalidation: "Onda Elliott ambígua | Wyckoff Fase B | Sem imbalance | Chock sem volume | Contra HTF bias",
      image_refs: JSON.stringify(["wyckoff_reaccumulation","wyckoff_redistribution","elliott_corrections","elliott_complex","elliott_triangles"])
    },
    {
      name: "E-W Impulse Rider",
      category: "Elliott+Wyckoff",
      description: "Leitura macro Elliott-first. Identifica a onda, valida com Wyckoff macro, procura padrões corretivos intermédios e entra no chock dentro do imbalance macro.",
      steps: JSON.stringify([
        "1. Identificar a onda Elliott na macro (D1/W): contar ondas, determinar posição. Marcar níveis de Fibonacci da onda em curso.",
        "2. Assinalar estrutura Wyckoff na macro (D1/H4): validar contexto direcional da onda Elliott identificada.",
        "3. Identificar Imbalances/Fair Values na macro (H4/D1): marcar FVGs que coincidem com retrocessos de Fibonacci.",
        "4. Timeframes intermédios (H1/H4): identificar padrão Elliott — flat irregular, retração regular, triângulo, ABCD, ABC. Medir extensões Fibonacci para TP.",
        "5. Aguardar chock (Spring/UTAD) nos M2/M5 dentro da região de imbalance + Fibonacci. Confirmar com SOS/SOW bar. SL além do chock."
      ]),
      timeframes: "D1/W (Elliott + Wyckoff) | H4/H1 (padrão corretivo Elliott) | M5/M2 (entrada chock)",
      markets: "Forex, Indices, Crypto, Futuros",
      confluence: "Elliott clara + padrão corretivo completo + FVG na zona Fibonacci + Chock M5 + SOS/SOW bar",
      invalidation: "Contagem Elliott ambígua | Padrão corretivo incompleto | Sem FVG | Chock sem confirmação",
      image_refs: JSON.stringify(["elliott_corrections","elliott_complex","elliott_triangles","wyckoff_reaccumulation","wyckoff_redistribution"])
    },
    {
      name: "ICT MSS + OB",
      category: "ICT",
      description: "Market Structure Shift seguido de reentrada no Order Block.",
      steps: JSON.stringify([
        "1. Identificar trend dominante no H4/D1 — determinar bias geral",
        "2. Aguardar MSS (Market Structure Shift / BOS) no H1",
        "3. Identificar o Order Block que causou o MSS",
        "4. Aguardar retorno ao OB com diminuição de volume",
        "5. Confirmar rejeição no M15/M5 com vela de inversão",
        "6. SL abaixo/acima do OB | TP no próximo nível de liquidez"
      ]),
      timeframes: "D1/H4 (bias) | H1 (MSS) | M15/M5 (entrada)",
      markets: "Forex, Indices",
      confluence: "BOS H4 + OB H1 + FVG M15 + Volume decrescente no retorno",
      invalidation: "Vela fecha dentro do OB | OB violado sem recuperação",
      image_refs: "[]"
    },
    {
      name: "FVG + OB",
      category: "ICT",
      description: "Fair Value Gap combinado com Order Block.",
      steps: JSON.stringify([
        "1. Identificar FVG no H1 após movimento impulsivo",
        "2. Verificar OB na zona do FVG (confluência)",
        "3. Aguardar retorno à zona",
        "4. Confirmar rejeição no M15",
        "5. Entrar na sobreposição FVG+OB com SL além da zona"
      ]),
      timeframes: "H4/H1 (FVG+OB) | M15 (confirmação)",
      markets: "Forex, Indices, Crypto",
      confluence: "FVG + OB alinhados + EQH/EQL como target",
      invalidation: "Preço fecha através do FVG | OB sem rejeição",
      image_refs: "[]"
    },
    {
      name: "Liquidity Sweep",
      category: "ICT",
      description: "Sweep de liquidez (BSL/SSL) seguido de reversão.",
      steps: JSON.stringify([
        "1. Identificar pool de liquidez clara (EQH/EQL, highs/lows anteriores)",
        "2. Aguardar sweep com wick pronunciado",
        "3. Confirmar CISD no M15",
        "4. Entrada após close de confirmação",
        "5. SL acima/abaixo do wick | TP no nível oposto"
      ]),
      timeframes: "H4/H1 | M15/M5",
      markets: "Forex",
      confluence: "Sweep limpo + CISD M15 + FVG na direção",
      invalidation: "Preço continua na direção do sweep",
      image_refs: "[]"
    },
    {
      name: "SMC 3-Step Scalping",
      category: "SMC",
      description: "Estratégia de scalping de 3 passos em SOL/USDT (aplicável a qualquer ativo líquido). Combina Liquidity Sweep de 15m, Change of Character de 1m com volume institucional, e entrada em FVG de 1m confluente com a Golden Ratio de Fibonacci (0.618–0.786). R:R mínimo obrigatório de 1:3.",
      steps: JSON.stringify([
        "PASSO 1 — HTF 15m (Direção): Identificar Liquidity Sweep. Preço viola máximo ou mínimo chave de 15m mas fecha de volta para dentro (wick de desvio). Tolerância ≤ 0.2% do preço. Janela ativa: máximo 30 velas de 1m. RSI confluente valorizado.",
        "PASSO 2 — LTF 1m (Confirmação): Após o toque na zona de 15m, aguardar Change of Character (ChoCH) claro no gráfico de 1m. ChoCH Bullish = close acima do último Lower High. ChoCH Bearish = close abaixo do último Higher Low. OBRIGATÓRIO: volume da vela do ChoCH > média 20 velas × 1.5. Janela ativa: máximo 20 velas de 1m após o Passo 1.",
        "PASSO 3 — Execução 1m (Entrada Precisa): Traçar Fibonacci do início ao extremo do impulso do ChoCH. Identificar FVG de 1m (gap high[2] < low[0], mínimo 0.10% do preço) que coincida com a Golden Ratio 0.618–0.786. Colocar ordem LIMITE no topo do FVG (Long) ou base do FVG (Short).",
        "GATE R:R — Antes de confirmar: calcular R:R disponível até ao próximo pool de liquidez oposta de 15m. SE R:R < 3.0 → REJEITAR o setup sem exceções.",
        "GESTÃO — SL Agressivo: 1 tick além do fundo/topo do FVG (apenas se FVG > 0.15%). SL Conservador: 1 tick além do extremo do impulso do ChoCH. TP Parcial (50%) no 1:2 → mover SL para Break-Even. TP Final (50%) no 1:3+ ou liquidez oposta de 15m."
      ]),
      timeframes: "15m (Direção + Liquidez) | 1m (ChoCH + FVG + Execução)",
      markets: "SOL/USDT, BTC/USDT, ETH/USDT, Forex majors, Índices",
      confluence: "15m Liquidity Sweep ativo + 1m ChoCH com volume × 1.5 + FVG de 1m na Golden Ratio 0.618–0.786 + R:R disponível ≥ 3.0 + Spread < 50% do FVG",
      invalidation: "Sem Liquidity Sweep de 15m claro | ChoCH sem spike de volume | FVG fora da zona 0.618–0.786 | R:R calculado < 3.0 | ATR > 1.5% (volatilidade extrema) | Anúncio macro de alto impacto nos próximos 30m | Drawdown diário ≥ 3% | Spread > 50% do FVG",
      image_refs: JSON.stringify(["smc_liquidity_sweep", "smc_choch", "smc_fvg_golden_ratio"])
    }
  ];

  for (const s of setups) {
    // INSERT OR REPLACE forces upsert: updates existing rows (matched by UNIQUE name) and inserts new ones.
    // This ensures seeds are always in sync with code without touching trades or other tables.
    await db.execute({
      sql: `INSERT INTO setups (name,category,description,steps,timeframes,markets,confluence,invalidation,image_refs)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(name) DO UPDATE SET
              category=excluded.category,
              description=excluded.description,
              steps=excluded.steps,
              timeframes=excluded.timeframes,
              markets=excluded.markets,
              confluence=excluded.confluence,
              invalidation=excluded.invalidation,
              image_refs=excluded.image_refs`,
      args: [s.name,s.category,s.description,s.steps,s.timeframes,s.markets,s.confluence,s.invalidation,s.image_refs],
    });
  }
}

async function seedPrinciples() {
  const principles = [
    ["Só trades com setup catalogado","Nunca entrar sem um dos setups definidos.","discipline"],
    ["Pausa após 2 losses consecutivos","30 minutos de pausa obrigatória após 2 perdas.","risk"],
    ["Risk máximo 1% por trade","Nunca arriscar mais de 1%. Score mental <5: máximo 0.5%.","risk"],
    ["Sem trading com sono <6h ou stress >7","Condições de não-trading.","psychology"],
    ["Estado mental D = sem trading","Fechar plataforma, sem exceções.","psychology"],
    ["Chock obrigatório para entrar","Sem Spring/UTAD nos M5/M2: sem entrada.","strategy"],
    ["Elliott + Wyckoff devem alinhar","Os dois sistemas na mesma direção na macro.","strategy"],
    ["Máximo 3 trades por dia","Após 3 trades, encerrar sessão.","discipline"],
    ["Sem trading antes de High Impact News","Fechar posições 30min antes de NFP, CPI, FOMC.","risk"],
    ["Journal obrigatório em cada trade","Registo técnico + mental completo.","discipline"],
    ["Revisão semanal todo domingo","Journal semanal, ajustar metas.","discipline"],
    ["SMC 3-Step: R:R mínimo 1:3 obrigatório","No setup SMC 3-Step, nunca entrar se o R:R calculado até à liquidez oposta de 15m for inferior a 3.0. Sem exceções.","risk"],
    ["SMC 3-Step: 3 passos obrigatoriamente sequenciais","O Passo 2 (ChoCH) só é válido após o Passo 1 (Sweep). O Passo 3 (FVG) só é válido após o Passo 2. Nunca pular etapas.","strategy"],
    ["SMC 3-Step: drawdown diário máx 3%","No trading SMC scalping, parar toda a atividade ao atingir 3% de drawdown no dia.","risk"],
  ];
  for (const p of principles) {
    await db.execute({ sql:`INSERT INTO principles (title,body,category) VALUES (?,?,?)`, args:p });
  }
}
