/* Compares the dictation text with what the child wrote, word by word.
   No DOM or Angular access, so it is unit-tested on its own (compare.spec.ts). */

// what happened to each word in the correction
export const OP = {
  OK: 'o', // written correctly
  WRONG: 'w', // written differently
  ACCENT: 'a', // only an accent mark is missing or extra (counts half)
  MISSING: 'm', // forgotten
  EXTRA: 'x', // written but not in the text
} as const;
export type Op = (typeof OP)[keyof typeof OP];

export interface CompareItem {
  op: Op;
  expected?: string;
  written?: string;
}

export interface CompareResult {
  items: CompareItem[];
  total: number;
  ok: number;
  acc: number;
  errors: number;
  score: number;
  starts: Set<string>;
  wrong: string[];
}

// unifies apostrophes and the Catalan "l·l" so look-alike characters are not counted as mistakes
export function norm(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[’‘`´]/g, "'")
    .replace(/([lL])[.•∙⋅]([lL])/g, '$1·$2')
    .trim();
}

const WORD_OR_MARK = /[\p{L}\p{M}\p{N}]+(?:['·][\p{L}\p{M}]+)*|\S/gu;
const IS_WORD = /^[\p{L}\p{N}]/u;

// splits a text into words (and punctuation marks when withPunct is true)
export function tok(text: string, withPunct: boolean): string[] {
  const tokens = norm(text).match(WORD_OR_MARK) || [];
  return withPunct ? tokens : tokens.filter((x) => IS_WORD.test(x));
}

// strips only accent marks (grave, acute, diaeresis) so ñ and ç stay different letters;
// built from char codes so no editor turns the escapes into invisible characters
const ACCENT_MARKS = new RegExp('[' + String.fromCharCode(0x300, 0x301, 0x308) + ']', 'g');
const noAccents = (w: string) => w.normalize('NFD').replace(ACCENT_MARKS, '').normalize('NFC');

// "mañana" is accepted for "Mañana" when the word only has a capital because it starts a sentence
export const lowFirst = (w: string) => w.charAt(0).toLocaleLowerCase() + w.slice(1);

function sentenceStarts(expectedText: string): Set<string> {
  const tokens = tok(expectedText, true);
  return new Set(
    tokens.filter((x, k) => IS_WORD.test(x) && (k === 0 || /^[.!?…¿¡«"(]$/.test(tokens[k - 1]))),
  );
}

/**
 * @param expectedText  the dictation text
 * @param writtenText   what the child wrote
 * @param withPunct     count punctuation marks too
 */
export function compare(expectedText: string, writtenText: string, withPunct: boolean): CompareResult {
  const a = tok(expectedText, withPunct);
  const b = tok(writtenText, withPunct);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const items: CompareItem[] = [];
  let missing: string[] = [];
  let extra: string[] = [];
  // pairs up a run of unmatched words: side by side they are wrong (or accent) words,
  // the leftovers are missing or extra words
  const flush = () => {
    const paired = Math.min(missing.length, extra.length);
    for (let k = 0; k < paired; k++) {
      const op = noAccents(missing[k]) === noAccents(extra[k]) ? OP.ACCENT : OP.WRONG;
      items.push({ op, expected: missing[k], written: extra[k] });
    }
    for (let k = paired; k < missing.length; k++) items.push({ op: OP.MISSING, expected: missing[k] });
    for (let k = paired; k < extra.length; k++) items.push({ op: OP.EXTRA, written: extra[k] });
    missing = [];
    extra = [];
  };

  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      items.push({ op: OP.OK, expected: a[i] });
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) {
      missing.push(a[i++]);
    } else {
      extra.push(b[j++]);
    }
  }
  flush();

  const count = (op: Op) => items.filter((x) => x.op === op).length;
  const ok = count(OP.OK);
  const acc = count(OP.ACCENT);
  // one rule for both the grade and the "mistakes" tile: an accent slip costs half a word,
  // a wrong, missing or extra word costs a whole one
  const errors = count(OP.WRONG) + count(OP.MISSING) + count(OP.EXTRA) + acc / 2;
  const score = n ? Math.max(0, Math.round(((n - errors) / n) * 100) / 10) : 0;

  const wrong = [
    ...new Set(
      items
        .filter(
          (x) =>
            (x.op === OP.WRONG || x.op === OP.MISSING || x.op === OP.ACCENT) &&
            IS_WORD.test(x.expected ?? ''),
        )
        .map((x) => x.expected as string),
    ),
  ];

  return { items, total: n, ok, acc, errors, score, starts: sentenceStarts(expectedText), wrong };
}
