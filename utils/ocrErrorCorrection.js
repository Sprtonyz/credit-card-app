export function fixAmountFormatting(amountStr) {
  if (!amountStr) return 0;

  let cleaned = amountStr.toString().replace(/\s/g, '');
  cleaned = cleaned.replace(/[$€£¥]/g, '');
  const hadCurrencyMarker = /[$€£¥]/.test(amountStr) || /^-/.test(cleaned);
  const unsignedCleaned = cleaned.replace(/^-/, '');

  const commaCount = (cleaned.match(/,/g) || []).length;
  const periodCount = (cleaned.match(/\./g) || []).length;

  if (commaCount > 0 && periodCount === 0) {
    cleaned = cleaned.replace(/,([0-9]{2})$/, '.$1');
    cleaned = cleaned.replace(/[,]/g, '');
  } else if (periodCount > 0) {
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
    }
  }

  if (
    hadCurrencyMarker &&
    commaCount === 0 &&
    periodCount === 0 &&
    /^\d{3,6}$/.test(unsignedCleaned)
  ) {
    const normalized = `${unsignedCleaned.slice(0, -2)}.${unsignedCleaned.slice(-2)}`;
    cleaned = cleaned.startsWith('-') ? `-${normalized}` : normalized;
  }

  if (commaCount === 0 && periodCount === 0 && /^\d{3,6}$/.test(unsignedCleaned)) {
    const normalized = `${unsignedCleaned.slice(0, -2)}.${unsignedCleaned.slice(-2)}`;
    cleaned = cleaned.startsWith('-') ? `-${normalized}` : normalized;
  }

  cleaned = cleaned.replace(/[^0-9.]/g, '');

  const amount = parseFloat(cleaned);
  return Number.isNaN(amount) ? 0 : Math.round(amount * 100) / 100;
}

function inferRefund(transaction) {
  const rawAmountText = String(transaction?.rawAmountText || '').trim();
  const rawLine = String(transaction?.rawLine || '').toLowerCase();
  const merchant = String(transaction?.merchant || '').toLowerCase();
  const amount = Number(transaction?.amount || 0);

  if (!Number.isFinite(amount) || amount <= 0) return false;

  if (/^[-(]/.test(rawAmountText)) return false;

  if (/\b(refund|reversal|credit|cash back|cashback)\b/.test(rawLine)) return true;
  if (/\b(refund|reversal|credit|cash back|cashback)\b/.test(merchant)) return true;

  return true;
}

export function fixMerchantName(merchant) {
  if (!merchant) return '';

  let corrected = merchant.trim();
  corrected = corrected.replace(/\bl\b/gi, '1');
  corrected = corrected.replace(/O(\d)/g, '0$1');
  corrected = corrected.replace(/(\d)O/g, '$10');
  corrected = corrected.replace(/\s+/g, ' ');
  corrected = corrected.toUpperCase();

  return corrected;
}

export function fixDateFormatting(dateStr) {
  if (!dateStr || dateStr.trim() === '') return null;

  const normalized = dateStr.trim().replace(/\u00a0/g, ' ');

  const tryParseDateParts = () => {
    const monthLookup = {
      jan: 0,
      january: 0,
      feb: 1,
      february: 1,
      mar: 2,
      march: 2,
      apr: 3,
      april: 3,
      may: 4,
      jun: 5,
      june: 5,
      jul: 6,
      july: 6,
      aug: 7,
      august: 7,
      sep: 8,
      sept: 8,
      september: 8,
      oct: 9,
      october: 9,
      nov: 10,
      november: 10,
      dec: 11,
      december: 11,
    };

    const withMonthName = normalized.match(
      /^(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\s+)?(\d{1,2})\s+([a-z]{3,9})\s+(\d{2,4})$/i
    );
    if (withMonthName) {
      const day = Number(withMonthName[1]);
      const month = monthLookup[withMonthName[2].toLowerCase()];
      let year = Number(withMonthName[3]);
      if (year < 100) year += year < 70 ? 2000 : 1900;
      if (Number.isFinite(day) && Number.isInteger(month) && Number.isFinite(year)) {
        const date = new Date(year, month, day);
        if (!Number.isNaN(date.getTime())) {
          const yyyy = date.getFullYear();
          const mm = String(date.getMonth() + 1).padStart(2, '0');
          const dd = String(date.getDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        }
      }
    }

    const numeric = normalized.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (numeric) {
      const day = Number(numeric[1]);
      const month = Number(numeric[2]) - 1;
      let year = Number(numeric[3]);
      if (year < 100) year += year < 70 ? 2000 : 1900;
      const date = new Date(year, month, day);
      if (!Number.isNaN(date.getTime())) {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    }

    return null;
  };

  try {
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      return tryParseDateParts();
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  } catch (e) {
    return tryParseDateParts();
  }
}

export function fixCategory(category) {
  if (!category) return null;

  const corrected = category.trim().toUpperCase();
  const categoryMap = {
    ENTERTAIN: 'Entertainment',
    ENTERTAINEMENT: 'Entertainment',
    ENTERTAIMENT: 'Entertainment',
    'FOOD & DRINK': 'Food & Drink',
    GROCERIES: 'Groceries',
    TRANSPORT: 'Transport',
    TRANSPORTAION: 'Transport',
    SHOPPING: 'Shopping',
    UTILITIES: 'Utilities',
    HEALTH: 'Health',
  };

  return categoryMap[corrected] || category;
}

export function correctTransaction(transaction) {
  const normalizedMerchant = fixMerchantName(transaction.merchant);
  const amount = fixAmountFormatting(transaction.amount);
  const normalizedDate = transaction.date ? fixDateFormatting(transaction.date) : null;
  const isRefund = inferRefund({
    ...transaction,
    amount,
  });

  return {
    ...transaction,
    merchant: normalizedMerchant,
    amount: isRefund ? -Math.abs(amount) : amount,
    category: transaction.category ? fixCategory(transaction.category) : null,
    date: normalizedDate,
    isPending: !transaction.date || !normalizedDate,
    isRefund,
    rawParsed: {
      merchant: transaction.merchant || null,
      amountText: transaction.amount || null,
      date: transaction.date || null,
      category: transaction.category || null,
    },
    normalization: {
      originalMerchant: transaction.merchant || null,
      normalizedMerchant,
      merchantChanged:
        String(transaction.merchant || '').trim().toUpperCase() !== String(normalizedMerchant || '').trim(),
      originalAmountText: transaction.amount || null,
      normalizedAmount: isRefund ? -Math.abs(amount) : amount,
      amountChanged: Number(fixAmountFormatting(transaction.amount)) !== Number(transaction.amount),
      originalDate: transaction.date || null,
      normalizedDate,
      dateChanged: String(transaction.date || '') !== String(normalizedDate || ''),
    },
  };
}

export function correctTransactions(transactions) {
  return transactions.map(correctTransaction);
}
