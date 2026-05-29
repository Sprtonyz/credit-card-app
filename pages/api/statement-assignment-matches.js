import { getEmailAutomationData } from '../../services/firebaseRestService';
import { normalizeFirebaseTransaction } from '../../utils/creditCardAppData';
import {
  buildResolvedAssignmentPool,
  matchAssignmentsToParsedTransactions,
} from '../../utils/assignmentMatcher';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const statementTransactions = Array.isArray(req.body?.transactions)
      ? req.body.transactions
      : null;

    if (!statementTransactions) {
      res.status(400).json({ error: 'Missing parsed transactions.' });
      return;
    }

    const { transactions, submissions } = await getEmailAutomationData();
    const normalizedTransactions = (transactions || []).map((transaction) =>
      normalizeFirebaseTransaction(transaction.id, transaction)
    );
    const assignmentPool = buildResolvedAssignmentPool(
      normalizedTransactions,
      submissions || {}
    );
    const matches = matchAssignmentsToParsedTransactions(
      statementTransactions,
      assignmentPool
    );

    res.status(200).json({
      ok: true,
      matches,
      assignmentPoolSize: assignmentPool.length,
    });
  } catch (error) {
    console.error('Failed to resolve statement assignment matches:', error);
    res.status(500).json({
      error:
        error?.message ||
        'Failed to resolve assignment matches from the main app data.',
    });
  }
}
