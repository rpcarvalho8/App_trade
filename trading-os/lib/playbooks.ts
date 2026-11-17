export type SessionAsset = "XAUUSD" | "SOLUSD";
export type StepKind = "manual" | "news" | "rr" | "filters";

export interface PlaybookStep {
  id: string;
  label: string;
  /** Timeframe ou sítio onde olhas. */
  chart: string;
  /** Acção concreta a realizar. */
  do: string;
  /** Condição para clicar SIM. */
  yesIf: string;
  /** Condição para clicar NÃO. */
  noIf: string;
  kind: StepKind;
  /**
   * Passo do motor de sinais (lib/strategies/*.json) que confirma este passo. Quando a Mesa abre a
   * partir de um sinal, estes passos já vêm a SIM; os restantes continuam manuais.
   */
  engineStep?: string;
  /** Só aparece quando a Mesa abre a partir de um sinal do motor. */
  signalOnly?: boolean;
}

export interface AssetPlaybook {
  asset: SessionAsset;
  /** Id da estratégia do motor (lib/strategies/*.json). */
  strategyId: string;
  setupName: string;
  title: string;
  tagline: string;
  sessionWindow: string;
  defaultSession: string;
  timeframes: string;
  minRR: number;
  maxTrades: number;
  maxDailyDD: number;
  pauseAfterLosses: number;
  pauseMinutes: number;
  defaultRiskPct: number;
  reducedRiskPct: number;
  /** "observacao" = só demo até o histórico provar edge (ver nota). */
  status: "live" | "observacao";
  statusNote?: string;
  steps: PlaybookStep[];
  management: string[];
  invalidation: string[];
  killSwitch: string[];
}

export const PLAYBOOKS: Record<SessionAsset, AssetPlaybook> = {
  XAUUSD: {
    asset: "XAUUSD",
    strategyId: "xauusd-london-structure",
    setupName: "XAUUSD — London Structure",
    title: "London Structure",
    tagline: "Primeiro defines a direcção no H4. Depois esperas uma falsa quebra no M15. Só então entras no M5.",
    sessionWindow: "Só operas na sessão de Londres ou no cruzamento Londres+Nova Iorque. Fora disto: observas, não entras.",
    defaultSession: "London",
    timeframes: "H4 = direcção · M15 = falsa quebra e viragem · M5 = sítio exacto da ordem",
    minRR: 2,
    maxTrades: 2,
    maxDailyDD: 1.5,
    pauseAfterLosses: 2,
    pauseMinutes: 30,
    defaultRiskPct: 0.5,
    reducedRiskPct: 0.25,
    status: "live",
    steps: [
      {
        id: "news",
        label: "Confirmar que não há notícia americana a 30 minutos",
        chart: "Painel Contexto (calendário), à direita",
        do: "Olha para os eventos listados no painel. Procura NFP, CPI, FOMC ou discurso da Fed. Se algum estiver a 30 minutos ou menos, não há trade.",
        yesIf: "Não há nenhum desses eventos nos próximos 30 minutos.",
        noIf: "Há uma notícia forte a sair em breve. A app bloqueia este passo sozinha.",
        kind: "news",
        engineStep: "calendar_clean",
      },
      {
        id: "bias",
        label: "Definir a direcção no gráfico de 4 horas",
        chart: "Gráfico H4",
        do: "Abre o H4. Os máximos e mínimos estão a subir (compras) ou a descer (vendas)? Tens de conseguir dizer em voz alta: «hoje só compro» ou «hoje só vendo».",
        yesIf: "A tendência de 4 horas está óbvia, num só sentido.",
        noIf: "O preço está de lado, a ir e a voltar, sem direcção. Não operas.",
        kind: "manual",
        engineStep: "bias_h4",
      },
      {
        id: "sweep",
        label: "Esperar a falsa quebra de um máximo ou mínimo no M15",
        chart: "Gráfico M15",
        do: "Marca o último máximo ou mínimo importante. O preço tem de furar esse nível com o pavio (a sombra da vela) e fechar outra vez do lado de dentro. Se a vela fechar para lá do nível, é quebra verdadeira — não serve.",
        yesIf: "Furou o nível e fechou de volta para dentro (falsa quebra).",
        noIf: "Quebrou e ficou fechado do outro lado, ou ainda não furou nada.",
        kind: "manual",
        engineStep: "liquidity_sweep",
      },
      {
        id: "mss",
        label: "Confirmar que o M15 virou na mesma direcção do H4",
        chart: "Gráfico M15, depois da falsa quebra",
        do: "Espera uma vela que quebre a estrutura recente a favor do H4. Se no H4 estás a comprar: o M15 tem de fechar acima do último máximo menor. Se estás a vender: tem de fechar abaixo do último mínimo maior.",
        yesIf: "O M15 já virou e aponta para o mesmo lado do H4.",
        noIf: "O preço continua na direcção da quebra, sem virar. Não há entrada.",
        kind: "manual",
        engineStep: "mss_cisd",
      },
      {
        id: "zone",
        label: "Marcar no M5 o sítio exacto da ordem",
        chart: "Gráfico M5",
        do: "Desce para o M5. Marca a última zona de onde saiu o movimento que virou o mercado: um bloco de velas (zona de ofertas) ou um buraco entre velas (gap). É aí que colocas a ordem. O stop fica para lá do extremo da falsa quebra do M15.",
        yesIf: "Consegues apontar com o rato o sítio exacto da entrada e do stop.",
        noIf: "Não vês uma zona nítida. Esperas; não improvisas.",
        kind: "manual",
        engineStep: "ob_or_fvg",
      },
      {
        id: "rr",
        label: "Verificar se o lucro vale pelo menos o dobro do risco",
        chart: "Calculadora desta página",
        do: "Preenche Entrada, Stop e Take Profit. O take profit é o próximo máximo (se vendes) ou mínimo (se compras) claro no M15 ou H1. A calculadora tem de dar 1:2 ou mais. Em ouro não forces 1:3.",
        yesIf: "A calculadora mostra 1:2 ou superior.",
        noIf: "Dá menos de 1:2. Rejeitas o trade — não alargas o take profit à força.",
        kind: "rr",
      },
      {
        id: "risk",
        label: "Fixar o risco da posição e o estado para operar",
        chart: "Calculadora + Gate mental, à direita",
        do: "Risco normal: 1% da conta. Se estás cansado ou pouco focado, usa 0,5%. Preenche sono, stress e nota mental. Com menos de 6 horas de sono, stress acima de 7, ou nota D, a sessão fecha.",
        yesIf: "O risco está definido (1% ou 0,5%) e podes operar.",
        noIf: "Sono, stress ou nota mental fora das regras. Hoje não operas ouro.",
        kind: "filters",
      },
    ],
    management: [
      "O stop fica para lá do extremo da falsa quebra.",
      "Quando o preço andar a teu favor o equivalente ao risco (1R), sais de metade e pões o stop no preço de entrada (sem prejuízo).",
      "A outra metade corre até ao próximo máximo ou mínimo contrário no M15/H1.",
    ],
    invalidation: [
      "Uma vela fecha para lá da tua zona de entrada — sais.",
      "Sai uma notícia forte americana — não entras / sais se ainda não estiver resolvido.",
      "O H4 deixa de apontar para o teu lado — não acrescentas.",
      "O rácio lucro/risco ficou abaixo de 1:2 — não entras.",
    ],
    killSwitch: [
      "Duas perdas seguidas: paras 30 minutos.",
      "No máximo 2 trades de ouro por dia.",
      "Se já perdeste 1,5% da conta hoje neste activo: paras.",
      "Nota D, sono abaixo de 6 h ou stress acima de 7: não operas.",
    ],
  },
  SOLUSD: {
    asset: "SOLUSD",
    strategyId: "solusd-smc-3step",
    setupName: "SMC 3-Step Scalping",
    title: "SMC 3-Step",
    tagline: "Três passos obrigatórios, por esta ordem: falsa quebra no 15m, viragem no 1m com volume, e ordem no gap do 1m.",
    sessionWindow: "Operas quando o mercado americano está activo. Se o 15m estiver morto (pouca liquidez, típico da Ásia), não forces.",
    defaultSession: "NY",
    timeframes: "15 minutos = direcção · 1 minuto = viragem, gap e ordem",
    minRR: 3,
    maxTrades: 3,
    maxDailyDD: 1.5,
    pauseAfterLosses: 2,
    pauseMinutes: 30,
    defaultRiskPct: 0.5,
    reducedRiskPct: 0.25,
    status: "observacao",
    statusNote: "Em observação: no histórico, SOL deu PF 0,44 em 51 trades. Opera só em demo até teres 30 trades com PF acima de 1,3 e payoff acima de 1,5. As trades gravadas aqui ficam marcadas como demo.",
    steps: [
      {
        id: "sweep",
        label: "Passo 1 — Marcar a falsa quebra no gráfico de 15 minutos",
        chart: "Gráfico de 15 minutos",
        do: "Marca o último máximo ou mínimo claro. O preço tem de furar esse nível com o pavio e a vela de 15m tem de fechar outra vez do lado de dentro. O pavio não pode ir mais de 0,2% para lá do nível. A partir daqui tens, no máximo, 30 velas de 1 minuto para completar o resto.",
        yesIf: "Vês a falsa quebra (furou e fechou dentro) e o desvio é pequeno (≤ 0,2%).",
        noIf: "Não furou, ou furou e ficou fechado do outro lado, ou o pavio foi demasiado longo. Sem este passo, não há setup.",
        kind: "manual",
        engineStep: "liquidity_sweep",
      },
      {
        id: "choch",
        label: "Passo 2 — Esperar a viragem no gráfico de 1 minuto, com volume",
        chart: "Gráfico de 1 minuto, depois do Passo 1",
        do: "No 1m, espera que o preço deixe de fazer a estrutura anterior. Para comprar: uma vela tem de fechar acima do último máximo menor. Para vender: tem de fechar abaixo do último mínimo maior. Essa vela de viragem tem de ter volume pelo menos 1,5 vezes a média das últimas 20 velas. Tens no máximo 20 velas de 1m depois do Passo 1.",
        yesIf: "A estrutura de 1m virou e a vela da viragem veio com volume alto.",
        noIf: "Virou sem volume, ou já passaram 20 velas de 1m sem viragem. O setup morreu.",
        kind: "manual",
        engineStep: "choch_volume",
      },
      {
        id: "fvg",
        label: "Passo 3 — Colocar a ordem no gap de 1m, na zona 61,8%–78,6% do Fibonacci",
        chart: "Gráfico de 1 minuto",
        do: "Traça o Fibonacci do início ao extremo do movimento que fez a viragem. Procura um buraco entre velas (três velas em que a do meio não toca nas outras) com pelo menos 0,10% de tamanho, e que coincida com a zona 61,8%–78,6% do Fibonacci. Compra: ordem limite no topo do buraco. Venda: ordem limite na base do buraco.",
        yesIf: "Existe um gap nítido, grande o suficiente, dentro da zona 61,8–78,6.",
        noIf: "O gap está fora dessa zona, é demasiado pequeno, ou não existe. Não entras.",
        kind: "manual",
        engineStep: "fvg_golden_ratio",
      },
      {
        id: "rr",
        label: "Confirmar que o lucro vale pelo menos o triplo do risco",
        chart: "Calculadora desta página",
        do: "Preenche Entrada, Stop e Take Profit. O take profit é o próximo máximo ou mínimo contrário no gráfico de 15 minutos. A calculadora tem de dar 1:3 ou mais. Abaixo disso rejeitas, sem excepções.",
        yesIf: "A calculadora mostra 1:3 ou superior.",
        noIf: "Dá menos de 1:3. O trade está proibido, mesmo que o gráfico «pareça» bom.",
        kind: "rr",
      },
      {
        id: "filters",
        label: "Confirmar spread, volatilidade e ausência de notícia",
        chart: "Plataforma (spread) + gráfico 15m (volatilidade) + painel Contexto",
        do: "O spread da corretora tem de ser menor que metade do tamanho do gap. No 15m, se o mercado estiver a oscilar mais de 1,5% (volatilidade extrema), não entras. Confirma também que não há notícia forte nos próximos 30 minutos. Se o Bitcoin estiver num movimento violento, esperas.",
        yesIf: "Spread pequeno face ao gap, volatilidade normal, sem notícia à porta.",
        noIf: "Spread caro, mercado a disparar, ou notícia a 30 minutos. A app bloqueia se houver notícia.",
        kind: "news",
      },
    ],
    management: [
      "Stop apertado: um tick para lá do gap (só se o gap tiver mais de 0,15%).",
      "Stop largo: um tick para lá do extremo do movimento que fez a viragem no 1m.",
      "Quando fores a 1:2, sais de metade e pões o stop no preço de entrada.",
      "A outra metade corre até 1:3 ou até ao máximo/mínimo contrário do 15m.",
    ],
    invalidation: [
      "Não houve falsa quebra clara no 15m.",
      "A viragem de 1m veio sem volume.",
      "O gap não está na zona 61,8%–78,6%.",
      "O rácio lucro/risco ficou abaixo de 1:3.",
      "Volatilidade extrema ou spread demasiado largo face ao gap.",
    ],
    killSwitch: [
      "Duas perdas seguidas: paras 30 minutos.",
      "No máximo 3 trades de SOL por dia.",
      "Se já perdeste 3% da conta hoje neste activo: paras.",
      "Nota D, sono abaixo de 6 h ou stress acima de 7: não operas.",
    ],
  },
};

/**
 * Passo extra quando a Mesa abre a partir de um sinal: o motor viu o gráfico do agregador
 * (Twelve Data / Kraken); tu confirmas na plataforma da conta antes de pôr a ordem.
 */
export const BROKER_CHECK_STEP: PlaybookStep = {
  id: "broker_check",
  label: "Confirmar o sinal no gráfico da tua conta",
  chart: "Plataforma da prop firm (ouro) ou Kraken (SOL), mesmo timeframe de entrada",
  do: "Abre o gráfico na plataforma da conta e confirma que o setup do sinal é visível ali e que o preço ainda está perto do PE (o sinal vale 3 velas do timeframe de entrada). Ajusta PE/SL ao spread real se for preciso.",
  yesIf: "Vês o mesmo setup e o preço ainda está perto da entrada.",
  noIf: "O preço já fugiu da entrada, o sinal expirou, ou o gráfico da plataforma não mostra o mesmo.",
  kind: "manual",
  signalOnly: true,
};

function rotationPlaybook(asset: SessionAsset): AssetPlaybook {
  const base = PLAYBOOKS[asset];
  return {
    ...base,
    strategyId: asset === "XAUUSD" ? "xauusd-htf-rotation" : "solusd-htf-rotation",
    setupName: "HTF Imbalance Rotation",
    title: "HTF Imbalance Rotation",
    tagline: "O preço volta a uma zona fresca de H4/H1 a favor da tendência de 4 horas. Entras quando o M5 vira dentro da zona.",
    timeframes: "H4 = direcção · H4/H1 = zona (FVG ou bloco de ordens) · M5 = viragem e entrada",
    minRR: 2,
    maxTrades: Math.min(base.maxTrades, 2),
    pauseMinutes: 60,
    steps: [
      {
        id: "news",
        label: "Confirmar que não há notícia forte a 30 minutos",
        chart: "Painel Contexto (calendário)",
        do: "Procura NFP, CPI, FOMC ou discurso da Fed nos próximos 30 minutos.",
        yesIf: "Nenhum evento forte nos próximos 30 minutos.",
        noIf: "Há notícia forte em breve. A app bloqueia este passo sozinha.",
        kind: "news",
        engineStep: "calendar_clean",
      },
      {
        id: "zone",
        label: "Preço a tocar uma zona fresca de H4/H1 a favor do H4",
        chart: "Gráficos H4 e H1",
        do: "No H4 confirma a direcção (último BOS). Procura a primeira FVG ou bloco de ordens ainda não tocado, em H4 ou H1, que saiu de um impulso forte a favor dessa direcção. O preço tem de estar a tocá-la agora.",
        yesIf: "O preço está dentro de uma zona fresca H4/H1, alinhada com o H4 (o motor avisa com ARMADO).",
        noIf: "A zona já foi usada, é contra o H4, ou o preço ainda não chegou lá.",
        kind: "manual",
        engineStep: "htf_zone_tap",
      },
      {
        id: "mss",
        label: "Viragem de estrutura no M5 dentro da zona",
        chart: "Gráfico M5",
        do: "Dentro da zona, espera que o M5 quebre a estrutura a favor do H4 (fecho acima do último máximo menor para comprar, abaixo do último mínimo maior para vender). Tens até 24 velas de M5 depois do toque.",
        yesIf: "O M5 virou dentro da zona, a favor do H4.",
        noIf: "Uma vela de M15 fechou para lá da zona, ou passaram 24 velas sem viragem.",
        kind: "manual",
        engineStep: "ltf_mss",
      },
      {
        id: "rr",
        label: "Verificar se o lucro vale pelo menos o dobro do risco",
        chart: "Calculadora desta página",
        do: "SL para lá do extremo do toque na zona. TP na zona oposta de H4/H1 ou no swing H4, até 4R. A calculadora tem de dar 1:2 ou mais.",
        yesIf: "A calculadora mostra 1:2 ou superior.",
        noIf: "Dá menos de 1:2. Rejeitas o trade.",
        kind: "rr",
      },
      {
        id: "risk",
        label: "Fixar o risco e o estado para operar",
        chart: "Calculadora + Estado para operar",
        do: "Risco 0,5% (0,25% se estiveres cansado). Preenche sono, stress e nota mental.",
        yesIf: "Risco definido e estado para operar ok.",
        noIf: "Sono, stress ou nota mental fora das regras.",
        kind: "filters",
      },
    ],
    management: [
      "SL para lá do extremo do toque na zona (+0,1 ATR M15).",
      "A 1R fechas 50% e pões o stop no preço de entrada.",
      "O resto corre até à zona oposta H4/H1 ou ao swing H4 (máximo 4R).",
    ],
    invalidation: [
      "Uma vela de M15 fecha para lá da zona — setup morto.",
      "O H4 muda de direcção a meio do setup.",
      "Notícia forte a sair.",
      "R:R abaixo de 1:2.",
    ],
  };
}

/** Uma Mesa por estratégia do motor: os passos são os da estratégia, não os do activo. */
export const STRATEGY_PLAYBOOKS: Record<string, AssetPlaybook> = {
  "xauusd-london-structure": PLAYBOOKS.XAUUSD,
  "xauusd-htf-rotation": rotationPlaybook("XAUUSD"),
  "solusd-smc-3step": PLAYBOOKS.SOLUSD,
  "solusd-htf-rotation": rotationPlaybook("SOLUSD"),
};

export function playbooksForAsset(asset: SessionAsset): AssetPlaybook[] {
  return Object.values(STRATEGY_PLAYBOOKS).filter((p) => p.asset === asset);
}

/**
 * Estado inicial dos passos. Vindo de um sinal do motor, a sequência inteira já confirmou:
 * os passos com engineStep entram a SIM e só ficam por marcar os manuais.
 */
export function initialChecks(pb: AssetPlaybook, fromSignal: boolean): Record<string, "pending" | "yes" | "no"> {
  const out: Record<string, "pending" | "yes" | "no"> = {};
  for (const st of stepsFor(pb, fromSignal)) out[st.id] = fromSignal && st.engineStep ? "yes" : "pending";
  return out;
}

/** Passos visíveis: os da estratégia, mais a confirmação na corretora quando vem de um sinal. */
export function stepsFor(pb: AssetPlaybook, fromSignal: boolean): PlaybookStep[] {
  if (!fromSignal) return pb.steps.filter((s) => !s.signalOnly);
  const idx = pb.steps.findIndex((s) => s.kind === "rr");
  const steps = [...pb.steps];
  steps.splice(idx >= 0 ? idx : steps.length, 0, BROKER_CHECK_STEP);
  return steps;
}

export function getPlaybook(asset: string): AssetPlaybook | null {
  if (asset === "XAUUSD" || asset === "SOLUSD") return PLAYBOOKS[asset];
  return null;
}

export function calcRR(
  direction: "LONG" | "SHORT",
  entry: number,
  sl: number,
  tp: number
): number | null {
  if (![entry, sl, tp].every((n) => Number.isFinite(n) && n > 0)) return null;
  const risk = direction === "LONG" ? entry - sl : sl - entry;
  const reward = direction === "LONG" ? tp - entry : entry - tp;
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}

/** Unidades por cada 1000 de capital, dado o risco % e a distância ao SL. */
export function sizePerThousand(
  riskPct: number,
  entry: number,
  sl: number
): number | null {
  if (![riskPct, entry, sl].every((n) => Number.isFinite(n)) || entry <= 0) return null;
  const dist = Math.abs(entry - sl);
  if (dist <= 0) return null;
  const riskMoney = (1000 * riskPct) / 100;
  return riskMoney / dist;
}

export function sizeForEquity(
  equity: number,
  riskPct: number,
  entry: number,
  sl: number
): number | null {
  const perK = sizePerThousand(riskPct, entry, sl);
  if (perK == null || !Number.isFinite(equity) || equity <= 0) return null;
  return (perK * equity) / 1000;
}
