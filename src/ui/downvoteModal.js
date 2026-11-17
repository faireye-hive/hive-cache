import { currentUser } from '../config.js';
import { isKeychainInstalled, broadcastDownvote, broadcastBulkDownvotes, MAX_BULK_DOWNVOTES } from '../blockchain/hiveKeychain.js';
import { showNotification } from './notifications.js';
import { escapeHTML, formatPendingPayout, parseHiveDate } from '../utils/helpers.js';

const get = id => document.getElementById(id);
let activeRequest;
let submitting = false;
let opener;
const confirmedVotes = new Set();

export function canDownvotePost(post) {
  const cashout = parseHiveDate(post.cashout_time).getTime();
  return Boolean(post.author && post.permlink && post.deleted !== true && post.allow_votes !== false &&
    (!cashout || cashout > Date.now()));
}

function voteKey(voter, post) {
  return `${voter}/${post.author}/${post.permlink}`;
}

export function initDownvoteModal() {
  const modal = get('downvoteModal');
  const slider = get('downvoteWeightSlider');
  const updateWeight = () => {
    get('downvoteWeightDisplay').textContent = `-${slider.value}%`;
  };
  slider.addEventListener('input', updateWeight);
  for (const button of modal.querySelectorAll('.btn-weight-preset')) {
    button.addEventListener('click', () => {
      slider.value = Math.abs(Number(button.dataset.weight));
      updateWeight();
    });
  }

  get('downvoteBulkPosts').addEventListener('change', updateSelection);
  get('submitDownvoteBroadcast').addEventListener('click', handleDownvoteSubmit);
  for (const button of modal.querySelectorAll('.close-modal, .btn-close-downvote')) {
    button.addEventListener('click', closeDownvoteModal);
  }
  modal.addEventListener('click', event => {
    if (event.target === modal) closeDownvoteModal();
  });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeDownvoteModal();
  });
}

export function openDownvoteModal(post) {
  if (post) openDownvote([post], false);
}

export function openBulkDownvoteModal(posts) {
  const uniquePosts = new Map();
  for (const post of posts) {
    const key = voteKey(currentUser?.username, post);
    if (canDownvotePost(post) && !confirmedVotes.has(key)) uniquePosts.set(key, post);
  }
  if (!uniquePosts.size) {
    showNotification('There are no remaining posts open for downvotes in this selection.', 'info');
    return;
  }
  openDownvote([...uniquePosts.values()], true);
}

function openDownvote(posts, bulk) {
  if (submitting) return;

  activeRequest = { posts, bulk };
  opener = document.activeElement;
  const first = posts[0];
  get('downvoteModalTitle').textContent = bulk ? 'Bulk downvote on Hive' : 'Downvote on Hive';
  get('downvoteSingleTarget').hidden = bulk;
  get('downvoteBulkTarget').hidden = !bulk;
  if (bulk) {
    get('downvoteBulkAuthor').textContent = `Content by @${first.author}`;
    const rows = document.createDocumentFragment();
    posts.forEach((post, index) => {
      const label = document.createElement('label');
      label.innerHTML = `
        <input type="checkbox" value="${index}">
        <span>${escapeHTML(post.title || (post.parent_author ? 'Comment' : 'Untitled post'))}</span>
        <strong>${formatPendingPayout(post.pending_payout_value, 3)}</strong>`;
      label.firstElementChild.checked = posts.length <= MAX_BULK_DOWNVOTES;
      rows.append(label);
    });
    get('downvoteBulkPosts').replaceChildren(rows);
  } else {
    get('downvotePostAuthor').textContent = `@${first.author}`;
    get('downvotePostTitle').textContent = first.title || (first.parent_author ? 'Comment' : 'Untitled post');
    get('downvotePostPayout').textContent = formatPendingPayout(first.pending_payout_value);
    get('downvoteBulkPosts').replaceChildren();
  }

  get('downvoteWeightSlider').value = 100;
  get('downvoteWeightDisplay').textContent = '-100%';
  get('downvoteAuthWarning').textContent = !currentUser?.username || currentUser.loginMethod === 'guest'
    ? 'Sign in with Hive Keychain to submit downvotes.'
    : !isKeychainInstalled()
      ? 'Hive Keychain was not detected. Open the app in a browser with Keychain enabled.'
      : `Voting as @${currentUser.username} with Hive Keychain.`;
  updateSelection();
  get('downvoteModal').classList.remove('hidden');
  get('downvoteModal').querySelector('.close-modal').focus();
}

function selectedPosts() {
  if (!activeRequest.bulk) return activeRequest.posts;
  return [...get('downvoteBulkPosts').querySelectorAll('input:checked')]
    .map(input => activeRequest.posts[Number(input.value)]);
}

function updateSelection() {
  const count = selectedPosts().length;
  if (activeRequest.bulk) {
    get('downvoteBulkCount').textContent = `${count} selected · Up to ${MAX_BULK_DOWNVOTES} votes per transaction`;
  }
  const submit = get('submitDownvoteBroadcast');
  submit.disabled = submitting || count === 0 || count > MAX_BULK_DOWNVOTES;
  submit.textContent = submitting ? 'Waiting for Keychain…'
    : activeRequest.bulk ? `Confirm ${count} ${count === 1 ? 'downvote' : 'downvotes'} with Keychain`
    : 'Confirm Downvote with Keychain';
}

function closeDownvoteModal() {
  if (submitting) return;
  get('downvoteModal').classList.add('hidden');
  opener?.focus();
}

async function handleDownvoteSubmit() {
  if (!activeRequest || submitting) return;
  const { bulk } = activeRequest;
  const posts = selectedPosts();
  const voter = currentUser?.username;
  const percent = Number(get('downvoteWeightSlider').value);
  if (!posts.length || posts.length > MAX_BULK_DOWNVOTES) return;

  if (!voter || currentUser.loginMethod === 'guest') {
    closeDownvoteModal();
    get('loginModal')?.classList.remove('hidden');
    return;
  }
  if (!isKeychainInstalled()) {
    showNotification('Hive Keychain was not found in this browser.', 'warning');
    return;
  }
  if (posts.some(post => !canDownvotePost(post) || (bulk && confirmedVotes.has(voteKey(voter, post))))) {
    showNotification('Some selected posts are no longer available for this downvote. Reopen the dialog to update the selection.', 'warning');
    return;
  }

  const weight = -percent * 100;
  let confirmed = false;
  try {
    submitting = true;
    get('downvoteBulkTarget').disabled = true;
    updateSelection();

    if (bulk) await broadcastBulkDownvotes(posts, weight);
    else await broadcastDownvote({ author: posts[0].author, permlink: posts[0].permlink, weight });

    for (const post of posts) {
      confirmedVotes.add(voteKey(voter, post));
      if (post.id == null) continue;
      for (const card of document.querySelectorAll(`[data-post-id="${CSS.escape(String(post.id))}"]`)) {
        card.classList.add('post-downvoted');
        const button = card.querySelector('.downvote-post-btn');
        if (button) {
          button.classList.add('active-downvote');
          button.title = `Downvoted (-${percent}%)`;
        }
      }
    }
    confirmed = true;
    showNotification(`${posts.length} ${posts.length === 1 ? 'downvote' : 'downvotes'} confirmed on Hive (-${percent}%).`, 'success');
  } catch (error) {
    showNotification(`Downvote failed. ${escapeHTML(error.message || error)}`, 'error');
  } finally {
    submitting = false;
    get('downvoteBulkTarget').disabled = false;
    updateSelection();
    if (confirmed) closeDownvoteModal();
  }
}
