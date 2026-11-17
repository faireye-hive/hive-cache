// src/utils/statsCalculators.js

import { allPosts, flaggedPosts, moderationSettings } from '../config.js';
import { formatDate, parseHiveDate, extractPostApp, normalizeAppName } from './helpers.js';
import { viewAuthorPosts, moderateAuthor } from '../ui/modals.js'; // Importar funções de ação
import { accountLinkHtml } from '../ui/accountInvestigation.js';
import { fetchHafStats, HAF_STATS_PATHS } from '../api/hafStatsService.js';


const chartInstances = {};
export let authorStatsMap = new Map();

// Mova loadRankingByPosts para cá
export function loadRankingByPosts() {
  const timeFilter = parseInt(
    document.getElementById("rankingTimeFilter").value
  );
  const cutoffDate = new Date(Date.now() - timeFilter * 60 * 60 * 1000);

  const authorStats = Object.create(null);

  allPosts.forEach((post) => {
    // ... corpo da função ...
    if (parseHiveDate(post.created) > cutoffDate) {
      if (!authorStats[post.author]) {
        authorStats[post.author] = {
          posts: 0,
          totalPayout: 0,
          lastPost: post.created,
        };
      }
      authorStats[post.author].posts++;
      authorStats[post.author].totalPayout += parseFloat(
        post.pending_payout_value || 0
      );
    }
  });

  const ranking = Object.entries(authorStats)
    .map(([author, stats]) => ({ author, ...stats }))
    .sort((a, b) => b.posts - a.posts)
    .slice(0, 100);

  displayRanking(ranking, "posts", "rankingPostsContainer");
}

const HOUR = 3600000;
const DAY = 24 * HOUR;
const PAYOUT_WEEK_HOURS = 7 * 24;
let weeklyPayoutCache;

function calculateAuthorPayouts(hours, now) {
  const windowMs = hours * HOUR;
  const cutoff = now - windowMs;
  const authors = new Map();
  let nextChange = Infinity;

  for (const post of allPosts) {
    const created = parseHiveDate(post.created).getTime();
    if (!post.author || !Number.isFinite(created) || created <= cutoff) continue;
    if (created > now) {
      nextChange = Math.min(nextChange, created);
      continue;
    }
    nextChange = Math.min(nextChange, created + windowMs);
    let stats = authors.get(post.author);
    if (!stats) {
      stats = { author: post.author, posts: 0, totalPayout: 0, lastPost: post.created, lastCreated: created };
      authors.set(post.author, stats);
    }
    stats.posts++;
    stats.totalPayout += payoutValue(post);
    if (created > stats.lastCreated) {
      stats.lastCreated = created;
      stats.lastPost = post.created;
    }
  }
  return { authors, nextChange };
}

function getWeeklyAuthorPayouts() {
  const now = Date.now();
  if (weeklyPayoutCache?.posts !== allPosts || now < weeklyPayoutCache.now || now >= weeklyPayoutCache.nextChange) {
    weeklyPayoutCache = { posts: allPosts, now, ...calculateAuthorPayouts(PAYOUT_WEEK_HOURS, now) };
  }
  return weeklyPayoutCache.authors;
}

export function getAuthorPendingPayout7d(author) {
  return getWeeklyAuthorPayouts().get(author)?.totalPayout;
}

export function loadRankingByPayout() {
  const filter = document.getElementById("payoutTimeFilter");
  filter.onchange = loadRankingByPayout;
  const hours = Number(filter.value);
  const authors = hours === PAYOUT_WEEK_HOURS
    ? getWeeklyAuthorPayouts()
    : calculateAuthorPayouts(hours, Date.now()).authors;
  const ranking = [...authors.values()]
    .sort((a, b) => b.totalPayout - a.totalPayout)
    .slice(0, 1500);

  displayRanking(ranking, "payout", "rankingPayoutContainer");
}

// Mova displayRanking para cá
function displayRanking(ranking, type, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  ranking.forEach((item, index) => {
    // ... corpo da função ...
    const div = document.createElement("div");
    div.className = "ranking-item";

    let rankClass = "";
    if (index === 0) rankClass = "first";
    else if (index === 1) rankClass = "second";
    else if (index === 2) rankClass = "third";

    div.innerHTML = `
            <div class="ranking-rank ${rankClass}">${index + 1}</div>
            <div class="ranking-info">
                <div class="ranking-author"></div>
                <div class="ranking-stats">
                    <span class="ranking-stat">
                        Posts: <strong>${item.posts}</strong>
                    </span>
                    <span class="ranking-stat">
                        Payout: <strong>$${item.totalPayout.toFixed(2)}</strong>
                    </span>
                    <span class="ranking-stat">
                        Last: ${formatDate(item.lastPost)}
                    </span>
                </div>
            </div>
            <div class="ranking-actions">
                <button type="button" class="btn-icon view-author" aria-label="View author posts">
                    <i class="fas fa-eye"></i>
                </button>
                <button type="button" class="btn-icon moderate-author" aria-label="Moderate author">
                    <i class="fas fa-user-shield"></i>
                </button>
            </div>
        `;
    div.querySelector('.ranking-author').innerHTML = accountLinkHtml(item.author);

    div
      .querySelector(".view-author")
      .addEventListener("click", () => viewAuthorPosts(item.author));
    div
      .querySelector(".moderate-author")
      .addEventListener("click", () => moderateAuthor(item.author));

    container.appendChild(div);
  });
}

export function loadStatistics() {
  document.getElementById('refreshHafStatsBtn').onclick = () => loadHafNetworkStatistics();
  document.getElementById('statsTimeFilter').onchange = () => {
    createCharts();
    loadHafNetworkStatistics();
  };
  document.getElementById('hafDauOperationType').onchange = () => loadHafNetworkStatistics('dau');

  updateCachedStatistics();
  loadHafNetworkStatistics();
}

export function updateCachedStatistics() {
  updateStatsSummary();
  createCharts();
  loadCacheStatus();
}

function statisticsPeriod() {
  const hours = Number(document.getElementById('statsTimeFilter').value);
  const days = hours / 24;
  const now = Date.now();
  const today = Math.floor(now / DAY) * DAY;
  const start = today - (days - 1) * DAY;
  return { start, today, now, bucketSize: days === 1 ? HOUR : DAY };
}

export function createCharts() {
  const { start, now, bucketSize } = statisticsPeriod();
  const counts = Array(Math.floor((now - start) / bucketSize) + 1).fill(0);
  let oldest = Infinity;
  const entries = allPosts.filter((post) => {
    const time = parseHiveDate(post.created).getTime();
    if (!Number.isFinite(time) || time <= 0 || time > now) return false;
    oldest = Math.min(oldest, time);
    if (time < start) return false;
    counts[Math.floor((time - start) / bucketSize)]++;
    return true;
  });
  const labels = counts.map((_, index) => {
    const date = new Date(start + index * bucketSize);
    return bucketSize === HOUR
      ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
      : formatNetworkDate(date);
  });
  const posts = entries.filter((post) => !post.parent_author);
  const categories = new Map();
  for (const post of posts) {
    const category = post.category || 'Uncategorized';
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }

  renderChart('postsPerHourChart', entries.length > 0, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Cached posts and comments',
        data: counts.map((count, index) => start + (index + 1) * bucketSize <= oldest ? null : count),
        borderColor: '#3157d5',
        backgroundColor: '#3157d522',
        fill: true,
      }],
    },
    options: lineOptions(),
  });
  renderCachedRanking('categoryDistributionChart', categories, 'Posts', '#3157d5');
  renderCachedRanking('topAppChart', Object.entries(countApps(entries)), 'Unique authors', '#138a63');
  renderTopTags(posts);
}

function topEntries(entries) {
  return [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
}

function renderCachedRanking(canvasId, entries, label, color) {
  const ranked = topEntries(entries);
  renderChart(canvasId, ranked.length > 0, {
    type: 'bar',
    data: {
      labels: ranked.map(([name]) => name),
      datasets: [{ label, data: ranked.map(([, count]) => count), backgroundColor: color, borderRadius: 3 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 } },
        y: { ticks: { callback(value) {
          const name = this.getLabelForValue(value);
          return name.length > 19 ? name.slice(0, 18) + '…' : name;
        } } },
      },
    },
  });
}

function renderTopTags(posts) {
  const counts = new Map();
  for (const post of posts) {
    const tags = Array.isArray(post.tags) ? post.tags : String(post.tags ?? '').split(/[,\s]+/);
    for (const tag of new Set(tags.map(tag => String(tag).trim().toLowerCase()).filter(Boolean))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const list = document.getElementById('topTagsList');
  const items = topEntries(counts).map(([tag, count]) => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    const value = document.createElement('strong');
    name.textContent = tag;
    value.textContent = formatStat(count);
    item.append(name, value);
    return item;
  });
  list.replaceChildren(...items);
  setText('topTagsStatus', items.length ? '' : 'No tags in cached posts for this period.');
}

function readNumber(row, field) {
  const raw = row?.[field];
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function sumField(rows, field) {
  const values = rows.map(row => readNumber(row, field)).filter(value => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function formatStat(value, decimals = 0, unit = '') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }) + unit;
}

function formatNetworkDate(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function renderChart(canvasId, hasData, config, messageText = '') {
  const canvas = document.getElementById(canvasId);
  const message = document.getElementById(canvasId + 'Status');
  chartInstances[canvasId]?.destroy();
  delete chartInstances[canvasId];

  const canRender = hasData && typeof Chart !== 'undefined';
  canvas.parentElement.classList.toggle('hidden', !canRender);
  message.textContent = hasData && !canRender
    ? 'Chart could not be loaded.'
    : messageText || (canRender ? '' : 'No data available for this period.');
  message.classList.toggle('hidden', !message.textContent);
  message.classList.toggle('chart-empty', !canRender);
  if (canRender) chartInstances[canvasId] = new Chart(canvas, config);
}

function lineOptions(percent = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { maxTicksLimit: 8 } },
      y: {
        beginAtZero: true,
        ticks: percent ? { callback: value => value + '%' } : { precision: 0 },
        ...(percent ? { suggestedMax: 100 } : {}),
      },
    },
  };
}

function renderNetworkChart(canvasId, rows, datasets, message, percent = false) {
  const hasData = rows.some(row => datasets.some(dataset => readNumber(row, dataset.field) !== null));
  const options = lineOptions(percent);
  options.plugins.legend = { display: datasets.length > 1, position: 'bottom', labels: { boxWidth: 10 } };
  if (datasets.some(dataset => dataset.axis === 'downvotes')) {
    options.scales.downvotes = {
      position: 'right',
      beginAtZero: true,
      grid: { drawOnChartArea: false },
      ticks: { color: '#b23745', precision: 0 },
    };
  }
  if (percent) {
    options.plugins.tooltip = { callbacks: {
      label: context => context.dataset.label + ': ' + formatStat(context.raw, 1, '%'),
    } };
  }
  renderChart(canvasId, hasData, {
    type: 'line',
    data: {
      labels: rows.map(row => formatNetworkDate(new Date(row.period))),
      datasets: datasets.map(({ label, field, color, axis }) => ({
        label,
        data: rows.map(row => readNumber(row, field)),
        yAxisID: axis || 'y',
        borderColor: color,
        backgroundColor: color + '22',
        borderWidth: 2,
        pointRadius: rows.length > 14 ? 1 : 3,
        fill: datasets.length === 1,
      })),
    },
    options,
  }, message);
}

function renderTopAccounts(rows, message) {
  const body = document.getElementById('hafTopAccountsBody');
  const elements = rows.map((row) => {
    const tr = document.createElement('tr');
    for (const value of [formatStat(readNumber(row, 'rank')), '@' + row.account, formatStat(readNumber(row, 'op_count'))]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    return tr;
  });
  body.replaceChildren(...elements);
  setText('hafAccountsStatus', message);
}

function renderDau(rows, message, params) {
  const latest = rows.at(-1);
  setText('hafDauValue', formatStat(readNumber(latest, 'active_accounts')));
  const category = params.operation_types === 'all' ? 'All operations' : params.operation_types;
  const caption = latest ? formatNetworkDate(new Date(latest.period)) + ' UTC · ' + category : category;
  setText('hafDauCaption', caption);
  renderNetworkChart('hafDauChart', rows, [
    { label: 'Active accounts', field: 'active_accounts', color: '#3157d5' },
  ], message);
}

function renderContent(rows, message) {
  setText('hafPostsValue', formatStat(sumField(rows, 'posts')));
  setText('hafCommentsValue', formatStat(sumField(rows, 'comments')));
  renderNetworkChart('hafContentChart', rows, [
    { label: 'Posts', field: 'posts', color: '#3157d5' },
    { label: 'Comments', field: 'comments', color: '#138a63' },
  ], message);
}

function renderVotes(rows, message) {
  renderNetworkChart('hafVotesChart', rows, [
    { label: 'Total votes', field: 'total_votes', color: '#7651b5' },
    { label: 'Upvotes', field: 'upvotes', color: '#138a63' },
    { label: 'Downvotes (right axis)', field: 'downvotes', color: '#b23745', axis: 'downvotes' },
  ], message);
}

function renderEngagement(rows, message) {
  let weightedVotes = 0;
  let postCount = 0;
  for (const row of rows) {
    const posts = readNumber(row, 'total_posts');
    const average = readNumber(row, 'avg_votes_per_post');
    if (posts > 0 && average !== null) {
      weightedVotes += average * posts;
      postCount += posts;
    }
  }
  setText('hafVotesPerPostValue', formatStat(postCount ? weightedVotes / postCount : null, 2));
  renderNetworkChart('hafEngagementChart', rows, [
    { label: 'Without votes', field: 'zero_vote_post_pct', color: '#7651b5' },
    { label: 'Without replies', field: 'zero_comment_post_pct', color: '#b23745' },
  ], message, true);
}

function renderGovernance(rows, message) {
  const row = rows[0];
  setText('hafGiniValue', formatStat(readNumber(row, 'gini'), 4));
  setText('hafTop1ShareValue', formatStat(readNumber(row, 'top_1pct_hp_share'), 2, '%'));
  setText('hafTop10ShareValue', formatStat(readNumber(row, 'top_10pct_hp_share'), 2, '%'));
  setText('hafHpHoldersValue', formatStat(readNumber(row, 'total_hp_holders')));
  setText('hafMedianHpValue', formatStat(readNumber(row, 'median_hp'), 2, ' HP'));
  setText('hafMeanHpValue', formatStat(readNumber(row, 'mean_hp'), 2, ' HP'));
  setText('hafGovernanceStatus', message);
}

const networkMetrics = {
  dau: { path: HAF_STATS_PATHS.dailyActiveUsers, render: renderDau, field: 'active_accounts' },
  content: { path: HAF_STATS_PATHS.contentVolume, render: renderContent, field: 'posts' },
  votes: { path: HAF_STATS_PATHS.voteStats, render: renderVotes, field: 'total_votes' },
  engagement: { path: HAF_STATS_PATHS.engagement, render: renderEngagement, field: 'total_posts' },
  accounts: { path: HAF_STATS_PATHS.topAccounts, render: renderTopAccounts, field: 'op_count' },
  governance: { path: HAF_STATS_PATHS.influenceConcentration, render: renderGovernance, field: 'total_hp_holders' },
};
const networkRequests = new Map();

function loadHafNetworkStatistics(only) {
  const { start, today } = statisticsPeriod();
  const dates = {
    from_date: new Date(start).toISOString().slice(0, 10),
    to_date: new Date(today).toISOString().slice(0, 10),
  };
  const daily = { ...dates, granularity: 'day' };
  const params = {
    dau: { ...daily, operation_types: document.getElementById('hafDauOperationType').value },
    content: daily,
    votes: daily,
    engagement: daily,
    accounts: { ...dates, metric: 'transaction_count', limit_count: 10 },
    governance: {},
  };
  for (const key of only ? [only] : Object.keys(networkMetrics)) {
    loadNetworkMetric(key, params[key]);
  }
}

async function loadNetworkMetric(key, params) {
  const { path, render, field } = networkMetrics[key];
  const previous = networkRequests.get(key);
  previous?.controller.abort();

  const controller = new AbortController();
  const query = new URLSearchParams(params).toString();
  const sameQuery = previous?.query === query;
  const state = {
    controller,
    query,
    pending: true,
    rows: sameQuery ? previous.rows : [],
    updatedAt: sameQuery ? previous.updatedAt : null,
  };
  networkRequests.set(key, state);
  render(state.rows, state.rows.length ? 'Refreshing…' : 'Loading…', params);
  updateNetworkStatus();

  let message = '';
  try {
    const rows = await fetchHafStats(path, params, controller.signal);
    if (controller.signal.aborted) return;
    if (!Array.isArray(rows) || rows.some(row =>
      readNumber(row, field) === null ||
      (params.granularity && !/^\d{4}-\d{2}-\d{2}$/.test(row.period)) ||
      (key === 'accounts' && typeof row.account !== 'string')
    )) {
      throw new Error('Unexpected response from Hive');
    }
    state.rows = params.granularity
      ? rows.sort((a, b) => a.period.localeCompare(b.period))
      : rows;
    state.updatedAt = rows.length ? new Date() : null;
    if (!rows.length) message = 'No data available for this metric.';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.error = error.name === 'TimeoutError' ? 'Hive request timed out' : error.message;
    message = state.rows.length
      ? 'Refresh failed. Showing the last loaded data.'
      : state.error.split(' · ')[0] + '. Use Refresh Network Data to try again.';
  }

  state.pending = false;
  updateNetworkStatus();
  render(state.rows, message, params);
}

function updateNetworkStatus() {
  const states = [...networkRequests.values()];
  const pending = states.some(state => state.pending);
  const available = states.filter(state => state.rows.length).length;
  const failures = Object.entries(networkMetrics).flatMap(([key, metric]) => {
    const error = networkRequests.get(key)?.error;
    return error ? [metric.path + ': ' + error] : [];
  });
  const total = Object.keys(networkMetrics).length;
  const status = document.getElementById('hafStatsStatus');
  status.textContent = pending ? 'Updating network data…'
    : available === total && !failures.length ? 'Live network data'
    : available ? 'Partial network data'
    : 'Network data unavailable';
  status.title = failures.join('\n');
  status.classList.toggle('is-error', !pending && Boolean(failures.length));
  document.getElementById('refreshHafStatsBtn').disabled = pending;
  const updated = Math.max(...states.map(state => state.updatedAt?.getTime() ?? 0));
  setText('hafStatsUpdatedAt', updated ? ' · Last response ' + new Date(updated).toLocaleTimeString() : '');
}

let cacheStatusRequest = 0;
async function loadCacheStatus() {
  const request = ++cacheStatusRequest;
  try {
    const response = await fetch('/api/blockchain-status', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Cache status unavailable');
    const { sync, file } = await response.json();
    if (request !== cacheStatusRequest) return;
    const updated = sync?.lastSyncTime ?? file?.modifiedAt;
    setText('cacheLastUpdate', updated ? formatDate(updated) : '—');
    setText('cacheUpdateTime', sync?.lastSyncTime ? formatStat(sync.lastDurationMs / 1000, 1, ' s') : '—');
    setText('cacheStatus', sync?.isSyncing ? 'Syncing…' : sync?.lastError ? 'Last sync failed' : file ? 'Available' : 'Empty');
  } catch {
    if (request !== cacheStatusRequest) return;
    setText('cacheLastUpdate', '—');
    setText('cacheUpdateTime', '—');
    setText('cacheStatus', 'Unavailable');
  }
}

export function updateStatsSummary() {
  const posts = allPosts.filter(post => !post.parent_author);
  const authorCounts = new Map();
  let flaggedCount = 0;
  let plagiarismFlags = 0;
  let deletedPosts = 0;
  let highPayoutPosts = 0;
  const threshold = moderationSettings.payoutAlertThreshold ?? 100;

  for (const post of allPosts) {
    const flag = Object.hasOwn(flaggedPosts, post.id) ? flaggedPosts[post.id] : null;
    if (flag) flaggedCount++;
    if (flag?.reason === 'Possible plagiarism') plagiarismFlags++;
  }
  for (const post of posts) {
    if (post.author) authorCounts.set(post.author, (authorCounts.get(post.author) ?? 0) + 1);
    if (post.deleted) deletedPosts++;
    if (payoutValue(post) > threshold) highPayoutPosts++;
  }

  setText('totalPostsCount', formatStat(posts.length));
  setText('avgPayout', '$' + formatStat(calculateAveragePayout(posts), 2));
  setText('cacheStatsCount', formatStat(allPosts.length));
  setText('avgPostsPerAuthor', formatStat(authorCounts.size ? posts.length / authorCounts.size : 0, 1));
  setText('deletionRate', formatStat(posts.length ? deletedPosts / posts.length * 100 : 0, 1, '%'));
  setText('flagRate', formatStat(allPosts.length ? flaggedCount / allPosts.length * 100 : 0, 1, '%'));
  setText('similarContent', formatStat(plagiarismFlags));
  setText('highPayoutPosts', formatStat(highPayoutPosts));
  setText('multiPostAuthors', formatStat([...authorCounts.values()].filter(count => count > 3).length));
}

export function countApps(posts) {
  const accountsByApp = new Map();
  for (const post of posts) {
    if (!post.author) continue;
    const normalized = normalizeAppName(extractPostApp(post));
    const app = normalized && normalized !== 'desconhecido' ? normalized : 'Unknown';
    if (!accountsByApp.has(app)) accountsByApp.set(app, new Set());
    accountsByApp.get(app).add(post.author);
  }
  return Object.fromEntries([...accountsByApp].map(([app, accounts]) => [app, accounts.size]));
}

export function payoutValue(post) {
  const value = Number.parseFloat(post.pending_payout_value);
  return Number.isFinite(value) ? value : 0;
}

export function calculateAveragePayout(posts = allPosts) {
  return posts.length ? posts.reduce((sum, post) => sum + payoutValue(post), 0) / posts.length : 0;
}

export function precalculateAuthorStats() {
  const stats = new Map();

  allPosts.forEach(post => {
    const author = post.author;
    
    // Inicializar o objeto de estatísticas se o autor for novo
    if (!stats.has(author)) {
      stats.set(author, {
        postCount: 0,
        shortPostCount: 0,
        // Você pode adicionar outras estatísticas aqui, como totalPayout
      });
    }

    const currentStats = stats.get(author);
    currentStats.postCount++;

    // Verificar posts curtos (usando a função de escape que está no helpers.js)
    if ( (post.body || "").length < 50 ) {
      currentStats.shortPostCount++;
    }
  });

  authorStatsMap = stats;
  // console.log("Estatísticas de Autor pré-calculadas.");
}
