import { fetchHiveJson, normalizeHiveAccount } from './hafStatsService.js';

const HIVE_API = 'https://api.hive.blog/';
const OPERATIONS_PAGE_SIZE = 20;
const HISTORY_TYPES = { votes: 0, transfers: 2 };
const DELEGATION_LIMIT = 1000;

function accountUrl(prefix, account, suffix = '') {
  const name = normalizeHiveAccount(account);
  if (!name) throw new Error('Invalid Hive account');
  return new URL(`${prefix}/accounts/${name}${suffix}`, HIVE_API);
}

export function fetchAccountInfo(account, signal) {
  return fetchHiveJson(accountUrl('hafbe-api', account), {}, signal);
}

export async function fetchAccountCreation(account, signal) {
  const result = await fetchHiveJson(accountUrl('hafah-api', account, '/operations'), {
    'operation-types': '9,23,41,80',
    'page-size': 10,
    page: 1,
  }, signal);
  if (!Array.isArray(result.operations_result)) throw new Error('Invalid account history');
  return result.operations_result.reverse().find(row =>
    row.op?.value?.new_account_name === account && normalizeHiveAccount(row.op?.value?.creator)
  );
}

export async function fetchAccountHistory(account, type, { from, to, direction, page }, signal) {
  const operationType = HISTORY_TYPES[type];
  if (!Object.hasOwn(HISTORY_TYPES, type)) throw new Error('Invalid history type');
  const blockTime = date => date.toISOString().slice(0, 19).replace('T', ' ');
  const params = {
    'operation-types': operationType,
    'page-size': OPERATIONS_PAGE_SIZE,
    'from-block': blockTime(from),
    'to-block': blockTime(to),
    page,
  };
  if (direction !== 'all') {
    params['transacting-account-name'] = account;
    params['participation-mode'] = direction === 'outgoing' ? 'include' : 'exclude';
  }
  const result = await fetchHiveJson(accountUrl('hafah-api', account, '/operations'), params, signal);
  if (!Array.isArray(result.operations_result) ||
      !Number.isInteger(result.total_pages) || !Number.isInteger(result.total_operations)) {
    throw new Error('Invalid account history response');
  }
  return {
    rows: result.operations_result,
    page: page ?? result.total_pages,
    totalPages: result.total_pages,
    count: result.total_operations,
  };
}

async function hiveRpc(method, params, signal) {
  const response = await fetch(HIVE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
  });
  if (!response.ok) throw new Error(`Hive RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error || payload.result == null) throw new Error('Hive RPC returned no result');
  return payload.result;
}

export async function fetchOutgoingDelegations(account, signal) {
  const [delegations, properties] = await Promise.allSettled([
    hiveRpc('condenser_api.get_vesting_delegations', [account, '', DELEGATION_LIMIT], signal),
    hiveRpc('condenser_api.get_dynamic_global_properties', [], signal),
  ]);
  if (!Array.isArray(delegations.value)) throw new Error('Delegations unavailable');
  const hive = parseFloat(properties.value?.total_vesting_fund_hive);
  const vests = parseFloat(properties.value?.total_vesting_shares);
  const ratio = hive > 0 && vests > 0 ? hive / vests : null;
  return { rows: delegations.value, ratio, limited: delegations.value.length === DELEGATION_LIMIT };
}
