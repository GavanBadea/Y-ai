// ============================================================
//  yaiGuideSearch.js — بحث دليل Y-ai بالكلمات المفتاحية
// ============================================================
import { YAI_GUIDE_CATEGORIES, YAI_QUICK_QUESTIONS } from "@/data/yaiGuideContent";

const ARABIC_MAP = {
  أ: "ا", إ: "ا", آ: "ا", ؤ: "و", ئ: "ي", ة: "ه",
};

export function normalizeGuideText(text) {
  let s = String(text ?? "").toLowerCase().trim();
  s = s.replace(/[\u064B-\u065F\u0670]/g, "");
  for (const [from, to] of Object.entries(ARABIC_MAP)) {
    s = s.split(from).join(to);
  }
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function tokenize(text) {
  return normalizeGuideText(text).split(" ").filter((t) => t.length >= 2);
}

export function getAllGuideQuestions() {
  const out = [];
  for (const cat of YAI_GUIDE_CATEGORIES) {
    for (const q of cat.questions) {
      out.push({ ...q, categoryId: cat.id, categoryTitle: cat.title, categoryIcon: cat.icon });
    }
  }
  return out;
}

function scoreQuestion(question, normalizedQuery, tokens) {
  let score = 0;
  const title = normalizeGuideText(question.title);

  if (normalizedQuery && title.includes(normalizedQuery)) score += 40;
  if (normalizedQuery && normalizedQuery.includes(title) && title.length > 8) score += 25;

  for (const kw of question.keywords || []) {
    const nk = normalizeGuideText(kw);
    if (!nk) continue;
    if (normalizedQuery === nk) score += 50;
    else if (normalizedQuery.includes(nk)) score += 22;
    else if (nk.includes(normalizedQuery) && normalizedQuery.length >= 4) score += 14;
  }

  for (const t of tokens) {
    if (title.includes(t)) score += 10;
    for (const kw of question.keywords || []) {
      const nk = normalizeGuideText(kw);
      if (nk.includes(t) || t.includes(nk)) score += 6;
    }
  }

  return score;
}

/**
 * @returns {{ type: 'match', question } | { type: 'ambiguous', suggestions } | { type: 'none', suggestions } | { type: 'empty' }}
 */
export function searchGuide(query, { minScore = 18 } = {}) {
  const normalizedQuery = normalizeGuideText(query);
  const tokens = tokenize(query);
  if (!normalizedQuery || normalizedQuery.length < 2) return { type: "empty" };

  const all = getAllGuideQuestions();
  const scored = all
    .map((item) => ({ item, score: scoreQuestion(item, normalizedQuery, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { type: "none", suggestions: YAI_QUICK_QUESTIONS.map((id) => all.find((q) => q.id === id)).filter(Boolean) };
  }

  const top = scored[0];
  const second = scored[1];
  const clearWinner = !second || top.score >= minScore && top.score >= second.score + 8;

  if (clearWinner && top.score >= minScore) {
    return { type: "match", question: top.item };
  }

  return {
    type: "ambiguous",
    suggestions: scored.slice(0, 5).map((s) => s.item),
  };
}

export function getGuideQuestionById(id) {
  return getAllGuideQuestions().find((q) => q.id === id) || null;
}

export function buildNoMatchMessage(suggestions = []) {
  let msg = "لم أجد إجابة مطابقة تماماً لسؤالك.\n\n**جرّب أحد الأسئلة التالية:**\n";
  for (const s of suggestions) {
    msg += `• ${s.title}\n`;
  }
  msg += "\nأو اختر **قسماً** من القائمة أعلاه ثم اضغط السؤال المناسب.";
  return msg;
}
