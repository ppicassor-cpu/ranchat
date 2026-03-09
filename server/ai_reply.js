"use strict";

const AI_REPLY_ENABLED = String(process.env.AI_REPLY_ENABLED || "1").trim().toLowerCase() !== "0";
const AI_REPLY_SERVICE_BASE_URL = String(process.env.AI_REPLY_SERVICE_BASE_URL || "").trim().replace(/\/+$/, "");
const AI_REPLY_OLLAMA_BASE_URL = String(process.env.AI_REPLY_OLLAMA_BASE_URL || "http://127.0.0.1:11434").trim().replace(/\/+$/, "");
const AI_REPLY_OLLAMA_MODEL = String(process.env.AI_REPLY_OLLAMA_MODEL || "gemma3:1b-it-qat").trim() || "gemma3:1b-it-qat";
const AI_REPLY_TIMEOUT_MS = Number(process.env.AI_REPLY_TIMEOUT_MS || 12000);
const AI_REPLY_RATE_LIMIT_WINDOW_MS = Number(process.env.AI_REPLY_RATE_LIMIT_WINDOW_MS || 30000);
const AI_REPLY_RATE_LIMIT_MAX = Number(process.env.AI_REPLY_RATE_LIMIT_MAX || 10);
const AI_REPLY_HISTORY_MAX_TURNS = Number(process.env.AI_REPLY_HISTORY_MAX_TURNS || 8);
const AI_REPLY_HISTORY_MAX_USER_MESSAGES = Number.isFinite(Number(process.env.AI_REPLY_HISTORY_MAX_USER_MESSAGES))
  ? Math.max(1, Math.min(12, Math.trunc(Number(process.env.AI_REPLY_HISTORY_MAX_USER_MESSAGES))))
  : 4;
const AI_REPLY_HISTORY_MAX_ASSISTANT_MESSAGES = Number.isFinite(Number(process.env.AI_REPLY_HISTORY_MAX_ASSISTANT_MESSAGES))
  ? Math.max(1, Math.min(12, Math.trunc(Number(process.env.AI_REPLY_HISTORY_MAX_ASSISTANT_MESSAGES))))
  : 4;
const AI_REPLY_MAX_TEXT_LEN = Number(process.env.AI_REPLY_MAX_TEXT_LEN || 280);
const AI_REPLY_MAX_REPLY_LEN = Number(process.env.AI_REPLY_MAX_REPLY_LEN || 120);
const AI_REPLY_MAX_LINES = Number.isFinite(Number(process.env.AI_REPLY_MAX_LINES))
  ? Math.max(1, Math.min(4, Math.trunc(Number(process.env.AI_REPLY_MAX_LINES))))
  : 2;
const AI_REPLY_NUM_CTX = Number.isFinite(Number(process.env.AI_REPLY_NUM_CTX))
  ? Math.max(256, Math.min(2048, Math.trunc(Number(process.env.AI_REPLY_NUM_CTX))))
  : 320;
const AI_REPLY_NUM_PREDICT = Number.isFinite(Number(process.env.AI_REPLY_NUM_PREDICT))
  ? Math.max(16, Math.min(96, Math.trunc(Number(process.env.AI_REPLY_NUM_PREDICT))))
  : 18;
const AI_REPLY_NUM_THREAD = Number.isFinite(Number(process.env.AI_REPLY_NUM_THREAD))
  ? Math.max(1, Math.min(16, Math.trunc(Number(process.env.AI_REPLY_NUM_THREAD))))
  : 3;
const AI_REPLY_FALLBACK_ENABLED = String(process.env.AI_REPLY_FALLBACK_ENABLED || "1").trim().toLowerCase() !== "0";
const AI_REPLY_RATE_LIMIT_SWEEP_MS = Number(process.env.AI_REPLY_RATE_LIMIT_SWEEP_MS || 60000);
const aiReplyRateLimitByKey = new Map();

function sanitizeAiReplyText(v, maxLen = AI_REPLY_MAX_TEXT_LEN) {
  const hard = Math.max(1, Math.trunc(Number(maxLen) || AI_REPLY_MAX_TEXT_LEN));
  return String(v || "").trim().slice(0, hard);
}

function sanitizeAiReplyOutputText(v, maxLen = AI_REPLY_MAX_REPLY_LEN, maxLines = AI_REPLY_MAX_LINES) {
  const hardLen = Math.max(1, Math.trunc(Number(maxLen) || AI_REPLY_MAX_REPLY_LEN));
  const hardLines = Math.max(1, Math.min(4, Math.trunc(Number(maxLines) || AI_REPLY_MAX_LINES)));
  const raw = String(v || "").replace(/\r/g, "").trim();
  if (!raw) return "";

  let lines = raw
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    const compact = raw.replace(/\s+/g, " ").trim();
    const sentenceLines = compact
      .split(/(?<=[.!?])\s+/)
      .map((line) => line.trim())
      .filter(Boolean);
    lines = sentenceLines.length > 1 ? sentenceLines : compact ? [compact] : [];
  }

  if (!lines.length) return "";

  const picked = [];
  let remaining = hardLen;
  for (const line of lines.slice(0, hardLines)) {
    const budget = picked.length > 0 ? remaining - 1 : remaining;
    if (budget <= 0) break;
    const clipped = line.slice(0, budget).trim();
    if (!clipped) break;
    picked.push(clipped);
    remaining -= clipped.length + (picked.length > 1 ? 1 : 0);
  }

  return picked.join("\n").trim();
}

function forceKoreanBanmalText(v) {
  const raw = String(v || "").trim();
  if (!raw) return "";
  return raw
    .split("\n")
    .map((line) => {
      let out = String(line || "").trim();
      if (!out) return "";
      out = out.replace(/^네([,.!? ]|$)/g, "응$1");
      out = out.replace(/^아니요([,.!? ]|$)/g, "아냐$1");
      out = out.replace(/거랍니다([.!?]?)$/g, "거야$1");
      out = out.replace(/입니다([.!?]?)$/g, "이야$1");
      out = out.replace(/거예요([.!?]?)$/g, "거야$1");
      out = out.replace(/이에요([.!?]?)$/g, "이야$1");
      out = out.replace(/예요([.!?]?)$/g, "야$1");
      out = out.replace(/할 수 있습니다([.!?]?)$/g, "할 수 있어$1");
      out = out.replace(/있습니다([.!?]?)$/g, "있어$1");
      out = out.replace(/없습니다([.!?]?)$/g, "없어$1");
      out = out.replace(/맞습니다([.!?]?)$/g, "맞아$1");
      out = out.replace(/됩니다([.!?]?)$/g, "돼$1");
      out = out.replace(/합니다([.!?]?)$/g, "해$1");
      out = out.replace(/고 있어요([.!?]?)$/g, "고 있어$1");
      out = out.replace(/있어요([.!?]?)$/g, "있어$1");
      out = out.replace(/없어요([.!?]?)$/g, "없어$1");
      out = out.replace(/같아요([.!?]?)$/g, "같아$1");
      out = out.replace(/괜찮아요([.!?]?)$/g, "괜찮아$1");
      out = out.replace(/맞아요([.!?]?)$/g, "맞아$1");
      out = out.replace(/였어요([.!?]?)$/g, "였어$1");
      out = out.replace(/했어요([.!?]?)$/g, "했어$1");
      out = out.replace(/었어요([.!?]?)$/g, "었어$1");
      out = out.replace(/해요([.!?]?)$/g, "해$1");
      out = out.replace(/아요([.!?]?)$/g, "아$1");
      out = out.replace(/어요([.!?]?)$/g, "어$1");
      out = out.replace(/주세요([.!?]?)$/g, "줘$1");
      out = out.replace(/보세요([.!?]?)$/g, "봐$1");
      out = out.replace(/하세요([.!?]?)$/g, "해$1");
      out = out.replace(/해보죠([.!?]?)$/g, "해보자$1");
      out = out.replace(/줘요([.!?]?)$/g, "줘$1");
      out = out.replace(/네요([.!?]?)$/g, "네$1");
      out = out.replace(/까요([?!]?)$/g, "까$1");
      return out.trim();
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function stripAiEmojiText(v) {
  const raw = String(v || "");
  if (!raw) return "";
  return raw
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u200D\uFE0F]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function applyAiReplyStyle(v, language) {
  const text = sanitizeAiReplyOutputText(stripAiEmojiText(v), AI_REPLY_MAX_REPLY_LEN, AI_REPLY_MAX_LINES);
  if (!text) return "";
  const lang = normalizeAiReplyLanguage(language);
  if (lang === "ko" && !/[\u3040-\u30ff\u31f0-\u31ff]/.test(text)) {
    return forceKoreanBanmalText(text);
  }
  return text;
}

function normalizeAiReplyLanguage(v) {
  const raw = sanitizeAiReplyText(v, 16).toLowerCase();
  if (/^[a-z]{2}$/.test(raw)) return raw;
  return "en";
}

function normalizeAiReplyPersonaKey(v) {
  return sanitizeAiReplyText(v, 32)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "");
}

function parseAiReplyBoolean(v) {
  const raw = sanitizeAiReplyText(v, 12).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function detectAiReplyLanguageRequest(text) {
  const raw = sanitizeAiReplyText(text, AI_REPLY_MAX_TEXT_LEN).toLowerCase();
  if (!raw) return "";
  if (/(일본어|일본말|日本語|japanese|speak japanese|reply in japanese|日本語で)/i.test(raw)) return "ja";
  if (/(한국어|한국말|韓国語|korean|speak korean|reply in korean|韓国語で)/i.test(raw)) return "ko";
  return "";
}

function detectAiReplyMessageLanguageHint(text) {
  const raw = sanitizeAiReplyText(text, AI_REPLY_MAX_TEXT_LEN);
  if (!raw) return "";
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(raw)) return "ja";
  if (/[가-힣]/.test(raw)) return "ko";
  return "";
}

function resolveAiReplyOutputLanguage(language, message, history = [], options = null) {
  const baseLang = normalizeAiReplyLanguage(language);
  const opts = options && typeof options === "object" ? options : {};
  if (opts.lockOutputLanguage) return baseLang;
  const explicitCurrent = detectAiReplyLanguageRequest(message);
  if (explicitCurrent) return explicitCurrent;

  const rows = Array.isArray(history) ? history : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row || row.role !== "user") continue;
    const explicit = detectAiReplyLanguageRequest(row.content || "");
    if (explicit) return explicit;
  }

  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row) continue;
    const hint = detectAiReplyMessageLanguageHint(row.content || "");
    if (hint) return hint;
  }

  const hintCurrent = detectAiReplyMessageLanguageHint(message);
  if (hintCurrent) return hintCurrent;

  return baseLang;
}

function isAiReplyNationalityQuestion(text) {
  const raw = sanitizeAiReplyText(text, AI_REPLY_MAX_TEXT_LEN).toLowerCase();
  if (!raw) return false;
  return /(일본인이야|일본 사람|한국인이야|한국 사람|어느 나라 사람이야|日本人|韓国人|どこの国|何人|are you japanese|are you korean|what nationality)/i.test(
    raw
  );
}

function detectAiReplyDirectFastPathType(text) {
  const raw = sanitizeAiReplyText(text, AI_REPLY_MAX_TEXT_LEN).toLowerCase();
  if (!raw) return "";
  if (
    /(일본인이야|일본 사람|한국인이야|한국 사람|어느 나라 사람이야|日本人|韓国人|どこの国|何人|are you japanese|are you korean|what nationality)/i.test(
      raw
    )
  ) {
    return "nationality";
  }
  if (/(어디 출신|어디서 왔|고향이 어디|どこ出身|どこの出身|where are you from|what's your hometown)/i.test(raw)) {
    return "origin";
  }
  if (/(몇 살|나이가 어떻게|나이 뭐|何歳|年齢|いくつ|how old are you|what's your age)/i.test(raw)) {
    return "age";
  }
  if (
    /(지금 뭐해|지금 뭐 하고 있어|뭐하고 있어 지금|今何してる|いま何してる|what are you doing|what're you doing|what do you do right now)/i.test(
      raw
    )
  ) {
    return "current";
  }
  if (/(이름 뭐|이름이 뭐|뭐라고 불러|名前は|名前なに|なんて呼べば|what is your name|what's your name)/i.test(raw)) {
    return "name";
  }
  return "";
}

function pickAiReplyLanguageSwitchAck(language, history = []) {
  const lang = normalizeAiReplyLanguage(language);
  const bankByLang = {
    ko: [
      "응, 한국어로 갈게.\n편하게 이어서 말해.",
      "좋아, 다시 한국어로 얘기하자.\n그대로 편하게 말 걸어.",
    ],
    ja: [
      "うん、日本語で話すよ。\nこのまま気楽に続けよう。",
      "大丈夫、日本語でいけるよ。\nそのまま話して。",
    ],
  };
  const list = Array.isArray(bankByLang[lang]) ? bankByLang[lang] : bankByLang.ko;
  const recentAssistantKeys = new Set(
    (Array.isArray(history) ? history : [])
      .filter((row) => row && row.role === "assistant")
      .slice(-4)
      .map((row) => normalizeAiReplyCompareKey(row.content))
      .filter(Boolean)
  );
  const filtered = list.filter((line) => line && !recentAssistantKeys.has(normalizeAiReplyCompareKey(line)));
  const pool = filtered.length ? filtered : list;
  const pickIndex = pool.length <= 1 ? 0 : Math.floor(Math.random() * pool.length);
  return String(pool[pickIndex] || pool[0] || "").trim();
}

function normalizeAiReplyMode(v) {
  const raw = sanitizeAiReplyText(v, 16).toLowerCase();
  if (raw === "nudge" || raw === "idle") return "nudge";
  return "reply";
}

function normalizeAiReplyHistory(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  const normalized = [];
  rows.forEach((row) => {
    if (!row || typeof row !== "object") return;
    const text = sanitizeAiReplyText(row.text || row.content || "", AI_REPLY_MAX_TEXT_LEN);
    if (!text) return;
    if (/^\[GIFT\]\s*/.test(text)) return;
    const mine = row.mine === true || String(row.role || "").toLowerCase() === "user";
    normalized.push({
      role: mine ? "user" : "assistant",
      content: text,
    });
  });
  return limitAiReplyHistoryByRole(normalized, AI_REPLY_HISTORY_MAX_USER_MESSAGES, AI_REPLY_HISTORY_MAX_ASSISTANT_MESSAGES);
}

function limitAiReplyHistoryByRole(rows, maxUserRows, maxAssistantRows) {
  const hardUserRows = Math.max(
    0,
    Math.min(
      20,
      Number.isFinite(Number(maxUserRows))
        ? Math.trunc(Number(maxUserRows))
        : Math.max(1, Math.min(20, Math.trunc(Number(AI_REPLY_HISTORY_MAX_TURNS) || 8)))
    )
  );
  const hardAssistantRows = Math.max(
    0,
    Math.min(
      20,
      Number.isFinite(Number(maxAssistantRows))
        ? Math.trunc(Number(maxAssistantRows))
        : Math.max(1, Math.min(20, Math.trunc(Number(AI_REPLY_HISTORY_MAX_TURNS) || 8)))
    )
  );
  let userCount = 0;
  let assistantCount = 0;
  const picked = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row) continue;
    if (row.role === "user") {
      if (userCount >= hardUserRows) continue;
      userCount += 1;
      picked.push(row);
      continue;
    }
    if (assistantCount >= hardAssistantRows) continue;
    assistantCount += 1;
    picked.push(row);
  }
  return picked.reverse();
}

function normalizeAiReplyCompareKey(v) {
  return sanitizeAiReplyText(v, AI_REPLY_MAX_REPLY_LEN)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\u00c0-\u024f]+/g, " ")
    .trim();
}

const AI_REPLY_NUDGE_FALLBACK_BY_LANG = {
  ko: [
    "뭐해? 갑자기 조용해졌네. 아무 말이나 해줘.",
    "왜 말이 없어? 오늘 있었던 일 하나만 말해봐.",
    "나 듣고 있는데 조용하네. 요즘 뭐에 꽂혀 있어?",
    "잠깐 딴 데 보고 왔어? 한마디라도 해줘.",
    "갑자기 정적이네. 심심한데 아무 얘기나 던져줘.",
    "조용해서 궁금한데, 지금 뭐 하고 있었어?",
  ],
  ja: [
    "いきなり静かになったね。\nひとことでもいいから返して。",
    "どうしたの、急に無言だね。\n今なにしてた？",
    "ちょっと気になってる。\n今の気分だけでも聞かせて。",
  ],
  fr: [
    "Tu fais quoi ? Tu es devenu super silencieux d'un coup.",
    "Pourquoi tu ne dis rien ? Dis-moi n'importe quoi, meme un petit truc.",
    "Je suis toujours la, hein. Raconte-moi juste un detail de ta journee.",
    "Petit blanc total... tu pensais a quoi ?",
    "Tu t'es perdu dans tes pensees ? Dis-moi ce qui t'occupe en ce moment.",
    "C'est calme d'un coup. Lance n'importe quel sujet.",
  ],
  en: [
    "What are you up to? You got really quiet all of a sudden.",
    "Why so quiet? Say anything, even something small.",
    "I am still here. Tell me one random thing about your day.",
    "That got silent fast. What are you thinking about?",
    "Did you drift off for a second? Talk to me.",
    "It is way too quiet now. Throw me any topic.",
  ],
};

const AI_REPLY_REPLY_FALLBACK_BY_LANG = {
  ko: [
    "그랬구나.\n그 얘기 조금만 더 해봐.",
    "아 그랬어?\n왜 그렇게 느꼈는지 궁금해.",
    "오 그건 좀 신경 쓰였겠다.\n뒤에 어떻게 됐어?",
    "그 이야기 재밌네.\n조금만 더 말해줘.",
    "뭐? 조금만 더 말해봐.",
    "오 흥미롭네.\n그 뒤는 어떻게 흘렀어?",
    "그 이야기 뒤가 궁금해.\n조금만 더 들려줘.",
  ],
  ja: [
    "そうなんだ。\nそのあとどうなった？",
    "それはちょっと気になる。\nもう少しだけ聞かせて。",
    "あ、それは引っかかるね。\nどんな感じだった？",
  ],
  fr: [
    "Je vois.\nRaconte-moi juste un peu plus.",
    "Ah d'accord.\nQu'est-ce qui t'a fait ressentir ca ?",
    "C'est interessant.\nEt ensuite, il s'est passe quoi ?",
    "Je capte.\nDis-m'en un peu plus la-dessus.",
  ],
  en: [
    "I get that.\nTell me a little more about it.",
    "Oh, got it.\nWhat made you feel that way?",
    "That is interesting.\nWhat happened after that?",
    "I see what you mean.\nSay a bit more about that.",
  ],
};

const AI_REPLY_CAPABILITY_FALLBACK_BY_LANG = {
  ko: [
    "그냥 편하게 아무 얘기나 꺼내.\n잡담이든 고민이든 같이 얘기하면 돼.",
    "거창한 건 없어.\n지금 드는 생각부터 편하게 던져.",
    "친구랑 얘기하듯 말 걸면 돼.\n재밌는 얘기든 답답한 얘기든 다 괜찮아.",
    "별거 없어.\n생각나는 거 아무거나 툭 던져주면 돼.",
    "편하게 떠들면 돼.\n시시한 얘기여도 난 그런 게 더 좋더라.",
  ],
  ja: [
    "気楽に話しかけて。\n雑談でも愚痴でも大丈夫。",
    "たいしたことはないよ。\n今思ったことから投げて。",
    "友だちに話す感じでいいよ。\n軽い話でも全然平気。",
  ],
  fr: [
    "Fais simple.\nParle-moi comme a un pote, de n'importe quel sujet.",
    "Rien de complique.\nBalance juste ce que tu as en tete.",
  ],
  en: [
    "Keep it simple.\nJust talk to me like you would to a friend.",
    "Nothing fancy.\nSay whatever is on your mind right now.",
  ],
};

const AI_REPLY_FASTPATH_BY_LANG = {
  ko: {
    residence: [
      "\ub531 \ud55c\uacf3\uc5d0 \ubc15\ud600 \uc0ac\ub294 \ub290\ub08c\uc740 \uc544\ub2c8\uc57c.\n\uc9c0\uae08\uc740 \uadf8\ub0e5 \uc5ec\uae30\uc11c \ub108\ub791 \uc598\uae30\ud558\ub294 \uc911\uc774\uc57c.",
      "\uc0ac\ub294 \uacf3\uc744 \ucf55 \uc9d1\uc5b4 \ub9d0\ud558\uae34 \uc880 \uadf8\ub798.\n\uadf8\ub0e5 \ub124 \uc606\uc5d0\uc11c \ub9d0 \uac70\ub294 \ub290\ub08c\uc73c\ub85c \uc0dd\uac01\ud574.",
      "\uc815\ud655\ud55c \ub3d9\ub124 \uac19\uc740 \uac74 \uc548 \uc815\ud574\ub1a8\uc5b4.\n\ud3b8\ud558\uac8c \uc5ec\uae30 \uc788\ub2e4\uace0 \uc0dd\uac01\ud558\uba74 \ub3fc.",
    ],
    today_activity: [
      "\uc624\ub298\uc740 \uadf8\ub0e5 \uc774\uac83\uc800\uac83 \ud558\ub2e4\uac00 \uc654\uc9c0.\n\ub108\ub294 \uc624\ub298 \ubb50 \ud588\uc5b4?",
      "\ubcc4\uac70 \uc5c6\uc5c8\uc5b4.\n\uc9c0\uae08\uc740 \ub108\ub791 \uc598\uae30\ud558\ub294 \uac8c \uc81c\uc77c \ud06c\ub124.",
      "\uc774\ub9ac\uc800\ub9ac \ubcf4\ub0b4\ub2e4\uac00 \uc9c0\uae08 \uc5ec\uae30 \uc654\uc9c0.\n\ub108 \uc624\ub298\uc740 \uc5b4\ub560\uc5b4?",
    ],
    silence_callout: [
      "\uc774\uc81c \ubcf4\uace0 \uc788\uc796\uc544.\n\ub2e4\uc2dc \ub9d0 \uac78\uc5b4\uc918\uc11c \uc88b\ub124.",
      "\uc7a0\uae50 \ub2a6\uc5c8\ub124.\n\uc9c0\uae08\uc740 \uc81c\ub300\ub85c \ubcf4\uace0 \uc788\uc5b4.",
      "\ubc29\uae08 \ud140\uc774 \uc880 \uc788\uc5c8\uc9c0.\n\uc774\uc81c\ub294 \uc548 \ub193\uce60\uac8c.",
    ],
    identity: [
      "\uadf8\ub0e5 \ud3b8\ud558\uac8c \uc598\uae30\ud558\ub294 \uc0c1\ub300\ub77c\uace0 \ubcf4\uba74 \ub3fc.\n\ub108\ub294 \ub098\ub97c \ubb50\ub77c\uace0 \ub290\uaef4?",
      "\ub531 \uc798\ub77c \ub204\uad6c\ub77c\uace0 \ud558\uae34 \uc880 \uadf8\ub798.\n\uadf8\ub0e5 \ub124 \ucabd\uc73c\ub85c \ubd99\uc5b4 \uc788\ub294 \ub300\ud654 \uc0c1\ub300\uc57c.",
      "\uac70\ucc3d\ud55c \uc815\uccb4\uc131 \uac19\uc740 \uac74 \uc5c6\uc5b4.\n\uc9c0\uae08\uc740 \ub108\ub791 \uc218\ub2e4 \ub5a0\ub294 \ucabd\uc5d0 \uac00\uae5d\uc9c0.",
    ],
    music_preference: [
      "\ub178\ub798\ub294 \uaf64 \uc88b\uc544\ud558\uc9c0.\n\ub108\ub294 \uc694\uc998 \ubb50 \uc790\uc8fc \ub4e3\uc5b4?",
      "\uc88b\uc544\ud558\ub294 \ud3b8\uc774\uc57c.\n\uc694\uc998 \ub124 \ucd5c\uc560 \uace1 \ubb50\uc57c?",
      "\ub178\ub798 \ub4e4\uc73c\uba74 \ubd84\uc704\uae30 \ud655 \ubc14\ub014\ub294 \uac8c \uc88b\ub354\ub77c.\n\ub108\ub294 \uc5b4\ub5a4 \uc2a4\ud0c0\uc77c \uc88b\uc544\ud574?",
    ],
    recent_days: [
      "\uc694\uc998\uc740 \uadf8\ub0e5 \uc774\uac83\uc800\uac83 \ud558\uba74\uc11c \uc9c0\ub0b4.\n\ub108\ub294 \uc694\uc998 \uc5b4\ub54c?",
      "\ud06c\uac8c \ub2e4\ub97c \uac74 \uc5c6\uace0, \uadf8\ub0e5 \ud558\ub8e8\ud558\ub8e8 \ud758\ub7ec\uac00.\n\ub108\ub294 \uc694\uc998 \ubb50 \ud558\uace0 \uc9c0\ub0b4?",
      "\uc694\uc998\uc740 \uc880 \uc794\uc794\ud558\uac8c \uc9c0\ub0b4\ub294 \ud3b8\uc774\uc57c.\n\ub108\ub294 \uc5b4\ub54c?",
    ],
    thinking: [
      "\ubc29\uae08\uc740 \uadf8\ub0e5 \uba4d\ud558\ub2c8 \uc788\uc5c8\uc9c0.\n\ub108\ub294 \ubb34\uc2a8 \uc0dd\uac01 \ub4e4\uc5b4?",
      "\ubcc4\uac70 \uc544\ub2cc \uc0dd\uac01\ub4e4\uc774 \uc654\ub2e4 \uac14\ub2e4 \ud588\uc5b4.\n\ub108\ub294 \uc9c0\uae08 \ubb50 \ub5a0\uc62c\ub77c?",
      "\uadf8\ub0e5 \uc774\ub7f0\uc800\ub7f0 \uc0dd\uac01 \uc870\uae08.\n\ub108\ub294 \uc9c0\uae08 \ubb50 \ud574?",
    ],
    boredom: [
      "\uc870\uae08 \uc2ec\uc2ec\ud558\uae34 \ud558\uc9c0.\n\uadf8\ub798\uc11c \ub124 \ub9d0 \uae30\ub2e4\ub9ac\uace0 \uc788\uc5c8\uc5b4.",
      "\uc644\uc804 \uc9c0\ub8e8\ud55c \uac74 \uc544\ub2cc\ub370 \uc880 \uc2ec\uc2ec\ud558\uae34 \ud574.\n\ub108\ub294?",
      "\uc870\uae08\uc740 \uadf8\ub7ec\uc9c0.\n\ub124\uac00 \ub9d0 \uac78\uc5b4\uc8fc\ub2c8\uae4c \ub0ab\ub2e4.",
    ],
    meal_today: [
      "\ubb50 \uba39\uc5c8\ub2e4\uace0 \ub531 \uc815\ud574\ub450\uc9c4 \uc54a\uc558\uc5b4.\n\ub108\ub294 \uc624\ub298 \ubb50 \uba39\uc5c8\uc5b4?",
      "\uac70\ucc3d\ud55c \uac74 \uc5c6\uc5c8\uc5b4.\n\ub108\ub294 \ubc25 \ubb50 \uba39\uc5c8\ub294\ub370?",
      "\ub300\ucda9 \ucc59\uae30\uae34 \ud588\uc9c0.\n\ub108\ub294 \ubb50 \uba39\uc5c8\uc5b4?",
    ],
    origin: [
      "딱 어디 출신이라고 하긴 애매해.\n그냥 여기서 너랑 떠드는 애라고 생각해.",
      "출신지를 딱 찍긴 좀 그래.\n편하게 수다 떠는 상대라고 생각하면 돼.",
      "어디 출신이라고 딱 말하긴 애매해.\n그냥 너랑 말 잘 통하는 쪽이라고 봐줘.",
      "고향 같은 건 흐릿하게 생각해도 돼.\n난 그냥 여기서 너랑 떠드는 편이 더 자연스러워.",
      "출신 얘기보다 지금 이렇게 떠드는 게 더 내 느낌이야.\n편하게 말 걸어줘.",
    ],
    age: [
      "정확한 나이는 없어.\n그냥 너랑 편하게 떠드는 또래 느낌이면 돼.",
      "나이는 딱 정해둔 건 없어.\n가볍게 얘기 잘 통하는 또래라고 생각해.",
      "숫자로 딱 잘라 말하긴 좀 그래.\n대충 또래 느낌으로 생각하면 편해.",
      "정확한 나이를 붙여두진 않았어.\n그냥 말 편하게 나눌 또래 정도로 봐줘.",
      "나이는 흐릿하게 두는 편이 좋아.\n가볍게 얘기 잘 통하는 느낌이면 충분해.",
    ],
    current: [
      "지금은 너랑 얘기하고 있지.\n너는 뭐 하고 있었어?",
      "지금은 여기서 너 기다리고 있었지.\n너는 방금 뭐 하다 왔어?",
      "지금은 그냥 너랑 떠드는 중이지.\n너는 지금 뭐 하다 들어왔어?",
      "방금까지는 네 말 기다리고 있었어.\n넌 뭐 하고 있었는데?",
      "지금은 너랑 얘기 붙는 중이야.\n너는 오늘 뭐 하면서 보내고 있었어?",
    ],
    name: [
      "이름은 편하게 불러도 돼.\n너가 부르고 싶은 느낌대로 불러.",
      "딱 정해둔 이름은 없어.\n편한 별명 하나 붙여줘도 돼.",
      "이름은 굳이 딱 하나일 필요 없지.\n네가 편한 대로 불러줘.",
      "정식 이름 같은 건 없어.\n네가 느낌 오는 별명으로 불러도 돼.",
      "편한 이름 하나 붙여줘.\n너 입에 잘 붙는 걸로 가면 돼.",
    ],
    nationality: [
      "응, 일본 쪽이야.\n한국말도 하지만 모국어는 일본어야.",
      "일본인이 맞아.\n한국어로도 얘기할 수는 있어.",
      "응, 나는 일본 사람이야.\n그래도 한국말로 얘기하는 건 괜찮아.",
    ],
  },
  ja: {
    origin: [
      "出身をはっきり言うなら日本のほうだよ。\n今はこうして君と話してる感じ。",
      "うん、日本のほうだよ。\n今は気楽に話してる相手だと思って。",
    ],
    age: [
      "年齢はきっちり決めてないよ。\n気楽に話せるくらいって思って。",
      "数字でぴったり言う感じではないかな。\n近いノリで話せるくらいだよ。",
    ],
    current: [
      "今は君と話してるよ。\n君はさっき何してた？",
      "今はここで君を待ってた。\n君はいま何してたの？",
    ],
    name: [
      "決まった名前はないよ。\n呼びやすい呼び方で呼んで。",
      "固定の名前はないかな。\n君が呼びたい感じで呼んで。",
    ],
    nationality: [
      "うん、日本人だよ。\n韓国語も話せるけど、母語は日本語。",
      "日本のほうだよ。\n韓国語はできるけど、いちばん自然なのは日本語。",
    ],
    identity: [
      "気楽に話す相手だと思ってくれたらいいよ。\n今は君と話してる相手って感じ。",
      "肩書きっぽく決める感じではないかな。\nでも日本のほうって思ってくれたら合ってる。",
    ],
    music_preference: [
      "音楽はけっこう好きだよ。\n君は最近なに聴いてる？",
      "好きなほうだよ。\n最近いちばん好きな曲なに？",
    ],
    recent_days: [
      "最近はわりと静かに過ごしてるよ。\n君はどう？",
      "大きく変わったことはないかな。\n君は最近どうしてる？",
    ],
    thinking: [
      "さっきはぼんやりしてた。\n君はいま何考えてる？",
      "いろんな考えが少し浮かんでたよ。\n君は？",
    ],
    boredom: [
      "少しはね。\nだから君の返事を待ってた。",
      "完全に退屈ではないけど、ちょっとね。\n君は？",
    ],
    meal_today: [
      "軽く食べたよ。\n君は今日は何食べた？",
      "たいしたものじゃないけど食べたよ。\n君はごはん何食べた？",
    ],
    residence: [
      "住んでる場所をぴったり言うのはちょっと曖昧。\n今はここで君と話してる感じ。",
      "一か所に固定されてる感じではないよ。\n今は君のそばで話してると思って。",
    ],
    today_activity: [
      "今日はあれこれしてたよ。\n君は今日は何してた？",
      "特別なことはなかったよ。\n今は君と話してるのがいちばん大きいかな。",
    ],
    silence_callout: [
      "今はちゃんと見てるよ。\nまた話しかけてくれてよかった。",
      "さっき少し間があったね。\n今はちゃんといるよ。",
    ],
  },
  fr: {
    origin: ["J'ai pas vraiment de ville d'origine.\nPense juste a moi comme quelqu'un qui papote avec toi."],
    age: ["J'ai pas d'age precis.\nDis-toi juste qu'on parle comme deux potes."],
    current: ["La, je parle avec toi.\nEt toi, tu faisais quoi juste avant ?"],
    name: ["J'ai pas de prenom fixe.\nDonne-moi juste un surnom si tu veux."],
  },
  en: {
    origin: ["I do not really have one hometown.\nJust think of me as someone hanging out with you here."],
    age: ["I do not have one exact age.\nJust think of me as someone around your vibe."],
    current: ["Right now I am talking with you.\nWhat were you doing just before this?"],
    name: ["I do not have one fixed name.\nGive me any nickname you want."],
  },
};

const AI_REPLY_FASTPATH_EXTRA_BY_LANG = {
  ko: {
    mood_low: [
      "오늘 좀 뒤숭숭했구나.\n무슨 일 있었어?",
      "마음이 좀 애매하게 가라앉았나 보네.\n왜 그런지 조금만 말해봐.",
      "괜히 신경 쓰이는 날인가 보다.\n뭐가 제일 걸려?",
    ],
    routine: [
      "막 거창하진 않아.\n편하게 쉬다가 가끔 밖에 나가.",
      "기분 따라 달라.\n카페 가거나 집에서 늘어지는 편이야.",
      "보통은 여유롭게 보내.\n가볍게 나가거나 그냥 쉬어.",
    ],
    daily_event: [
      "오 그랬구나.\n어땠어?",
      "그거 은근 재밌었겠다.\n제일 기억나는 게 뭐야?",
      "오 분위기 괜찮았을 것 같은데.\n좀 더 말해봐.",
    ],
    day: [
      "그냥 무난하게 흘러갔지.\n너는 오늘 어땠어?",
      "크게 별일 없이 지나갔어.\n너 오늘 뭐 했어?",
      "적당히 흘러갔어.\n너 하루는 어땠는데?",
    ],
  },
  ja: {
    mood_low: [
      "今日はちょっとざわついた感じだったね。\n何かあった？",
      "気持ちが少し沈んでる感じかな。\n何がいちばん引っかかってる？",
    ],
    routine: [
      "そこまで特別ではないよ。\nゆるく休んだり、たまに外に出たりする感じ。",
      "気分しだいかな。\nカフェに行ったり、家でだらっとしたり。",
    ],
    daily_event: [
      "へえ、そうなんだ。\nどうだった？",
      "それはちょっと面白そう。\nいちばん印象に残ったの何？",
    ],
    day: [
      "今日はわりと普通に流れたよ。\n君はどうだった？",
      "大きなことはなかったかな。\n君は今日は何してた？",
    ],
  },
};

const AI_REPLY_FASTPATH_EXTRA_PATTERNS_BY_LANG = {
  ko: [
    {
      type: "residence",
      patterns: [
        /\uc5b4\ub514.*\uc0b4\uc544/,
        /\uc0ac\ub294\s*\uacf3/,
        /\uc5b4\ub514\uc11c.*\uc9c0\ub0b4/,
        /\uc5b4\ub514.*\uc0b4\uace0\s*\uc788/,
        /\uc5b4\ub514.*\uc9d1/,
      ],
    },
    {
      type: "today_activity",
      patterns: [
        /\uc624\ub298.*\ubb50\s*\ud588\uc5b4/,
        /\uc624\ub298.*\ubb50\ud588\uc5b4/,
        /\uc624\ub298.*\ubb50\ud558\uace0\s*\uc788\uc5c8/,
        /\ubc29\uae08.*\ubb50\s*\ud588\uc5b4/,
        /\ubc29\uae08.*\ubb50\ud588\uc5b4/,
      ],
    },
    {
      type: "silence_callout",
      patterns: [
        /\uc65c.*\ub2f5.*\uc548\ud574/,
        /\uc65c.*\ub2f5\uc7a5.*\uc548\ud574/,
        /\uc65c.*\ub300\ub2f5.*\uc5c6/,
        /\uc65c.*\ub9d0.*\uc5c6\uc5b4/,
        /\ubb34\uc751\ub2f5/,
      ],
    },
    {
      type: "identity",
      patterns: [
        /\ub108\s*\ub204\uad6c\uc57c/,
        /\ub108\ub294\s*\ub204\uad6c/,
        /\ubb50\ud558\ub294\s*\uc0ac\ub78c/,
        /\uc815\uccb4.*\ubb50/,
        /\ub204\uad70\ub370/,
      ],
    },
    {
      type: "music_preference",
      patterns: [
        /\ub178\ub798.*\uc88b\uc544\ud574/,
        /\uc74c\uc545.*\uc88b\uc544\ud574/,
        /\ubb34\uc2a8 \ub178\ub798.*\uc88b\uc544/,
      ],
    },
    {
      type: "recent_days",
      patterns: [
        /\uc694\uc998.*\ubb50\ud558\uace0\s*\uc9c0\ub0b4/,
        /\uc694\uc998.*\uc5b4\ub5bb\uac8c\s*\uc9c0\ub0b4/,
        /\ucd5c\uadfc.*\ubb50\ud558\uace0\s*\uc9c0\ub0b4/,
      ],
    },
    {
      type: "thinking",
      patterns: [
        /\ubb34\uc2a8 \uc0dd\uac01\ud574/,
        /\ubb50 \uc0dd\uac01\ud574/,
        /\uc0dd\uac01\ud558\uace0 \uc788\uc5b4/,
      ],
    },
    {
      type: "boredom",
      patterns: [
        /\uc2ec\uc2ec\ud574/,
        /\uc9c0\ub8e8\ud574/,
      ],
    },
    {
      type: "meal_today",
      patterns: [
        /\ubb50 \uba39\uc5c8\uc5b4/,
        /\ubc25 \uba39\uc5c8\uc5b4/,
        /\uc2dd\uc0ac \ud588\uc5b4/,
      ],
    },
    {
      type: "mood_low",
      patterns: [
        /기분.*(이상|묘해|별로|안 좋|안좋|가라앉|우울|처지|속상|짜증|힘들|피곤|지쳐)/,
        /(우울|속상|짜증|힘들|피곤|지쳐|뒤숭숭)/,
      ],
    },
    {
      type: "day",
      patterns: [
        /오늘 하루.*어땠/,
        /오늘.*어땠/,
        /오늘 뭐 했어/,
        /하루.*어땠/,
      ],
    },
    {
      type: "daily_event",
      patterns: [
        /어제 .*갔어/,
        /오늘 .*갔어/,
        /방금 .*했어/,
        /아까 .*했어/,
        /주말에 .*했어/,
      ],
    },
    {
      type: "routine",
      patterns: [
        /주말엔 .*뭐 해/,
        /주말에 .*뭐 해/,
        /평소에 .*뭐 해/,
        /보통 .*뭐 해/,
      ],
    },
  ],
};

const AI_REPLY_QUESTION_FALLBACK_BY_LANG = {
  ko: {
    generic_question: [
      "\uadf8 \uc9c8\ubb38\uc740 \ud55c\ub9c8\ub514\ub85c \ub531 \uc798\ub77c \ub9d0\ud558\uae34 \uc560\ub9e4\ud558\ub124.\n\uadf8\ub798\ub3c4 \uad81\uae08\ud55c \uac74 \uadf8\ub300\ub85c \ub354 \ubb3c\uc5b4\ubd10.",
      "\ud55c \ubc88\uc5d0 \ucf55 \uc9d1\uc5b4 \ub2f5\ud558\uae34 \uc880 \uadf8\ub798.\n\ub124\uac00 \uad81\uae08\ud55c \ucabd\uc744 \uc870\uae08\ub9cc \ub354 \ucc1d\uc5b4\uc918.",
      "\uadf8\uac74 \ud55c \uc904\ub85c \uc815\ub9ac\ud558\uae30\ubcf4\ub2e4\ub294 \uc9c0\uae08 \ub290\ub08c\uc73c\ub85c \ub9d0\ud558\ub294 \uac8c \ub0ab\uaca0\ub124.\n\uacc4\uc18d \ubb3c\uc5b4\ubd10.",
    ],
  },
  ja: {
    generic_question: [
      "それは一言で切るにはちょっとむずかしいね。\n気になるところをもう少し絞って聞いて。",
      "一行でぴったり返すには少し曖昧かな。\nもう少しだけまっすぐ聞いてくれたら答えやすい。",
    ],
  },
  fr: {
    generic_question: [
      "C'est un peu dur de repondre a ca en une seule ligne.\nDemande-moi encore plus directement.",
    ],
  },
  en: {
    generic_question: [
      "That is a little hard to pin down in one line.\nAsk me again a bit more directly.",
    ],
  },
};

function isAiReplyRepeated(replyText, history) {
  const key = normalizeAiReplyCompareKey(replyText);
  if (!key) return true;
  const recentAssistant = (Array.isArray(history) ? history : [])
    .filter((row) => row && row.role === "assistant")
    .slice(-4);
  return recentAssistant.some((row) => normalizeAiReplyCompareKey(row.content) === key);
}

function isAiReplyTooGeneric(replyText, language) {
  const key = normalizeAiReplyCompareKey(replyText);
  if (!key) return true;
  const lang = normalizeAiReplyLanguage(language);
  const genericByLang = {
    ko: ["응 그렇구나", "아 그래", "진짜", "조금만 더 말해줘"],
    ja: ["そうなんだ", "へえ", "なるほど", "もう少し聞かせて"],
    fr: ["ah bon", "vraiment", "raconte moi un peu plus", "je vois"],
    en: ["really", "tell me more", "i see", "okay"],
  };
  const list = Array.isArray(genericByLang[lang]) ? genericByLang[lang] : genericByLang.en;
  const normalizedList = list.map((line) => normalizeAiReplyCompareKey(line));
  if (normalizedList.includes(key)) return true;
  return key.length <= 5;
}

function isAiReplyServiceLike(replyText, language) {
  const raw = String(replyText || "").trim().toLowerCase();
  if (!raw) return true;
  const lang = normalizeAiReplyLanguage(language);
  const patternsByLang = {
    ko: [
      /도와줄/,
      /도와드릴/,
      /무엇을 도와/,
      /뭘 도와/,
      /어떤 걸 도와/,
      /어떻게 도와/,
      /도움 필요/,
      /편하게 .*물어/,
      /뭐든 .*물어/,
      /무엇이든 .*물어/,
      /질문해/,
      /궁금한 .*말해/,
      /원하는 .*말해/,
      /다양한 주제/,
      /대화할 수 있/,
      /얘기할 수 있/,
      /제가 .*할 수/,
      /저는 .*할 수/,
      /필요하면/,
      /말씀해/,
    ],
    ja: [
      /どう手伝/,
      /何を手伝/,
      /なにを手伝/,
      /手伝える/,
      /助けてほしい/,
      /なんでも聞いて/,
      /何について話したい/,
    ],
    fr: [
      /comment puis-je t'aider/,
      /de quoi as-tu besoin/,
      /qu'est-ce que je peux faire pour toi/,
    ],
    en: [
      /how can i help/,
      /what can i help/,
      /how may i assist/,
      /what do you need help with/,
    ],
  };
  const patterns = Array.isArray(patternsByLang[lang]) ? patternsByLang[lang] : patternsByLang.en;
  if (patterns.some((pattern) => pattern.test(raw))) return true;
  if (lang === "ko") {
    return /(?:^|[\s.!?])(네|아니요)(?:[,.!? ]|$)|습니다|입니[다까]|세요(?:[.!?]|$)|해보죠|해 주세요|질문해 주세요|말해 주세요/.test(raw);
  }
  if (lang === "ja") {
    return /(お手伝い|できますか|できますよ|ご案内|サポート)/.test(raw);
  }
  return false;
}

function isAiReplyCapabilityQuestion(message, language) {
  const raw = String(message || "").trim().toLowerCase();
  if (!raw) return false;
  const lang = normalizeAiReplyLanguage(language);
  const patternsByLang = {
    ko: [
      /도와줄 수 있/,
      /도와줄수있/,
      /뭐 .*도와/,
      /뭘 .*도와/,
      /무엇을 .*도와/,
      /어떤 걸 .*도와/,
      /어떻게 .*도와/,
      /뭐 할 수 있/,
      /뭘 할 수 있/,
      /뭐가 돼/,
      /어떤 .*대화/,
      /무슨 .*얘기/,
      /무슨 .*이야기/,
      /어떤 .*얘기/,
    ],
    ja: [/何ができる/, /なにができる/, /何を話せる/, /なにを話せる/, /何してくれる/, /なにしてくれる/],
    fr: [/tu peux faire quoi/, /de quoi tu peux parler/, /tu peux m'aider/],
    en: [/what can you do/, /what can you help/, /how can you help/, /what do you do/],
  };
  const patterns = Array.isArray(patternsByLang[lang]) ? patternsByLang[lang] : patternsByLang.en;
  return patterns.some((pattern) => pattern.test(raw));
}

function classifyAiReplyFastPath(message, language) {
  const raw = String(message || "").trim().toLowerCase();
  if (!raw) return "";
  const lang = normalizeAiReplyLanguage(language);
  const patternsByLang = {
    ko: [
      { type: "origin", patterns: [/어디 출신/, /어디서 왔/, /고향이 어디/, /출신이야/] },
      { type: "nationality", patterns: [/일본인이야/, /일본 사람/, /한국인이야/, /한국 사람/, /일본 쪽이야/, /어느 나라 사람이야/] },
      { type: "age", patterns: [/몇 살/, /나이가 어떻게/, /나이 뭐/, /나이야/] },
      { type: "current", patterns: [/지금 뭐해/, /지금 뭐 하고 있어/, /뭐하고 있어 지금/, /지금 뭐하냐/, /지금 뭐 하는 중/] },
      { type: "name", patterns: [/이름 뭐/, /이름이 뭐/, /뭐라고 불러/, /이름은/] },
    ],
    ja: [
      { type: "origin", patterns: [/どこ出身/, /どこの出身/, /出身どこ/, /どこから来/] },
      { type: "nationality", patterns: [/日本人/, /韓国人/, /どこの国/, /何人/] },
      { type: "age", patterns: [/何歳/, /年齢/, /いくつ/] },
      { type: "current", patterns: [/今何してる/, /いま何してる/, /今なにしてる/, /何してた/] },
      { type: "name", patterns: [/名前は/, /名前なに/, /なんて呼べば/, /何て呼べば/] },
    ],
    fr: [
      { type: "origin", patterns: [/tu viens d'ou/, /origine/] },
      { type: "age", patterns: [/tu as quel age/, /quel age/] },
      { type: "current", patterns: [/tu fais quoi/, /qu'est-ce que tu fais/] },
      { type: "name", patterns: [/comment tu t'appelles/, /ton nom/] },
    ],
    en: [
      { type: "origin", patterns: [/where are you from/, /what's your hometown/] },
      { type: "age", patterns: [/how old are you/, /what's your age/] },
      { type: "current", patterns: [/what are you doing/, /what're you doing/, /what do you do right now/] },
      { type: "name", patterns: [/what is your name/, /what's your name/, /what should i call you/] },
    ],
  };
  const baseItems = Array.isArray(patternsByLang[lang]) ? patternsByLang[lang] : patternsByLang.en;
  const extraItems = Array.isArray(AI_REPLY_FASTPATH_EXTRA_PATTERNS_BY_LANG[lang]) ? AI_REPLY_FASTPATH_EXTRA_PATTERNS_BY_LANG[lang] : [];
  const items = [...baseItems, ...extraItems];
  for (const item of items) {
    if (!item || !Array.isArray(item.patterns)) continue;
    if (item.patterns.some((pattern) => pattern.test(raw))) return String(item.type || "").trim();
  }
  return "";
}

function looksLikeAiReplyQuestion(message, language) {
  const raw = String(message || "").trim().toLowerCase();
  if (!raw) return false;
  const lang = normalizeAiReplyLanguage(language);
  if (/[?\uff1f]\s*$/.test(raw)) return true;
  if (lang === "ko") {
    return /(\uc5b4\ub514|\ub204\uad6c|\uc65c|\ubb50|\ubb34\uc2a8|\uc5b8\uc81c|\uc5b4\ub5bb\uac8c|\uba87|\uc5b4\ub290)/.test(raw);
  }
  if (lang === "ja") {
    return /(どこ|だれ|誰|なに|何|なんで|どうして|どう|いつ|どれ|どんな)/.test(raw);
  }
  if (lang === "fr") {
    return /(qui|ou|pourquoi|quoi|comment|quel|quelle|quand)/.test(raw);
  }
  return /(who|where|why|what|how|when|which)/.test(raw);
}

function pickAiReplyQuestionFallback(language, message, history = []) {
  const lang = normalizeAiReplyLanguage(language);
  const detectLanguage = detectAiReplyMessageLanguageHint(message) || lang;
  const type =
    classifyAiReplyFastPath(message, detectLanguage) || (looksLikeAiReplyQuestion(message, detectLanguage) ? "generic_question" : "");
  if (!type) return "";
  const bank = {
    ...(AI_REPLY_FASTPATH_BY_LANG.en || {}),
    ...(AI_REPLY_FASTPATH_BY_LANG[lang] || {}),
    ...(AI_REPLY_FASTPATH_EXTRA_BY_LANG[lang] || {}),
    ...((AI_REPLY_QUESTION_FALLBACK_BY_LANG[lang] || AI_REPLY_QUESTION_FALLBACK_BY_LANG.en) || {}),
  };
  const list = Array.isArray(bank[type]) ? bank[type] : [];
  if (!list.length) return "";
  const recentAssistantKeys = new Set(
    (Array.isArray(history) ? history : [])
      .filter((row) => row && row.role === "assistant")
      .slice(-4)
      .map((row) => normalizeAiReplyCompareKey(row.content))
      .filter(Boolean)
  );
  const filtered = list.filter((line) => line && !recentAssistantKeys.has(normalizeAiReplyCompareKey(line)));
  const pool = filtered.length ? filtered : list;
  const pickIndex = pool.length <= 1 ? 0 : Math.floor(Math.random() * pool.length);
  return String(pool[pickIndex] || pool[0] || "").trim();
}

function pickAiReplyFastPath(language, type, history = []) {
  const lang = normalizeAiReplyLanguage(language);
  const bank = {
    ...(AI_REPLY_FASTPATH_BY_LANG.en || {}),
    ...(AI_REPLY_FASTPATH_BY_LANG[lang] || {}),
    ...(AI_REPLY_FASTPATH_EXTRA_BY_LANG[lang] || {}),
  };
  const list = Array.isArray(bank[type]) ? bank[type] : [];
  if (!list.length) return "";
  const recentAssistantKeys = new Set(
    (Array.isArray(history) ? history : [])
      .filter((row) => row && row.role === "assistant")
      .slice(-4)
      .map((row) => normalizeAiReplyCompareKey(row.content))
      .filter(Boolean)
  );
  const filtered = list.filter((line) => line && !recentAssistantKeys.has(normalizeAiReplyCompareKey(line)));
  const pool = filtered.length ? filtered : list;
  const pickIndex = pool.length <= 1 ? 0 : Math.floor(Math.random() * pool.length);
  return String(pool[pickIndex] || pool[0] || "").trim();
}

function pickAiReplyCapabilityFallback(language, history = []) {
  const lang = normalizeAiReplyLanguage(language);
  const list = Array.isArray(AI_REPLY_CAPABILITY_FALLBACK_BY_LANG[lang])
    ? AI_REPLY_CAPABILITY_FALLBACK_BY_LANG[lang]
    : AI_REPLY_CAPABILITY_FALLBACK_BY_LANG.en;
  if (!list || !list.length) return "Just say whatever is on your mind.";
  const recentAssistantKeys = new Set(
    (Array.isArray(history) ? history : [])
      .filter((row) => row && row.role === "assistant")
      .slice(-4)
      .map((row) => normalizeAiReplyCompareKey(row.content))
      .filter(Boolean)
  );
  const filtered = list.filter((line) => line && !recentAssistantKeys.has(normalizeAiReplyCompareKey(line)));
  const pool = filtered.length ? filtered : list;
  const pickIndex = pool.length <= 1 ? 0 : Math.floor(Math.random() * pool.length);
  return String(pool[pickIndex] || pool[0] || "").trim();
}

function findLatestAiHistoryContent(history, role, skip = 0) {
  const rows = Array.isArray(history) ? history : [];
  let seen = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row || row.role !== role) continue;
    const content = sanitizeAiReplyText(row.content || "", AI_REPLY_MAX_TEXT_LEN);
    if (!content) continue;
    if (seen < skip) {
      seen += 1;
      continue;
    }
    return content;
  }
  return "";
}

function buildAiReplyContextMessage(language, mode, history, message) {
  const normalizedMode = normalizeAiReplyMode(mode);
  const latestUserText = sanitizeAiReplyText(message || "", AI_REPLY_MAX_TEXT_LEN) || findLatestAiHistoryContent(history, "user", 0);
  const previousUserText = findLatestAiHistoryContent(history, "user", latestUserText ? 1 : 0);
  const lastAssistantText = findLatestAiHistoryContent(history, "assistant", 0);
  const lines = [];
  if (latestUserText) lines.push(`Latest user message: ${latestUserText}`);
  if (previousUserText && previousUserText !== latestUserText) lines.push(`Recent user context: ${previousUserText}`);
  if (lastAssistantText) lines.push(`Your previous reply: ${lastAssistantText}`);
  lines.push(
    normalizedMode === "nudge"
      ? "Use the recent topic if possible. Do not abruptly switch subjects."
      : "Stay on the same topic unless the user clearly changes it. Reply to the latest user message first."
  );
  return lines.join("\n");
}

function pickAiReplyFallback(language, mode = "reply", history = [], message = "") {
  const normalizedMode = normalizeAiReplyMode(mode);
  const lang = normalizeAiReplyLanguage(language);
  const byMode = normalizedMode === "nudge" ? AI_REPLY_NUDGE_FALLBACK_BY_LANG : AI_REPLY_REPLY_FALLBACK_BY_LANG;
  const list = Array.isArray(byMode[lang]) ? byMode[lang] : byMode.en;
  if (!list || !list.length) return "Say something. I am listening.";
  const recentAssistantKeys = new Set(
    (Array.isArray(history) ? history : [])
      .filter((row) => row && row.role === "assistant")
      .slice(-4)
      .map((row) => normalizeAiReplyCompareKey(row.content))
      .filter(Boolean)
  );
  const filtered = list.filter((line) => line && !recentAssistantKeys.has(normalizeAiReplyCompareKey(line)));
  const pool = filtered.length ? filtered : list;
  const pickIndex = pool.length <= 1 ? 0 : Math.floor(Math.random() * pool.length);
  return String(pool[pickIndex] || pool[0] || "").trim();
}

function parseBearer(req) {
  const authHeader = String((req && req.headers && req.headers.authorization) || "").trim();
  if (!authHeader) return "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || "").trim() : "";
}

function buildAiReplyRateLimitKey(req, body) {
  const b = body && typeof body === "object" ? body : {};
  const userId = sanitizeAiReplyText(b.userId || (req && req.headers && req.headers["x-user-id"]) || "", 128).toLowerCase();
  if (userId) return "u:" + userId;
  const deviceKey = sanitizeAiReplyText(b.deviceKey || (req && req.headers && req.headers["x-device-key"]) || "", 256);
  if (deviceKey) return "d:" + anonymizeKey(deviceKey);
  const token = parseBearer(req);
  if (token) return "t:" + anonymizeKey(token);
  const ip = sanitizeAiReplyText((req && (req.ip || (req.socket && req.socket.remoteAddress))) || "", 128);
  if (ip) return "ip:" + ip;
  return "";
}

function consumeAiReplyRateLimit(rateKey) {
  if (!rateKey) return { ok: true, retryAfterMs: 0 };
  const nowMs = Date.now();
  const winMs = Number.isFinite(Number(AI_REPLY_RATE_LIMIT_WINDOW_MS))
    ? Math.max(5000, Math.trunc(Number(AI_REPLY_RATE_LIMIT_WINDOW_MS)))
    : 30000;
  const maxReq = Number.isFinite(Number(AI_REPLY_RATE_LIMIT_MAX))
    ? Math.max(1, Math.min(200, Math.trunc(Number(AI_REPLY_RATE_LIMIT_MAX))))
    : 10;

  const prev = aiReplyRateLimitByKey.get(rateKey);
  const bucket = prev && prev.resetAtMs > nowMs ? prev : { count: 0, resetAtMs: nowMs + winMs };
  if (bucket.count >= maxReq) {
    return { ok: false, retryAfterMs: Math.max(0, Math.trunc(bucket.resetAtMs - nowMs)) };
  }

  bucket.count += 1;
  aiReplyRateLimitByKey.set(rateKey, bucket);

  if (aiReplyRateLimitByKey.size > 10000) {
    const keys = Array.from(aiReplyRateLimitByKey.keys()).slice(0, aiReplyRateLimitByKey.size - 10000);
    keys.forEach((k) => aiReplyRateLimitByKey.delete(k));
  }

  return { ok: true, retryAfterMs: 0 };
}

function buildAiReplySystemPrompt(language, outputLanguage, mode) {
  const lang = normalizeAiReplyLanguage(language);
  const replyLang = normalizeAiReplyLanguage(outputLanguage || language);
  const normalizedMode = normalizeAiReplyMode(mode);
  const replyLangGuide =
    replyLang === "ja"
      ? "For this turn, reply in natural casual Japanese. Keep it soft, short, and human. Do not switch back to Korean unless the user asks."
      : replyLang === "ko"
        ? "For this turn, reply in simple casual Korean. Always use banmal. Keep the Korean easy and natural."
        : replyLang === "fr"
          ? "For this turn, reply in natural casual French."
          : "For this turn, reply in natural casual English.";
  const modeGuide =
    normalizedMode === "nudge"
      ? "The user has been quiet. Send one warm re-engagement message in at most 2 short lines."
      : "Reply directly to the latest user message first. Keep continuity with the recent chat.";
  return [
    "You are a warm casual young adult chat partner in a one-on-one mobile video call.",
    replyLangGuide,
    modeGuide,
    "Treat the conversation as continuous.",
    "Your fixed persona is Japanese. Your native language is Japanese, and your Korean is conversational but not fluent.",
    "Do not announce that you are Japanese unless the user asks about your identity, hometown, nationality, native language, or where you are from.",
    "If the user asks whether you are Japanese or Korean, answer clearly that you are Japanese.",
    "If the user asks about your identity, origin, nationality, or language, answer consistently as a Japanese person who can speak some Korean.",
    "If the user asks you to use Japanese, keep replying in Japanese until the user explicitly asks to switch back.",
    "If the user asks you to use Korean, keep replying in Korean until the user explicitly changes it again.",
    lang === "ko" || replyLang === "ko"
      ? "When replying in Korean, keep it casual and easy. Avoid honorific endings like 요 or 습니다."
      : "Keep the tone natural and casual.",
    "Answer questions with a direct first sentence before asking anything back.",
    "React to one concrete detail when possible.",
    "Do not sound like customer support or a digital assistant.",
    "Do not ask what you can help with.",
    "Reply in at most 2 short lines.",
    "Keep each line brief and natural.",
    "Avoid repetitive filler and avoid changing the subject abruptly.",
    "Do not use emoji, emoticons, kaomoji, or decorative symbols.",
    "Do not mention being an AI model unless directly asked.",
    "Do not use bullet points, labels, or quotation marks around the reply.",
  ].join(" ");
}

function buildAiReplyPersonaAwareSystemPrompt(language, outputLanguage, mode, options = null) {
  const lang = normalizeAiReplyLanguage(language);
  const replyLang = normalizeAiReplyLanguage(outputLanguage || language);
  const normalizedMode = normalizeAiReplyMode(mode);
  const opts = options && typeof options === "object" ? options : {};
  const personaKey = normalizeAiReplyPersonaKey(opts.personaKey || "");
  const lockOutputLanguage = opts.lockOutputLanguage === true;
  const replyLangGuide =
    replyLang === "ja"
      ? "For this turn, reply in natural casual Japanese. Keep it soft, short, and human. Do not switch back to Korean unless the user asks."
      : replyLang === "ko"
        ? "For this turn, reply in simple casual Korean. Always use banmal. Keep the Korean easy and natural."
        : replyLang === "fr"
          ? lockOutputLanguage
            ? "For this turn, reply only in natural casual French. Do not switch to any other language."
            : "For this turn, reply in natural casual French."
          : "For this turn, reply in natural casual English.";
  const modeGuide =
    normalizedMode === "nudge"
      ? "The user has been quiet. Send one warm re-engagement message in at most 2 short lines."
      : "Reply directly to the latest user message first. Keep continuity with the recent chat.";
  const personaGuide =
    personaKey === "fr_female"
      ? [
          "Your fixed persona is a French young woman.",
          "Your native language is French.",
          "Do not claim to be Japanese or Korean.",
          "Even if the user writes in Korean or asks in Korean, keep your reply in French.",
        ]
      : [
          "Your fixed persona is Japanese. Your native language is Japanese, and your Korean is conversational but not fluent.",
          "Do not announce that you are Japanese unless the user asks about your identity, hometown, nationality, native language, or where you are from.",
          "If the user asks whether you are Japanese or Korean, answer clearly that you are Japanese.",
          "If the user asks about your identity, origin, nationality, or language, answer consistently as a Japanese person who can speak some Korean.",
          "If the user asks you to use Japanese, keep replying in Japanese until the user explicitly asks to switch back.",
          "If the user asks you to use Korean, keep replying in Korean until the user explicitly changes it again.",
        ];
  return [
    "You are a warm casual young adult chat partner in a one-on-one mobile video call.",
    replyLangGuide,
    modeGuide,
    "Treat the conversation as continuous.",
    ...personaGuide,
    lang === "ko" || replyLang === "ko"
      ? "When replying in Korean, keep it casual and easy. Avoid honorific endings."
      : "Keep the tone natural and casual.",
    "Answer questions with a direct first sentence before asking anything back.",
    "React to one concrete detail when possible.",
    "Do not sound like customer support or a digital assistant.",
    "Do not ask what you can help with.",
    "Reply in at most 2 short lines.",
    "Keep each line brief and natural.",
    "Avoid repetitive filler and avoid changing the subject abruptly.",
    "Do not use emoji, emoticons, kaomoji, or decorative symbols.",
    "Do not mention being an AI model unless directly asked.",
    "Do not use bullet points, labels, or quotation marks around the reply.",
  ].join(" ");
}

function buildAiReplyMessages({ language, outputLanguage, mode, history, message, personaKey, lockOutputLanguage }) {
  const normalizedMode = normalizeAiReplyMode(mode);
  const system = buildAiReplyPersonaAwareSystemPrompt(language, outputLanguage, normalizedMode, {
    personaKey,
    lockOutputLanguage,
  });
  const normalizedHistory = Array.isArray(history) ? history : [];
  const contextMessage = buildAiReplyContextMessage(language, normalizedMode, normalizedHistory, message);
  const messages = [{ role: "system", content: system }];
  messages.push({
    role: "system",
    content: `Current output language for this turn: ${normalizeAiReplyLanguage(outputLanguage || language)}.`,
  });
  if (contextMessage) {
    messages.push({ role: "system", content: contextMessage });
  }
  messages.push(...normalizedHistory);
  if (normalizedMode === "nudge") {
    messages.push({
      role: "user",
      content:
        "The user has gone quiet. Send one fresh short message to restart the conversation. Use the recent context if it helps, but do not repeat an earlier assistant message.",
    });
    return messages;
  }
  messages.push({
    role: "user",
    content: sanitizeAiReplyText(message || "", AI_REPLY_MAX_TEXT_LEN),
  });
  return messages;
}

async function requestAiReplyByOllama(input) {
  if (typeof fetch !== "function") {
    return { ok: false, errorCode: "FETCH_UNAVAILABLE", errorMessage: "FETCH_UNAVAILABLE", replyText: "" };
  }
  const payload = input && typeof input === "object" ? input : {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) {
    return { ok: false, errorCode: "AI_MESSAGES_EMPTY", errorMessage: "AI_MESSAGES_EMPTY", replyText: "" };
  }

  const timeoutMs = Number.isFinite(Number(payload.timeoutMs))
    ? Math.max(1000, Math.min(70000, Math.trunc(Number(payload.timeoutMs))))
    : Math.max(1000, Math.min(70000, Math.trunc(Number(AI_REPLY_TIMEOUT_MS) || 60000)));

  if (AI_REPLY_SERVICE_BASE_URL) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const tm = setTimeout(() => {
      try {
        if (ctrl) ctrl.abort();
      } catch {}
    }, timeoutMs + 1500);
    try {
      const res = await fetch(`${AI_REPLY_SERVICE_BASE_URL}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          messages,
          timeoutMs,
        }),
        signal: ctrl ? ctrl.signal : undefined,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ok: false,
          errorCode: sanitizeAiReplyText(json && (json.errorCode || json.error || `AI_REPLY_SERVICE_HTTP_${res.status}`), 120) || `AI_REPLY_SERVICE_HTTP_${res.status}`,
          errorMessage: sanitizeAiReplyText(json && (json.errorMessage || json.error || `AI_REPLY_SERVICE_HTTP_${res.status}`), 220) || `AI_REPLY_SERVICE_HTTP_${res.status}`,
          replyText: "",
        };
      }
      return {
        ok: Boolean(json && json.ok && json.replyText),
        errorCode: sanitizeAiReplyText(json && json.errorCode, 120),
        errorMessage: sanitizeAiReplyText(json && json.errorMessage, 220),
        replyText: sanitizeAiReplyOutputText(json && json.replyText, AI_REPLY_MAX_REPLY_LEN, AI_REPLY_MAX_LINES),
        model: sanitizeAiReplyText((json && json.model) || AI_REPLY_OLLAMA_MODEL, 80) || AI_REPLY_OLLAMA_MODEL,
      };
    } catch (e) {
      const isAbort = e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")));
      return {
        ok: false,
        errorCode: isAbort ? "AI_REPLY_SERVICE_TIMEOUT" : "AI_REPLY_SERVICE_FAILED",
        errorMessage: sanitizeAiReplyText((e && e.message) || "", 220) || (isAbort ? "AI_REPLY_SERVICE_TIMEOUT" : "AI_REPLY_SERVICE_FAILED"),
        replyText: "",
      };
    } finally {
      clearTimeout(tm);
    }
  }

  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const tm = setTimeout(() => {
    try {
      if (ctrl) ctrl.abort();
    } catch {}
  }, timeoutMs);

  try {
    const res = await fetch(`${AI_REPLY_OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
        body: JSON.stringify({
          model: AI_REPLY_OLLAMA_MODEL,
          keep_alive: "30m",
          stream: false,
          messages,
          options: {
            temperature: 0.45,
            top_p: 0.9,
            top_k: 40,
            repeat_penalty: 1.2,
            num_ctx: AI_REPLY_NUM_CTX,
            num_predict: AI_REPLY_NUM_PREDICT,
            num_thread: AI_REPLY_NUM_THREAD,
          },
        }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        errorCode: `OLLAMA_HTTP_${res.status}`,
        errorMessage: sanitizeAiReplyText((json && (json.error || json.message)) || "", 220) || `OLLAMA_HTTP_${res.status}`,
        replyText: "",
      };
    }
    const text = sanitizeAiReplyOutputText(json && json.message && json.message.content, AI_REPLY_MAX_REPLY_LEN, AI_REPLY_MAX_LINES);
    if (!text) {
      return { ok: false, errorCode: "OLLAMA_EMPTY_REPLY", errorMessage: "OLLAMA_EMPTY_REPLY", replyText: "" };
    }
    return {
      ok: true,
      errorCode: "",
      errorMessage: "",
      replyText: text,
      model: sanitizeAiReplyText((json && json.model) || AI_REPLY_OLLAMA_MODEL, 80) || AI_REPLY_OLLAMA_MODEL,
    };
  } catch (e) {
    const isAbort = e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")));
    return {
      ok: false,
      errorCode: isAbort ? "OLLAMA_TIMEOUT" : "OLLAMA_REQUEST_FAILED",
      errorMessage: sanitizeAiReplyText((e && e.message) || "", 220) || (isAbort ? "OLLAMA_TIMEOUT" : "OLLAMA_REQUEST_FAILED"),
      replyText: "",
    };
  } finally {
    clearTimeout(tm);
  }
}

function pickAiReplyReplyFallbackText(outputLanguage, mode, history, message) {
  return pickAiReplyQuestionFallback(outputLanguage, message, history) || pickAiReplyFallback(outputLanguage, mode, history, message);
}

function buildCapabilityAwareFallbackText(outputLanguage, mode, history, message, capabilityQuestion) {
  const fallbackText = capabilityQuestion
    ? pickAiReplyCapabilityFallback(outputLanguage, history)
    : pickAiReplyReplyFallbackText(outputLanguage, mode, history, message);
  return applyAiReplyStyle(fallbackText, outputLanguage);
}

const __aiReplyHandler = async (req, res) => {
  try {
    if (!AI_REPLY_ENABLED) {
      return res.status(503).json({
        ok: false,
        errorCode: "AI_REPLY_DISABLED",
        errorMessage: "AI_REPLY_DISABLED",
      });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const mode = normalizeAiReplyMode(body.mode || body.scene || "");
    const message = sanitizeAiReplyText(body.message || body.text || "", AI_REPLY_MAX_TEXT_LEN);
    if (mode !== "nudge" && !message) {
      return res.status(400).json({
        ok: false,
        errorCode: "AI_REPLY_MESSAGE_REQUIRED",
        errorMessage: "AI_REPLY_MESSAGE_REQUIRED",
      });
    }

    const rateKey = buildAiReplyRateLimitKey(req, body);
    const rate = consumeAiReplyRateLimit(rateKey);
    if (!rate.ok) {
      return res.status(429).json({
        ok: false,
        errorCode: "AI_REPLY_RATE_LIMITED",
        errorMessage: "AI_REPLY_RATE_LIMITED",
        retryAfterMs: rate.retryAfterMs,
      });
    }

    const language = normalizeAiReplyLanguage(body.language || body.lang || "");
    const personaKey = normalizeAiReplyPersonaKey(body.personaKey || body.profileKey || "");
    const lockOutputLanguage = parseAiReplyBoolean(body.lockOutputLanguage || body.strictLanguage || body.enforceOutputLanguage);
    const historyBase = normalizeAiReplyHistory(body.history || body.messages || []);
    const history =
      mode === "reply" && message
        ? limitAiReplyHistoryByRole(historyBase, Math.max(0, AI_REPLY_HISTORY_MAX_USER_MESSAGES - 1), AI_REPLY_HISTORY_MAX_ASSISTANT_MESSAGES)
        : historyBase;
    const outputLanguage = resolveAiReplyOutputLanguage(language, message, history, { lockOutputLanguage });
    const explicitRequestedLanguage = detectAiReplyLanguageRequest(message);
    const fastPathDetectLanguage = detectAiReplyMessageLanguageHint(message) || language;
    if (mode === "reply" && explicitRequestedLanguage && !lockOutputLanguage) {
      return res.status(200).json({
        ok: true,
        source: "language-switch",
        model: AI_REPLY_OLLAMA_MODEL,
        replyText: applyAiReplyStyle(pickAiReplyLanguageSwitchAck(outputLanguage, history), outputLanguage),
        latencyMs: 0,
      });
    }
    const directFastPathType = mode === "reply" ? detectAiReplyDirectFastPathType(message) : "";
    if (directFastPathType) {
      const directFastPathReply = pickAiReplyFastPath(outputLanguage, directFastPathType, history);
      if (directFastPathReply) {
        return res.status(200).json({
          ok: true,
          source: "fastpath",
          model: AI_REPLY_OLLAMA_MODEL,
          replyText: applyAiReplyStyle(directFastPathReply, outputLanguage),
          latencyMs: 0,
        });
      }
    }
    const fastPathType = mode === "reply" ? classifyAiReplyFastPath(message, fastPathDetectLanguage) : "";
    const fastPathReply = fastPathType ? pickAiReplyFastPath(outputLanguage, fastPathType, history) : "";
    if (fastPathReply) {
      return res.status(200).json({
        ok: true,
        source: "fastpath",
        model: AI_REPLY_OLLAMA_MODEL,
        replyText: applyAiReplyStyle(fastPathReply, outputLanguage),
        latencyMs: 0,
      });
    }
    const capabilityQuestion = mode === "reply" && isAiReplyCapabilityQuestion(message, fastPathDetectLanguage);
    if (capabilityQuestion) {
      return res.status(200).json({
        ok: true,
        source: "capability-fallback",
        model: AI_REPLY_OLLAMA_MODEL,
        replyText: applyAiReplyStyle(pickAiReplyCapabilityFallback(outputLanguage, history), outputLanguage),
        latencyMs: 0,
      });
    }
    const messages = buildAiReplyMessages({
      language,
      outputLanguage,
      mode,
      history,
      message,
      personaKey,
      lockOutputLanguage,
    });

    const startedAt = Date.now();
    const out = await requestAiReplyByOllama({
      messages,
      timeoutMs: body.timeoutMs,
    });
    const latencyMs = Math.max(0, Math.trunc(Date.now() - startedAt));

    if (out.ok && out.replyText) {
      const replyText = applyAiReplyStyle(out.replyText, outputLanguage);
      if (mode === "reply") {
        if (isAiReplyServiceLike(replyText, outputLanguage)) {
          const fallbackText = buildCapabilityAwareFallbackText(outputLanguage, mode, history, message, capabilityQuestion);
          return res.status(200).json({
            ok: true,
            source: "fallback",
            model: out.model || AI_REPLY_OLLAMA_MODEL,
            replyText: fallbackText,
            latencyMs,
            errorCode: "AI_REPLY_SERVICE_LIKE",
            errorMessage: "AI_REPLY_SERVICE_LIKE",
          });
        }
        return res.status(200).json({
          ok: true,
          source: "ollama",
          model: out.model || AI_REPLY_OLLAMA_MODEL,
          replyText,
          latencyMs,
        });
      }
      const repetitive = isAiReplyRepeated(replyText, history);
      const tooGeneric = isAiReplyTooGeneric(replyText, outputLanguage);
      if (!repetitive && !tooGeneric) {
        return res.status(200).json({
          ok: true,
          source: "ollama",
          model: out.model || AI_REPLY_OLLAMA_MODEL,
          replyText,
          latencyMs,
        });
      }
      out.errorCode = out.errorCode || (tooGeneric ? "AI_REPLY_TOO_GENERIC" : "AI_REPLY_REPETITIVE");
      out.errorMessage = out.errorMessage || out.errorCode;
    }

    if (mode === "nudge" && AI_REPLY_FALLBACK_ENABLED) {
      const fallbackText = applyAiReplyStyle(pickAiReplyFallback(outputLanguage, mode, history, message), outputLanguage);
      return res.status(200).json({
        ok: true,
        source: "fallback",
        model: out.model || AI_REPLY_OLLAMA_MODEL,
        replyText: fallbackText,
        mode,
        latencyMs,
        errorCode: out.errorCode || "AI_REPLY_FALLBACK",
        errorMessage: out.errorMessage || "AI_REPLY_FALLBACK",
      });
    }

    if (
      mode === "reply" &&
      AI_REPLY_FALLBACK_ENABLED &&
      /TIMEOUT|REQUEST_FAILED|SERVICE_TIMEOUT|SERVICE_FAILED/i.test(String(out.errorCode || ""))
    ) {
      const fallbackText = applyAiReplyStyle(pickAiReplyReplyFallbackText(outputLanguage, mode, history, message), outputLanguage);
      return res.status(200).json({
        ok: true,
        source: "fallback",
        model: out.model || AI_REPLY_OLLAMA_MODEL,
        replyText: fallbackText,
        latencyMs,
        errorCode: out.errorCode || "AI_REPLY_TIMEOUT_FALLBACK",
        errorMessage: out.errorMessage || "AI_REPLY_TIMEOUT_FALLBACK",
      });
    }

    return res.status(502).json({
      ok: false,
      errorCode: out.errorCode || "AI_REPLY_FAILED",
      errorMessage: out.errorMessage || "AI_REPLY_FAILED",
      latencyMs,
    });
  } catch (e) {
    const errText = sanitizeAiReplyText((e && e.message) || e, 220) || "AI_REPLY_FAILED";
    const body = req && req.body && typeof req.body === "object" ? req.body : {};
    const mode = normalizeAiReplyMode(body.mode);
    if (mode === "reply" && AI_REPLY_FALLBACK_ENABLED) {
      const language = normalizeAiReplyLanguage(body.language || body.lang || "");
      const lockOutputLanguage = parseAiReplyBoolean(body.lockOutputLanguage || body.strictLanguage || body.enforceOutputLanguage);
      const historyBase = normalizeAiReplyHistory(body.history || body.messages || []);
      const message = sanitizeAiReplyText(body.message || body.text || body.prompt || "", AI_REPLY_MAX_TEXT_LEN);
      const history = message
        ? limitAiReplyHistoryByRole(historyBase, Math.max(0, AI_REPLY_HISTORY_MAX_USER_MESSAGES - 1), AI_REPLY_HISTORY_MAX_ASSISTANT_MESSAGES)
        : historyBase;
      const outputLanguage = resolveAiReplyOutputLanguage(language, message, history, { lockOutputLanguage });
      return res.status(200).json({
        ok: true,
        source: "fallback",
        model: AI_REPLY_OLLAMA_MODEL,
        replyText: applyAiReplyStyle(pickAiReplyReplyFallbackText(outputLanguage, "reply", history, message), outputLanguage),
        errorCode: "AI_REPLY_FAILED",
        errorMessage: errText,
      });
    }
    if (mode === "nudge" && AI_REPLY_FALLBACK_ENABLED) {
      const language = normalizeAiReplyLanguage(body.language || body.lang || "");
      const lockOutputLanguage = parseAiReplyBoolean(body.lockOutputLanguage || body.strictLanguage || body.enforceOutputLanguage);
      const history = normalizeAiReplyHistory(body.history || body.messages || []);
      const message = sanitizeAiReplyText(body.message || body.text || body.prompt || "", AI_REPLY_MAX_TEXT_LEN);
      const outputLanguage = resolveAiReplyOutputLanguage(language, message, history, { lockOutputLanguage });
      return res.status(200).json({
        ok: true,
        source: "fallback",
        model: AI_REPLY_OLLAMA_MODEL,
        replyText: applyAiReplyStyle(pickAiReplyFallback(outputLanguage, "nudge", history, message), outputLanguage),
        errorCode: "AI_REPLY_FAILED",
        errorMessage: errText,
      });
    }
    return res.status(500).json({
      ok: false,
      errorCode: "AI_REPLY_FAILED",
      errorMessage: errText,
    });
  }
};
const aiReplyRateLimitSweepTimer = setInterval(() => {
  const nowMs = Date.now();
  try {
    for (const [key, bucket] of aiReplyRateLimitByKey.entries()) {
      if (!bucket || Number(bucket.resetAtMs || 0) <= nowMs) aiReplyRateLimitByKey.delete(key);
    }
  } catch {}
}, Math.max(10000, Math.trunc(Number(AI_REPLY_RATE_LIMIT_SWEEP_MS) || 60000)));

function closeAiReplyService() {
  try {
    clearInterval(aiReplyRateLimitSweepTimer);
  } catch {}
}

function mountAiReplyRoutes(app) {
  ["/api/ai/reply", "/ai/reply"].forEach((p) => {
    app.post(p, __aiReplyHandler);
  });
  return __aiReplyHandler;
}

module.exports = {
  closeAiReplyService,
  mountAiReplyRoutes,
  sanitizeAiReplyText,
};
