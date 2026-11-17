import { allPosts } from '../config.js';
import { getBlacklistListMemberships, subscribeToBlacklistUpdates } from '../api/onchainBlacklistService.js';
import { accountLinkHtml } from '../ui/accountInvestigation.js';
import { showPostDetail } from '../ui/modals.js';
import { canDownvotePost, openBulkDownvoteModal, openDownvoteModal } from '../ui/downvoteModal.js';
import { escapeHTML, formatPendingPayout, parseHiveDate, renderPublicationTime } from '../utils/helpers.js';
import { payoutValue } from '../utils/statsCalculators.js';

const PAGE_SIZE = 15;
const PAYOUT_SCALE = 1000;
let ranking = [];
let page = 1;
let indexedPosts;
let memberships;

export function initBlacklistRanking() {
  const updateFilters = () => {
    page = 1;
    renderBlacklistRanking();
  };
  for (const id of ['Author', 'Minimum']) {
    document.getElementById('blacklistRanking' + id).addEventListener('input', updateFilters);
  }
  for (const id of ['Period', 'Content', 'Source']) {
    document.getElementById('blacklistRanking' + id).addEventListener('change', updateFilters);
  }
  for (const [id, direction] of [['Previous', -1], ['Next', 1]]) {
    document.getElementById('blacklistRanking' + id).addEventListener('click', () => {
      page += direction;
      renderPage();
    });
  }
  subscribeToBlacklistUpdates(() => {
    indexedPosts = undefined;
    refreshBlacklistRanking();
  });
}

export function refreshBlacklistRanking() {
  if (document.getElementById('moderation-section').classList.contains('active')) {
    renderBlacklistRanking();
  }
}

export function renderBlacklistRanking() {
  if (indexedPosts !== allPosts) indexBlacklistMemberships();
  const query = document.getElementById('blacklistRankingAuthor').value.trim().toLowerCase().replace(/^@/, '');
  const period = document.getElementById('blacklistRankingPeriod').value;
  const content = document.getElementById('blacklistRankingContent').value;
  const source = document.getElementById('blacklistRankingSource').value;
  const minimum = document.getElementById('blacklistRankingMinimum').valueAsNumber || 0;
  const minimumMilliPayout = Math.round(minimum * PAYOUT_SCALE);
  const now = Date.now();
  const cutoff = period === 'all' ? -Infinity : now - Number(period) * 3600000;
  const authors = new Map();

  for (const post of allPosts) {
    const author = post.author;
    if (!author || !author.includes(query) || post.deleted === true) continue;
    if (content === 'posts' && post.parent_author) continue;
    if (content === 'comments' && !post.parent_author) continue;

    const lists = memberships.get(author);
    if (!lists || (source && !lists.has(source))) continue;

    const created = parseHiveDate(post.created).getTime();
    if (created <= cutoff || created > now) continue;

    let entry = authors.get(author);
    if (!entry) {
      entry = { author, lists, posts: [], totalMilliPayout: 0 };
      authors.set(author, entry);
    }
    const payout = payoutValue(post);
    entry.posts.push({ post, payout, created });
    entry.totalMilliPayout += Math.round(payout * PAYOUT_SCALE);
  }

  ranking = [...authors.values()]
    .filter(entry => entry.totalMilliPayout >= minimumMilliPayout)
    .sort((a, b) => b.totalMilliPayout - a.totalMilliPayout || a.author.localeCompare(b.author));

  const count = ranking.length;
  document.getElementById('blacklistRankingSummary').textContent = count
    ? `${count.toLocaleString('en-US')} blacklisted ${count === 1 ? 'author' : 'authors'}`
    : 'No blacklisted authors match these filters in the local cache.';
  const totalMilliPayout = ranking.reduce((total, entry) => total + entry.totalMilliPayout, 0);
  document.getElementById('blacklistRankingTotal').textContent = formatPendingPayout(totalMilliPayout / PAYOUT_SCALE, 3);
  document.getElementById('blacklistRankingResults').hidden = !count;
  renderPage();
}

function indexBlacklistMemberships() {
  indexedPosts = allPosts;
  memberships = getBlacklistListMemberships(new Set(allPosts.map(post => post.author)));
  const owners = new Set();
  for (const lists of memberships.values()) {
    for (const owner of lists) owners.add(owner);
  }
  const filter = document.getElementById('blacklistRankingSource');
  const selected = filter.value;
  const options = [...owners].sort((a, b) => a.localeCompare(b)).map(owner => new Option(`@${owner}`, owner));
  filter.replaceChildren(new Option('All active on-chain lists', ''), ...options);
  filter.value = owners.has(selected) ? selected : '';
}

function renderPage() {
  const pageCount = Math.max(1, Math.ceil(ranking.length / PAGE_SIZE));
  page = Math.max(1, Math.min(page, pageCount));
  document.getElementById('blacklistRankingPagination').hidden = pageCount === 1;
  document.getElementById('blacklistRankingPage').textContent = `Page ${page} of ${pageCount}`;
  document.getElementById('blacklistRankingPrevious').disabled = page === 1;
  document.getElementById('blacklistRankingNext').disabled = page === pageCount;

  const start = (page - 1) * PAGE_SIZE;
  const rows = document.createDocumentFragment();
  ranking.slice(start, start + PAGE_SIZE).forEach((entry, index) => {
    const rank = start + index + 1;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${rank}</td>
      <th scope="row">
        ${accountLinkHtml(entry.author)}
        <small>Lists · ${[...entry.lists].map(owner => accountLinkHtml(owner)).join(', ')}</small>
        <div class="blacklist-ranking-actions">
          <button type="button" class="blacklist-ranking-button blacklist-ranking-author" aria-expanded="false"
            aria-controls="blacklistRankingDetails-${rank}">Details</button>
          <button type="button" class="blacklist-ranking-button blacklist-ranking-bulk">Bulk downvote</button>
        </div>
      </th>
      <td>${entry.posts.length.toLocaleString('en-US')}</td>
      <td><strong>${formatPendingPayout(entry.totalMilliPayout / PAYOUT_SCALE, 3)}</strong></td>`;
    const details = document.createElement('tr');
    details.id = `blacklistRankingDetails-${rank}`;
    details.hidden = true;
    const cell = details.insertCell();
    cell.colSpan = 4;
    const sortedPosts = [...entry.posts].sort((a, b) => b.payout - a.payout || b.created - a.created);
    const button = row.querySelector('.blacklist-ranking-author');
    button.addEventListener('click', () => {
      if (!cell.firstChild) renderAuthorContent(cell, sortedPosts);
      details.hidden = !details.hidden;
      button.setAttribute('aria-expanded', String(!details.hidden));
    });
    const bulkButton = row.querySelector('.blacklist-ranking-bulk');
    bulkButton.disabled = !sortedPosts.some(({ post }) => canDownvotePost(post));
    bulkButton.addEventListener('click', () => openBulkDownvoteModal(sortedPosts.map(({ post }) => post)));
    rows.append(row, details);
  });
  document.getElementById('blacklistRankingBody').replaceChildren(rows);
}

function renderAuthorContent(cell, entries) {
  const list = document.createElement('ul');
  list.className = 'blacklist-ranking-content';
  for (const { post } of entries) {
    const item = document.createElement('li');
    const title = String(post.title ?? '').trim() || (post.parent_author ? 'Comment' : 'Untitled post');
    item.innerHTML = `
      <div>
        <div class="blacklist-ranking-post-title">${escapeHTML(title)}</div>
        <small>${post.parent_author ? 'Comment' : 'Post'} · ${renderPublicationTime(post.created)}</small>
        <div class="blacklist-ranking-actions">
          <button type="button" class="blacklist-ranking-button blacklist-ranking-post">Details</button>
          <button type="button" class="blacklist-ranking-button blacklist-ranking-downvote">Downvote</button>
        </div>
      </div>
      <strong>${formatPendingPayout(post.pending_payout_value, 3)}</strong>`;
    item.querySelector('.blacklist-ranking-post').addEventListener('click', () => showPostDetail(post));
    const downvote = item.querySelector('.blacklist-ranking-downvote');
    downvote.disabled = !canDownvotePost(post);
    downvote.addEventListener('click', () => openDownvoteModal(post));
    list.append(item);
  }
  cell.append(list);
}
