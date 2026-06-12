// POST /api/mentor — server-side AI proxy for the Nova mentor page.
//
// Set one of these env vars in Vercel:
//   ANTHROPIC_API_KEY
//   CLAUDE_API_KEY
//
// The browser sends a Claude-style request body. This route keeps the API key
// server-side and returns the provider response shape expected by mentor.html.

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const key = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
  if (!key) return json(res, 200, { error: 'missing_api_key' });

  const body = await readBody(req);
  const model = body.model || 'claude-opus-4-8';

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': key,
      },
      body: JSON.stringify({
        model,
        max_tokens: body.max_tokens || 1024,
        system: body.system || '',
        messages: Array.isArray(body.messages) ? body.messages : [],
      }),
    });
    const data = await upstream.json().catch(() => ({}));
    return json(res, upstream.ok ? 200 : upstream.status, data);
  } catch (e) {
    return json(res, 200, { error: 'provider_unavailable' });
  }
};
