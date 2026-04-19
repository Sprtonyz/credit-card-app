export function fixAmountFormatting(amountStr) {
  if (!amountStr) return 0;

  let cleaned = amountStr.toString().replace(/\s/g, '');
  cleaned = cleaned.replace(/[$€£¥]/g, '');

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

  cleaned = cleaned.replace(/[^0-9.]/g, '');

  const amount = parseFloat(cleaned);
  return Number.isNaN(amount) ? 0 : Math.round(amount * 100) / 100;
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

  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  } catch (e) {
    return null;
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
  return {
    merchant: fixMerchantName(transaction.merchant),
    amount: fixAmountFormatting(transaction.amount),
    category: transaction.category ? fixCategory(transaction.category) : null,
    date: transaction.date ? fixDateFormatting(transaction.date) : null,
    isPending: !transaction.date || !fixDateFormatting(transaction.date),
  };
}

export function correctTransactions(transactions) {
  return transactions.map(correctTransaction);
}
