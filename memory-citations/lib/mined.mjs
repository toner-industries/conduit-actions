// Checks memories a mining pass extracted before they are ingested. Mirrors the shape the engine's
// POST /v1/memories accepts. Ported from fluentstream/sms-delivery .github/scripts/meml-validate.mjs.

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v */
const optionalString = (v) => v === undefined || isNonEmptyString(v);

/**
 * @param {unknown} raw the mined.json array
 * @param {string | undefined} defaultSource applied to any item with no sourceKey of its own
 * @returns {{ok: true, items: Array<Record<string, unknown>>} | {ok: false, errors: string[]}}
 */
export function validateMinedItems(raw, defaultSource) {
  if (!Array.isArray(raw)) return { ok: false, errors: ['mined output must be a JSON array'] };

  /** @type {string[]} */
  const errors = [];
  /** @type {Array<Record<string, unknown>>} */
  const items = [];

  raw.forEach((item, i) => {
    if (!isPlainObject(item)) {
      errors.push(`item ${i}: not an object`);
      return;
    }
    if (item.memoryType !== 'spo' && item.memoryType !== 'ieu') {
      errors.push(`item ${i}: memoryType must be "spo" or "ieu"`);
      return;
    }
    if (!isNonEmptyString(item.content)) {
      errors.push(`item ${i}: content must be a non-empty string`);
      return;
    }
    if (item.memoryType === 'ieu' && !isNonEmptyString(item.experience)) {
      errors.push(`item ${i}: an ieu memory requires a non-empty string experience`);
      return;
    }
    if (![item.subject, item.predicate, item.object, item.sourceKey].every(optionalString)) {
      errors.push(`item ${i}: subject/predicate/object/sourceKey must be strings when present`);
      return;
    }
    const triplePartsGiven = [item.subject, item.predicate, item.object].filter((v) => v !== undefined).length;
    if (triplePartsGiven > 0 && triplePartsGiven < 3) {
      errors.push(`item ${i}: an spo triple must be complete (subject, predicate, object) or omitted entirely`);
      return;
    }
    const out = { ...item };
    if (!isNonEmptyString(out.sourceKey) && isNonEmptyString(defaultSource)) out.sourceKey = defaultSource;
    items.push(out);
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, items };
}
