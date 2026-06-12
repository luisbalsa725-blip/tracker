// GET /api/apple  — returns the latest Apple Watch / manual vitals payload.
// POST /api/apple — stores a vitals payload sent by an iPhone Shortcut.
//
// Storage is intentionally simple and uses the same Supabase env vars as db.js:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//
// Expected table: app_state(key text primary key, data jsonb, updated_at timestamptz)
// The payload shape mirrors the dashboard's patron_health_v1 object.

const SNAP_KEY = 'patron-apple-vitals';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_ANON_KEY || '').trim();
  return { url, key, ok: !!(url && key) };
}

async function supabaseFetch(path, options) {
  const cfg = supabaseConfig();
  if (!cfg.ok) {
    const e = new Error('SUPABASE_NOT_CONFIGURED');
    e.code = 'SUPABASE_NOT_CONFIGURED';
    throw e;
  }
  return fetch(cfg.url.replace(/\/$/, '') + '/rest/v1' + path, {
    ...options,
    headers: {
      apikey: cfg.key,
      Authorization: 'Bearer ' + cfg.key,
      'content-type': 'application/json',
      ...(options && options.headers ? options.headers : {}),
    },
  });
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v) {
  return v == null || v === '' ? null : String(v);
}

function normalize(input) {
  const source = input && input.source === 'manual' ? 'manual' : 'apple';
  const target = num(input && input.sleepTargetHours) || 8;
  const sleepHours = num(input && input.sleepHours);
  const sleepPerf = num(input && input.sleepPerf);
  return {
    source,
    connected: true,
    ts: num(input && input.ts) || Date.now(),
    recovery: num(input && input.recovery),
    sleepHours,
    sleepPerf: sleepPerf != null ? Math.round(sleepPerf) : (sleepHours != null ? Math.round(Math.min(100, (sleepHours / target) * 100)) : null),
    sleepTargetHours: target,
    bedtime: text(input && input.bedtime),
    wakeTime: text(input && input.wakeTime),
    hrv: num(input && input.hrv),
    rhr: num(input && input.rhr),
    strain: num(input && input.strain),
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET') {
    try {
      const r = await supabaseFetch('/app_state?key=eq.' + encodeURIComponent(SNAP_KEY) + '&select=data', {
        method: 'GET',
        headers: { accept: 'application/vnd.pgrst.object+json' },
      });
      if (r.status === 406 || r.status === 404) return json(res, 200, { connected: false });
      const j = await r.json().catch(() => null);
      const data = j && j.data;
      return json(res, 200, data && data.connected ? data : { connected: false });
    } catch (e) {
      return json(res, 200, { connected: false, error: e.code === 'SUPABASE_NOT_CONFIGURED' ? 'not_configured' : 'unavailable' });
    }
  }

  if (req.method === 'POST') {
    try {
      const payload = normalize(await readBody(req));
      const r = await supabaseFetch('/app_state', {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          key: SNAP_KEY,
          data: payload,
          updated_at: new Date(payload.ts).toISOString(),
        }),
      });
      if (!r.ok) return json(res, 500, { ok: false, error: 'store_failed' });
      return json(res, 200, { ok: true, ...payload });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.code === 'SUPABASE_NOT_CONFIGURED' ? 'not_configured' : 'unavailable' });
    }
  }

  res.setHeader('allow', 'GET,POST,OPTIONS');
  return json(res, 405, { error: 'method_not_allowed' });
};
