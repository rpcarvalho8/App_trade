import { describe, expect, it } from "vitest";
import { addDays, buildIcs, defaultStart, mondayOf, STUDY_PLAN, studyForDate, weekFor, weekNumber, weekdayOf } from "../study-plan";
import { mdToHtml } from "../md";

describe("study-plan: datas", () => {
  it("segunda-feira e dia da semana", () => {
    expect(weekdayOf("2026-11-19")).toBe(4); // quinta
    expect(mondayOf("2026-11-19")).toBe("2026-11-16");
    expect(mondayOf("2026-11-22")).toBe("2026-11-16"); // domingo pertence à semana que começou na segunda
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(defaultStart("2026-11-19")).toBe("2026-11-16");
  });

  it("número da semana do plano", () => {
    expect(weekNumber("2026-11-16", "2026-11-22")).toBe(1);
    expect(weekNumber("2026-11-16", "2026-11-23")).toBe(2);
    expect(weekNumber("2026-11-16", "2026-11-10")).toBe(0);
  });

  it("depois da semana 6 alterna os ciclos de consolidação", () => {
    expect(weekFor(6).title).toBe(STUDY_PLAN[5].title);
    expect(weekFor(7).title).toMatch(/Consolidação A/);
    expect(weekFor(8).title).toMatch(/Consolidação B/);
    expect(weekFor(9).title).toMatch(/Consolidação A/);
    expect(weekFor(9).week).toBe(9);
  });
});

describe("study-plan: hoje", () => {
  it("dia útil: sem sessões hoje, próxima é sábado da mesma semana", () => {
    const t = studyForDate("2026-11-16", "2026-11-19");
    expect(t.isWeekend).toBe(false);
    expect(t.todaySessions).toEqual([]);
    expect(t.next?.date).toBe("2026-11-21");
    expect(t.next?.session.weekday).toBe(6);
    expect(t.weekend).toEqual({ saturday: "2026-11-21", sunday: "2026-11-22" });
  });

  it("sábado e domingo mostram as sessões do dia", () => {
    expect(studyForDate("2026-11-16", "2026-11-21").todaySessions.map((s) => s.id)).toEqual(["w1-sat"]);
    const sun = studyForDate("2026-11-16", "2026-11-29");
    expect(sun.weekNumber).toBe(2);
    expect(sun.todaySessions.map((s) => s.id)).toEqual(["w2-sun", "w2-rev"]);
  });

  it("cada semana tem sessões ao sábado e ao domingo", () => {
    for (const w of STUDY_PLAN) {
      expect(w.sessions.some((s) => s.weekday === 6)).toBe(true);
      expect(w.sessions.some((s) => s.weekday === 0)).toBe(true);
    }
  });
});

describe("study-plan: calendário .ics", () => {
  it("gera eventos de fim de semana em hora de Lisboa com alarme", () => {
    const ics = buildIcs("2026-11-16", 2);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(6);
    expect(ics).toContain("DTSTART;TZID=Europe/Lisbon:20261121T090000");
    expect(ics).toContain("DTSTART;TZID=Europe/Lisbon:20261129T180000");
    expect(ics).toContain("TRIGGER:-PT15M");
    for (const line of ics.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
  });
});

describe("md: listas numeradas", () => {
  it("converte 1. em <ol>", () => {
    const html = mdToHtml("1. um\n2. dois\n\n- a");
    expect(html).toContain("<ol>\n<li>um</li>\n<li>dois</li>\n</ol>");
    expect(html).toContain("<ul>\n<li>a</li>\n</ul>");
  });
});
