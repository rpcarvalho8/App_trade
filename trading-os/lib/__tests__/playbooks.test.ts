import { describe, it, expect } from "vitest";
import { STRATEGY_PLAYBOOKS, initialChecks, stepsFor } from "@/lib/playbooks";
import { STRATEGIES } from "@/lib/strategies";

describe("Mesa por estratégia", () => {
  it("cada estratégia do motor tem a sua lista de passos e os passos do motor existem na sequência", () => {
    for (const [id, strat] of Object.entries(STRATEGIES)) {
      const pb = STRATEGY_PLAYBOOKS[id];
      expect(pb, id).toBeTruthy();
      expect(pb.asset).toBe(strat.symbol);
      const seq = new Set(strat.sequence.map((s) => String(s.type)));
      for (const st of pb.steps) if (st.engineStep) expect(seq.has(st.engineStep), `${id}:${st.engineStep}`).toBe(true);
      // Todos os passos da sequência do motor aparecem na Mesa.
      const mapped = new Set(pb.steps.map((s) => s.engineStep).filter(Boolean));
      for (const t of seq) expect(mapped.has(t), `${id} falta ${t}`).toBe(true);
    }
  });

  it("vindo de um sinal, os passos do motor entram a SIM e os manuais ficam por marcar", () => {
    const pb = STRATEGY_PLAYBOOKS["xauusd-london-structure"];
    const c = initialChecks(pb, true);
    expect(c.sweep).toBe("yes");
    expect(c.zone).toBe("yes");
    expect(c.broker_check).toBe("pending");
    expect(c.rr).toBe("pending");
    expect(c.risk).toBe("pending");
    expect(stepsFor(pb, false).some((s) => s.id === "broker_check")).toBe(false);
    expect(initialChecks(pb, false).sweep).toBe("pending");
  });
});
