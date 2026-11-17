import { fetchHafAccountStats, normalizeHiveAccount } from '../api/hafStatsService.js';
import { fetchAccountInfo, fetchAccountCreation, fetchAccountHistory, fetchOutgoingDelegations } from '../api/accountInvestigationService.js';
import { escapeHTML, renderPublicationTime } from '../utils/helpers.js';

const DAY = 86400000;
const countFormat = new Intl.NumberFormat('en-US');
const tokenFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
const monthFormat = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const get = id => document.getElementById(id);
let current;
let overviewRequest;
let detailRequest;
let previousAccounts = [];

export function accountLinkHtml(value, className = '') {
  const account = normalizeHiveAccount(value);
  if (!account) return value ? escapeHTML(`@${value}`) : '—';
  return `<button type="button" class="account-link ${escapeHTML(className)}" data-investigate-account="${account}">@${account}</button>`;
}

export function initAccountInvestigation() {
  const dialog = get('accountInvestigation');
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-investigate-account]');
    if (!trigger) return;
    const account = normalizeHiveAccount(trigger.dataset.investigateAccount);
    if (!account || account === current?.account) return;
    if (dialog.open) previousAccounts.push(current.account);
    openAccount(account);
  });

  dialog.addEventListener('close', () => {
    stopRequests();
    current = null;
    previousAccounts = [];
  });
  get('accountInvestigationBack').addEventListener('click', () => openAccount(previousAccounts.pop()));
  get('accountInvestigationPeriod').addEventListener('change', loadOverviewStats);
  dialog.querySelector('.account-investigation-nav').addEventListener('click', event => {
    const view = event.target.closest('[data-investigation-view]')?.dataset.investigationView;
    if (view && current.view !== view) selectView(view);
  });
}

function stopRequests() {
  current?.controller.abort();
  overviewRequest?.abort();
  detailRequest?.abort();
}

function openAccount(account) {
  stopRequests();
  current = { account, now: Date.now(), controller: new AbortController() };
  const dialog = get('accountInvestigation');
  const title = get('accountInvestigationTitle');
  title.textContent = `Investigate @${account}`;
  get('accountInvestigationProfile').href = `https://hive.blog/@${account}`;
  get('accountInvestigationBack').hidden = previousAccounts.length === 0;
  selectView('overview');
  if (!dialog.open) dialog.showModal();
  title.focus();
  renderAsync(get('accountIdentity'), current.controller.signal, () => renderIdentity(current));
  loadOverviewStats();
}

function selectView(view) {
  detailRequest?.abort();
  current.view = view;
  const dialog = get('accountInvestigation');
  for (const button of dialog.querySelectorAll('[data-investigation-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.investigationView === view));
  }
  for (const panel of dialog.querySelectorAll('[data-investigation-panel]')) {
    panel.hidden = panel.dataset.investigationPanel !== view;
  }
  dialog.querySelector('.account-investigation-body').scrollTop = 0;
  if (view === 'votes' || view === 'transfers') openHistory(view);
  if (view === 'delegations') {
    const panel = dialog.querySelector('[data-investigation-panel="delegations"]');
    detailRequest = new AbortController();
    const { signal } = detailRequest;
    renderAsync(panel, signal, async () => renderDelegations(await fetchOutgoingDelegations(current.account, signal)));
  }
}

async function renderAsync(container, signal, render) {
  container.innerHTML = '<p class="account-investigation-status" role="status">Loading Hive data…</p>';
  try {
    const html = await render();
    if (!signal.aborted) container.innerHTML = html;
  } catch {
    if (!signal.aborted) {
      container.innerHTML = `<p class="account-investigation-status" role="status">Hive data unavailable.
        <button type="button" class="account-link">Retry</button></p>`;
      container.querySelector('button').addEventListener('click', () => renderAsync(container, signal, render));
    }
  }
}

function number(value, format = countFormat) {
  return value != null && Number.isFinite(Number(value)) ? format.format(Number(value)) : '—';
}

function asset(value, precision, symbol) {
  return value != null && Number.isFinite(Number(value))
    ? `${number(Number(value) / 10 ** precision, tokenFormat)} ${symbol}`
    : '—';
}

function transactionLink(id) {
  if (!/^[a-f0-9]{40}$/.test(id ?? '')) return '—';
  return `<a href="https://hivescan.info/transaction/${id}" target="_blank" rel="noopener noreferrer">Transaction ↗</a>`;
}

function dateText(value) {
  return renderPublicationTime(value ? String(value).replace(' ', 'T') : null);
}

function definitions(values) {
  return `<dl class="account-investigation-metrics">${values.map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function table(columns, rows, emptyMessage) {
  if (!rows.length) return `<p class="account-investigation-status">${emptyMessage}</p>`;
  return `<div class="account-investigation-table" tabindex="0">
    <table><thead><tr>${columns.map(column => `<th scope="col">${column}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>
  </div>`;
}

async function renderIdentity({ account, controller: { signal } }) {
  const [profile, creation] = await Promise.allSettled([
    fetchAccountInfo(account, signal),
    fetchAccountCreation(account, signal),
  ]);
  const info = profile.value;
  const operation = creation.value;
  if (profile.status === 'rejected' && creation.status === 'rejected') throw new Error('Account unavailable');
  return definitions([
    ['Created', info?.created || operation?.timestamp ? dateText(info?.created || operation.timestamp) : 'Unavailable'],
    ['Created by', operation ? accountLinkHtml(operation.op.value.creator) : creation.status === 'fulfilled' ? 'No creation record found' : 'Unavailable'],
    ['Creation record', operation ? transactionLink(operation.trx_id) : '—'],
    ['Recovery account', accountLinkHtml(info?.recovery_account)],
    ['Reputation', number(info?.reputation)],
    ['Staked HP', asset(info?.vesting_balance, 3, 'HP')],
    ['Liquid HIVE', asset(info?.balance, 3, 'HIVE')],
    ['Liquid HBD', asset(info?.hbd_balance, 3, 'HBD')],
  ]);
}

function loadOverviewStats() {
  overviewRequest?.abort();
  overviewRequest = new AbortController();
  const { signal } = overviewRequest;
  const { account, now } = current;
  const days = Number(get('accountInvestigationPeriod').value);
  const bounds = {
    from_date: new Date(now - (days - 1) * DAY).toISOString().slice(0, 10),
    to_date: new Date(now).toISOString().slice(0, 10),
  };

  const sections = [
    ['accountActivity', 'content-stats', renderActivity],
    ['accountFinance', 'financial-summary', renderFinance],
    ['accountCommunities', 'community-activity', renderCommunities],
  ];
  for (const [id, endpoint, render] of sections) {
    const params = endpoint === 'community-activity' ? bounds : { ...bounds, granularity: 'month' };
    renderAsync(get(id), signal, async () => {
      const rows = await fetchHafAccountStats(account, endpoint, params, signal);
      if (!Array.isArray(rows)) throw new Error('Hive returned an invalid summary');
      return render(rows);
    });
  }
}

function month(value) {
  const date = new Date(value ?? NaN);
  return Number.isFinite(date.getTime()) ? monthFormat.format(date) : '—';
}

const activityFields = [
  ['Posts', 'posts'], ['Comments', 'comments'], ['Votes cast', 'votes_cast'],
  ['Votes received', 'votes_received'], ['Replies received', 'replies_received'],
];

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function renderActivity(rows) {
  if (!rows.length) return '<p class="account-investigation-status">No content or engagement in this period.</p>';
  const metrics = activityFields.map(([label, key]) => [label, number(sum(rows, key))]);
  metrics.push(['Author rewards', [
    asset(sum(rows, 'author_reward_hive_nai'), 3, 'HIVE'),
    asset(sum(rows, 'author_reward_hbd_nai'), 3, 'HBD'),
    asset(sum(rows, 'author_reward_vests_nai'), 6, 'VESTS'),
  ].join(' · ')]);
  return definitions(metrics) +
    table(['Month', ...activityFields.map(([label]) => label), 'Author rewards'], rows.slice().reverse().map(row => [
      month(row.period), ...activityFields.map(([, key]) => number(row[key])),
      [asset(row.author_reward_hive_nai, 3, 'HIVE'), asset(row.author_reward_hbd_nai, 3, 'HBD'),
        asset(row.author_reward_vests_nai, 6, 'VESTS')].join('<br>'),
    ]), '');
}

function renderFinance(rows) {
  if (!rows.length) return '<p class="account-investigation-status">No financial activity in this period.</p>';
  const transfers = rows.filter(row => row.category === 'transfer_operation');
  const totals = ['incoming', 'outgoing'].map(direction => {
    const matching = transfers.filter(row => row.direction === direction);
    return [direction === 'incoming' ? 'Direct transfers received' : 'Direct transfers sent',
      `${asset(sum(matching, 'hive_nai'), 3, 'HIVE')} · ${asset(sum(matching, 'hbd_nai'), 3, 'HBD')}<br>
       <small>${number(sum(matching, 'op_count'))} operations</small>`];
  });
  return definitions(totals) + `<details><summary>Monthly breakdown by operation</summary>${table(
    ['Month', 'Operation', 'Direction', 'HIVE', 'HBD', 'VESTS', 'Count'],
    rows.slice().reverse().map(row => [
      month(row.period), escapeHTML(String(row.category ?? '').replace(/_operation$/, '').replaceAll('_', ' ')),
      escapeHTML(row.direction), number(Number(row.hive_nai) / 1000, tokenFormat),
      number(Number(row.hbd_nai) / 1000, tokenFormat), number(Number(row.vests_nai) / 1000000, tokenFormat), number(row.op_count),
    ]), '')}</details>`;
}

function renderCommunities(rows) {
  const ranked = rows.slice().sort((a, b) => b.post_count - a.post_count || b.comment_count - a.comment_count);
  return table(['Community', 'Posts', 'Comments'], ranked.map(row => {
    const title = escapeHTML(row.community ? row.title || row.community : 'Personal blog');
    const name = /^hive-\d+$/.test(row.community ?? '') ?
      `<a href="https://hive.blog/trending/${row.community}" target="_blank" rel="noopener noreferrer">${title}</a>` : title;
    return [name, number(row.post_count), number(row.comment_count)];
  }), 'No community activity in this period.');
}

function openHistory(type) {
  const panel = get('accountInvestigation').querySelector(`[data-investigation-panel="${type}"]`);
  const isVotes = type === 'votes';
  panel.innerHTML = `<div class="account-investigation-card">
    <div class="account-investigation-period">
      <label for="accountHistoryDirection-${type}">${isVotes ? 'Vote direction' : 'Transfer direction'}</label>
      <select id="accountHistoryDirection-${type}">
        <option value="all">All</option>
        <option value="incoming">Received</option>
        <option value="outgoing">Sent</option>
      </select>
    </div>
    <div class="account-history-results"></div>
  </div>`;

  const direction = panel.querySelector('select');
  const results = panel.querySelector('.account-history-results');
  const { account, now } = current;
  const from = new Date(now - (isVotes ? 7 : 30) * DAY);
  const to = new Date(now);
  async function load(page) {
    detailRequest?.abort();
    detailRequest = new AbortController();
    const { signal } = detailRequest;
    await renderAsync(results, signal, async () => {
      const history = await fetchAccountHistory(account, type, { from, to, direction: direction.value, page }, signal);
      if (!history.rows.length) return '<p class="account-investigation-status">No matching operations in this period.</p>';
      const entries = isVotes ? renderVotes(history.rows, account) : renderTransfers(history.rows, account);
      return `<p class="account-investigation-status">${number(history.count)} operations</p>
        ${entries}
        <div class="account-investigation-pages">
          <button type="button" class="btn-action" data-page="${history.page + 1}" ${history.page >= history.totalPages ? 'disabled' : ''}>Newer</button>
          <span>Page ${number(history.totalPages - history.page + 1)} of ${number(history.totalPages)}</span>
          <button type="button" class="btn-action" data-page="${history.page - 1}" ${history.page <= 1 ? 'disabled' : ''}>Older</button>
        </div>`;
    });
  }
  direction.addEventListener('change', () => load());
  results.addEventListener('click', event => {
    const button = event.target.closest('[data-page]');
    if (button) load(Number(button.dataset.page));
  });
  load();
}

function renderVotes(rows, account) {
  return table(['Date', 'Direction', 'Account', 'Vote weight', 'Evidence'], rows.map(row => {
    const { voter, author, weight, permlink } = row.op?.value ?? {};
    const direction = voter === account ? author === account ? 'Self' : 'Sent' : 'Received';
    const weightLabel = Number(weight) === 0 ? 'Removed' : `${number(Number(weight) / 100, tokenFormat)}%`;
    const authorName = normalizeHiveAccount(author);
    const postLink = authorName && typeof permlink === 'string' && permlink && !['.', '..'].includes(permlink)
      ? `<a href="https://hive.blog/@${authorName}/${encodeURIComponent(permlink)}" target="_blank" rel="noopener noreferrer">Post ↗</a>` : '—';
    return [dateText(row.timestamp), direction, accountLinkHtml(voter === account ? author : voter), weightLabel, `${postLink}<br>${transactionLink(row.trx_id)}`];
  }), '');
}

function renderTransfers(rows, account) {
  return table(['Date', 'Direction', 'Account', 'Amount', 'Memo', 'Evidence'], rows.map(row => {
    const { from, to, amount, memo } = row.op?.value ?? {};
    const symbol = amount?.nai === '@@000000021' ? 'HIVE' : amount?.nai === '@@000000013' ? 'HBD' : '';
    const quantity = typeof amount === 'string' ? escapeHTML(amount) :
      symbol ? asset(amount.amount, amount.precision, symbol) : '—';
    return [dateText(row.timestamp), from === account ? to === account ? 'Self' : 'Sent' : 'Received',
      accountLinkHtml(from === account ? to : from), quantity,
      escapeHTML(memo) || '—', transactionLink(row.trx_id)];
  }), '');
}

function renderDelegations({ rows, ratio, limited }) {
  const ranked = rows.slice().sort((a, b) => parseFloat(b.vesting_shares) - parseFloat(a.vesting_shares));
  const total = ranked.reduce((value, row) => value + (parseFloat(row.vesting_shares) || 0), 0);
  const hp = value => ratio == null ? 'Unavailable' : `${number(value * ratio, tokenFormat)} HP`;
  return `<div class="account-investigation-card">
    <h3>Active outgoing delegations</h3>
    ${rows.length ? definitions([
      [limited ? 'Listed delegations (API limit)' : 'Recipients', number(rows.length)],
      ['Delegated Hive Power (estimate)', hp(total)],
    ]) : ''}
    ${table(['Delegatee', 'Hive Power (estimate)', 'VESTS'], ranked.map(row => [
      accountLinkHtml(row.delegatee), hp(parseFloat(row.vesting_shares)), escapeHTML(row.vesting_shares),
    ]), 'No active outgoing delegations.')}
  </div>`;
}
