/**
 * BOS Core — Arabic Light Stemmer (rule-based, dependency-free, offline)
 * ---------------------------------------------------------------------------
 * Reduces Arabic tokens to a light stem by stripping attached particles:
 *
 *   conjunctions        و ف            (wa-, fa-)
 *   prepositions        ب ك ل          (bi-, ka-, li-) — stripped only when
 *                                      followed by the definite article, in
 *                                      the tradition of "light" stemmers, so
 *                                      lexical initials survive (e.g. words
 *                                      that simply START with ب are untouched)
 *   definite article    ال  and the assimilated form  لل
 *
 * Examples:  بالتوتر → توتر,  كالقهوة → قهوه*,  وللعمل → عمل
 * (*assumes input already normalized: ة→ه etc. — see normalizeToken)
 *
 * This is deliberately NOT a root extractor. Light stemming trades recall
 * for safety: every rule has a minimum-remainder guard so short lexical
 * words (ولد, باب, لكن) are never mangled. Suffix stripping is excluded
 * from V1 scope on the same principle.
 *
 * Domain-agnostic by construction: pure string surgery, no vocabulary.
 */

/** True when the token contains Arabic-script characters. */
export const isArabicScript = (token: string): boolean =>
  /[؀-ۿ]/.test(token);

/** A stem must keep at least this many characters to be trusted. */
const MIN_STEM_LENGTH = 2;
/** Bare conjunctions are stripped only from comfortably long tokens. */
const MIN_AFTER_CONJUNCTION = 3;

const CONJUNCTIONS = new Set(['و', 'ف']);
const PREPOSITIONS = new Set(['ب', 'ك', 'ل']);
const ARTICLE = 'ال';
const ASSIMILATED_ARTICLE = 'لل'; // li- + al- fused: للعمل = ل + العمل

/**
 * Strip particles from the front of ONE normalized Arabic token.
 * Applies rules iteratively (وبالقهوة → بالقهوة → القهوة → قهوه) with
 * length guards at every step; returns the input unchanged when no rule
 * applies safely.
 */
export function stemArabicToken(token: string): string {
  let current = token;

  // Guard against pathological loops: each pass must shorten the token.
  for (;;) {
    const before = current;

    // 1. Definite article: القهوة → قهوة
    if (
      current.startsWith(ARTICLE) &&
      current.length - ARTICLE.length >= MIN_STEM_LENGTH
    ) {
      current = current.slice(ARTICLE.length);
      continue;
    }

    // 2. Assimilated li-+article: للعمل → عمل
    if (
      current.startsWith(ASSIMILATED_ARTICLE) &&
      current.length - ASSIMILATED_ARTICLE.length >= MIN_STEM_LENGTH
    ) {
      current = current.slice(ASSIMILATED_ARTICLE.length);
      continue;
    }

    const head = current[0] ?? '';
    const rest = current.slice(1);

    // 3. Preposition fused with the article: بالتوتر → التوتر (loop -> توتر)
    if (
      PREPOSITIONS.has(head) &&
      rest.startsWith(ARTICLE) &&
      rest.length - ARTICLE.length >= MIN_STEM_LENGTH
    ) {
      current = rest;
      continue;
    }

    // 4. Bare conjunction: وتوتر → توتر (only when plenty remains)
    if (CONJUNCTIONS.has(head) && rest.length >= MIN_AFTER_CONJUNCTION) {
      current = rest;
      continue;
    }

    if (current === before) break;
  }

  return current;
}

/**
 * Stem any token conditionally: Arabic-script tokens go through the light
 * stemmer; everything else passes through untouched. Script detection is
 * the reliable conditional here — reflection notes are frequently
 * mixed-language, so the note's UI locale alone cannot be trusted.
 */
export function stemToken(token: string): string {
  return isArabicScript(token) ? stemArabicToken(token) : token;
}
