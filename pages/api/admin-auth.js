import { timingSafeEqual } from 'crypto';

function safeCompare(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ''));
  const right = Buffer.from(String(rightValue || ''));

  if (left.length !== right.length) {
    try {
      timingSafeEqual(left, Buffer.alloc(left.length));
    } catch {
      // Length mismatch is already a failed comparison.
    }
    return false;
  }

  return timingSafeEqual(left, right);
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const configuredPassword = process.env.ADMIN_TOOLS_PASSWORD;

  if (!configuredPassword) {
    return res.status(503).json({
      error: 'Admin tools password is not configured.',
    });
  }

  const password = String(req.body?.password || '');

  if (!password || password.length > 200) {
    return res.status(400).json({ error: 'Enter the admin tools password.' });
  }

  if (!safeCompare(password, configuredPassword)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  return res.status(200).json({ ok: true });
}
