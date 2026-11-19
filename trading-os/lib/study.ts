/**
 * Estado do plano de estudo (data de início e sessões feitas) guardado em settings,
 * e o lembrete de fim de semana. A lógica de datas/conteúdo está em lib/study-plan.ts.
 */
import { readFile } from "fs/promises";
import path from "path";
import { getSetting, initDB, setSetting } from "@/lib/db";
import { defaultStart, studyForDate, type StudyToday } from "@/lib/study-plan";
import { todayISO } from "@/lib/morning-brief";

const START_KEY = "study_start_date";
const PROGRESS_KEY = "study_progress";
export const GUIDE_PATH = path.join(process.cwd(), "knowledge", "guia-estudo-xau-sol.md");

/** Chave de progresso de uma sessão: semana do plano + id da sessão. */
export const sessionKey = (week: number, id: string) => `${week}:${id}`;

export async function getStudyStart(today = todayISO()): Promise<string> {
  await initDB();
  const v = await getSetting(START_KEY);
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const start = defaultStart(today);
  await setSetting(START_KEY, start);
  return start;
}

export async function setStudyStart(date: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Data inválida (YYYY-MM-DD).");
  await initDB();
  await setSetting(START_KEY, date);
}

export async function getProgress(): Promise<Record<string, boolean>> {
  await initDB();
  try {
    return JSON.parse((await getSetting(PROGRESS_KEY)) || "{}");
  } catch {
    return {};
  }
}

export async function toggleProgress(key: string): Promise<Record<string, boolean>> {
  const p = await getProgress();
  if (p[key]) delete p[key];
  else p[key] = true;
  await setSetting(PROGRESS_KEY, JSON.stringify(p));
  return p;
}

export async function studyToday(date = todayISO()): Promise<StudyToday & { progress: Record<string, boolean> }> {
  const start = await getStudyStart(date);
  return { ...studyForDate(start, date), progress: await getProgress() };
}

export async function readGuide(): Promise<string> {
  return readFile(GUIDE_PATH, "utf8");
}

/** Lembrete das sessões de hoje (sábado/domingo): toast na app + Telegram se configurado. */
export async function sendWeekendStudyReminder(date = todayISO()): Promise<boolean> {
  const st = await studyToday(date);
  if (!st.todaySessions.length) return false;
  const { broadcastAlert } = await import("@/lib/alert-ws");
  const agenda = st.todaySessions.map((s) => `${s.start}–${s.end} ${s.title}`).join(" | ");
  broadcastAlert({
    id: `study-${date}`,
    ts: Date.now(),
    type: "study",
    level: "info",
    title: `📚 Estudo · Semana ${st.weekNumber}: ${st.week.title}`,
    message: `${agenda}. Detalhe no Morning Brief.`,
  });
  return true;
}
