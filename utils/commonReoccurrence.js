const MERCHANT_STOP_WORDS = new Set([
  'au',
  'notau',
  'australia',
  'pending',
  'posted',
  'category',
  'in',
  'progress',
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeMerchant(value) {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token && !MERCHANT_STOP_WORDS.has(token));
}

export function normalizeCommonReoccurrenceMerchant(value) {
  const tokens = tokenizeMerchant(value);
  return tokens.length > 0 ? tokens.join(' ') : normalizeText(value);
}

export function normalizeCommonReoccurrenceAmount(value) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return null;
  return Math.abs(amount).toFixed(2);
}

function buildMerchantSlug(value) {
  return normalizeCommonReoccurrenceMerchant(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function getCommonReoccurrenceKey(value = {}) {
  const amountKey = normalizeCommonReoccurrenceAmount(value.normalizedAmount || value.amount);
  const merchantSlug = buildMerchantSlug(value.normalizedMerchant || value.merchant);

  if (!amountKey || !merchantSlug) return null;

  return `${amountKey.replace('.', '')}_${merchantSlug}`;
}

export function buildCommonReoccurrenceRule(transaction = {}) {
  const normalizedAmount = normalizeCommonReoccurrenceAmount(transaction.amount);
  const normalizedMerchant = normalizeCommonReoccurrenceMerchant(transaction.merchant);
  const key = getCommonReoccurrenceKey({
    amount: normalizedAmount,
    merchant: normalizedMerchant,
  });

  if (!key) return null;

  return {
    key,
    merchant: transaction.merchant || normalizedMerchant,
    amount: Number(normalizedAmount),
    normalizedMerchant,
    normalizedAmount,
    enabled: true,
  };
}

export function normalizeCommonReoccurrenceRules(rules = []) {
  const rawRules = Array.isArray(rules)
    ? rules
    : Object.entries(rules || {}).map(([key, value]) => ({
        key,
        ...(value || {}),
      }));

  return rawRules
    .map((rule) => {
      const normalizedRule = buildCommonReoccurrenceRule(rule);
      if (!normalizedRule) return null;

      return {
        ...normalizedRule,
        ...rule,
        key: rule.key || normalizedRule.key,
        enabled: rule.enabled !== false,
      };
    })
    .filter(Boolean);
}

export function isCommonReoccurrenceTransaction(transaction = {}, rules = []) {
  const key = getCommonReoccurrenceKey(transaction);
  if (!key) return false;

  return normalizeCommonReoccurrenceRules(rules).some((rule) => rule.enabled !== false && rule.key === key);
}
