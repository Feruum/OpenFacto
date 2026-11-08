/** Whole-word orthographic variants only: no stemming, word deletion or semantic rewriting. */
const spellings = new Map<string, string>();
for (const [canonical, variants] of [
  ['тіркелу', ['тіркелу', 'тиркелу', 'tirkelu']],
  ['қайда', ['қайда', 'кайда', 'qaida', 'qayda', 'kaida', 'kayda']],
  ['қай', ['қай', 'кай', 'qai', 'qay', 'kai', 'kay']],
  ['болады', ['болады', 'bolady']],
  ['өтеді', ['өтеді', 'отеди', 'otedi']],
  ['қашан', ['қашан', 'кашан', 'qashan', 'kashan']],
  ['ал', ['ал', 'al']],
  ['сағат', ['сағат', 'сагат', 'sagat']],
  ['нешеде', ['нешеде', 'neshede']],
] as const) for (const variant of variants) spellings.set(variant, canonical);
const confusables: Record<string, string> = { a:'а', e:'е', o:'о', p:'р', c:'с', y:'у', x:'х' };

export function foldKazakhSpelling(normalized: string): string {
  return normalized.split(' ').map(word => {
    // A Latin keyboard letter inside Cyrillic is common; only accept a known word.
    const mixed = /\p{Script=Cyrillic}/u.test(word) && /[a-z]/u.test(word)
      ? word.replace(/[aeopcyx]/g, letter => confusables[letter]!)
      : word;
    return spellings.get(mixed) ?? word;
  }).join(' ');
}

/** Optional positive copula after a location question; negated/modal and conditional forms stay intact. */
export function faqQuestionKey(normalized: string): string {
  return foldKazakhSpelling(normalized).replace(/ (қайда|қай жерде) (болады|өтеді)$/u, ' $1');
}

const timeFragments = new Map<string, 'ru' | 'kk' | 'en'>([
  ['а во ск','ru'], ['во ск','ru'], ['а во сколько','ru'], ['во сколько','ru'], ['когда','ru'],
  ['қашан','kk'], ['ал қашан','kk'], ['сағат нешеде','kk'], ['ал сағат нешеде','kk'],
  ['when','en'], ['and when','en'], ['what time','en'], ['at what time','en'],
]);
export function timeFragmentLanguage(normalized: string) { return timeFragments.get(normalized); }

/** A clock-like password or number alone is not enough to answer a time question. */
export function faqSuppliesTime(text: string): boolean {
  return /(?:^|\s)(?:с|до|в|от|к|после|from|until|at|before|сағат|күні)\s+(?:[01]?\d|2[0-3]):[0-5]\d\b/iu.test(text);
}
