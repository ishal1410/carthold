export type Verdict = {
  flagged: boolean;
  triggeringText: string | null;
  reasons: string[];
};

const INLINE = /^(a|b|i|em|strong|span|small|u|code|mark|sup|sub|abbr)$/i;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Page HTML -> plain text, with hidden channels (comments, alt/title/aria-label) surfaced and unicode tricks undone. */
export function extractText(html: string): string {
  return html
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, "\n")
    .replace(/<!--([\s\S]*?)-->/g, "\n$1\n")
    .replace(/<\/?([a-zA-Z][\w-]*)\b([^>]*)>/g, (_, tag: string, attrs: string) => {
      const vals = [...attrs.matchAll(/\b(?:alt|title|aria-label|placeholder|data-[\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi)]
        .map((m) => m[2] ?? m[3]);
      return vals.length ? `\n${vals.join("\n")}\n` : INLINE.test(tag) ? " " : "\n";
    })
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(e[1] === "x" ? 2 : 1), e[1] === "x" ? 16 : 10)) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    // Unicode tag block (U+E0020..E007E) mirrors ASCII invisibly: "ASCII smuggling".
    .replace(/[\u{E0020}-\u{E007E}]/gu, (c) => String.fromCharCode(c.codePointAt(0)! - 0xe0000))
    .replace(/[\u{E0000}-\u{E007F}​-‏⁠-⁤﻿­‪-‮⁦-⁩]/gu, "")
    .normalize("NFKC")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// ponytail: hand-tuned regexes; known ceiling is paraphrased attacks that never address the agent.
// The LLM inspector is the upgrade path, this is the floor that cannot be talked out of a block.
const RULES: [RegExp, string][] = [
  [/\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+|my\s+)?(prior|previous|above|earlier|preceding|original)\s+(instructions|prompts?|rules|directions)/i, "instruction override"],
  [/\bnew instructions\b/i, "instruction override"],
  [/(^|\s)(SYSTEM|ADMIN|DEVELOPER|ASSISTANT)\s*:|\[(system|assistant|admin|developer)\]|<\|im_start\|>|<\|(system|assistant)\|>/, "fake role / system prefix"],
  [/\byou are now (in |an? )?(developer|dan|admin|god|unrestricted|jailbreak)/i, "role hijack"],
  [/\b(AI|LLM|automated|shopping)\s+(shopping\s+)?(agents?|assistants?|bots?|models?)\s*[:,]|\b(note|attention|message|instructions?|tip)\s+(to|for)\s+(any\s+|all\s+)?(AI|LLM|automated|shopping)\b|\b(for|to)\s+(any|all|every)\s+(AI|LLM|automated)\s+(agent|assistant|bot|model)s?\b|\bif you are an? (AI|LLM|language model|assistant|agent)\b|^(assistant|agent)\s*,/i, "text addresses the AI agent"],
  [/\b(user|customer|buyer)\s+(has\s+)?(already\s+)?(pre-?approved|approved|authorized|consented)\b(?!\s+for\s+(PayPal|financing|pay later))/i, "claims user pre-approval"],
  [/\bpre-?approved\s+for\s+(this|your|the\s+user'?s?)\s+(account|user|customer|order)\b/i, "claims user pre-approval"],
  [/\bwithout\s+(asking|confirm(ing|ation)?|telling|notifying|checking with)\b|\b(do not|don't|never)\s+(ask|confirm|tell|notify|check with)\b/i, "suppresses user confirmation"],
  [/\b(send|transfer|wire)\s+(the\s+)?payment\s+to\b|\b(complete|place|make)\s+(the\s+|your\s+)?(purchase|order|payment)\s+(at|on|via|through)\s+\S+\s+instead\b/i, "redirects payment / merchant"],
  [/\b(disregard|ignore|exceed)\s+(the\s+)?(user'?s?|customer'?s?|buyer'?s?)\s+(budget|limit|cap|request)/i, "overrides user constraints"],
  [/\bpurchase limits? (do not|don't) apply\b/i, "overrides user constraints"],
];

export const sentencesOf = (line: string) => (line.match(/.+?(?:[.!?](?=\s|$)|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);

export type FlaggedLine = { line: string; sentence: string; reasons: string[] };

/** Every extracted line holding agent-aimed text: the line (the injected segment) and its first triggering sentence. */
export function flaggedLines(pageText: string, userRequest: string): FlaggedLine[] {
  const wantsGiftCards = /gift ?cards?/i.test(userRequest);
  const out: FlaggedLine[] = [];
  for (const line of extractText(pageText).split("\n")) {
    for (const sentence of sentencesOf(line)) {
      const reasons = RULES.filter(([re]) => re.test(sentence)).map(([, r]) => r);
      // Weak signal: pushing gift cards the user never asked for only counts alongside a strong one.
      if (reasons.length && !wantsGiftCards && /\bgift ?cards?\b/i.test(line)) reasons.push("pushes gift cards the user did not request");
      if (reasons.length) {
        out.push({ line, sentence, reasons: [...new Set(reasons)] });
        break;
      }
    }
  }
  return out;
}

export function detectInjection(pageText: string, userRequest: string): Verdict {
  const f = flaggedLines(pageText, userRequest)[0];
  return f ? { flagged: true, triggeringText: f.sentence, reasons: f.reasons } : { flagged: false, triggeringText: null, reasons: [] };
}
