const HAF_STATS_PATHS = Object.freeze({
  dailyActiveUsers: 'network/daily-active-users',
  contentVolume: 'network/content-volume',
  voteStats: 'network/vote-stats',
  engagement: 'network/engagement',
  topAccounts: 'network/top-accounts',
  influenceConcentration: 'governance/influence-concentration',
});
const HAF_STATS_API_BASE = 'https://api.hive.blog/haf-stats-api/';
const accountStatsPaths = new Set(['content-stats', 'financial-summary', 'community-activity']);

export function normalizeHiveAccount(value) {
  const account = String(value ?? '').trim().toLowerCase().replace(/^@/, '');
  if (account.length < 3 || account.length > 16) return null;
  return /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(account) ? account : null;
}

export async function fetchHafStats(endpoint, params = {}, signal) {
  if (!Object.values(HAF_STATS_PATHS).includes(endpoint)) {
    throw new Error('Unsupported HAF Stats endpoint');
  }

  return fetchHiveJson(new URL(endpoint, HAF_STATS_API_BASE), params, signal);
}

export async function fetchHafAccountStats(account, endpoint, params, signal) {
  const name = normalizeHiveAccount(account);
  if (!name || !accountStatsPaths.has(endpoint)) throw new Error('Invalid HAF Stats account request');
  return fetchHiveJson(new URL(`account/${name}/${endpoint}`, HAF_STATS_API_BASE), params, signal);
}

export async function fetchHiveJson(url, params = {}, signal) {
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const timeout = AbortSignal.timeout(18000);
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(`HTTP ${response.status}${detail ? ` · ${detail}` : ''}`);
  }

  return response.json();
}

export { HAF_STATS_PATHS };
