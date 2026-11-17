// src/ui/onchainBlacklistModal.js

import { currentUser } from '../config.js';
import {
  isKeychainInstalled,
  broadcastBlacklistUser,
  broadcastFollowBlacklist,
  getOnchainBlacklistHistory,
} from '../blockchain/hiveKeychain.js';
import {
  isAccountOnchainBlacklisted,
  getPersonalBlacklist,
  getFollowedBlacklists,
  getShouldIncludeFollowed,
  setShouldIncludeFollowed,
  getBlacklistObserver,
  setBlacklistObserver,
  syncOnchainBlacklist,
  getOnchainBlacklistedCount,
  subscribeToBlacklistUpdates,
  getAccountBlacklistDetails,
} from '../api/onchainBlacklistService.js';
import { showNotification } from './notifications.js';
import { escapeHTML } from '../utils/helpers.js';
import { getProxiedImageUrl } from '../utils/imageProxy.js';
import { refreshPostsDisplay } from './domHelpers.js';

let activeTargetAccount = '';

/**
 * Inicializa os event listeners do modal de Blacklist On-Chain
 */
export function initOnchainBlacklistModal() {
  const modal = document.getElementById('onchainBlacklistModal');
  if (!modal) return;

  const targetInput = document.getElementById('blacklistTargetUser');
  const reasonSelect = document.getElementById('blacklistReason');
  const customReasonInput = document.getElementById('blacklistCustomReason');
  const severitySelect = document.getElementById('blacklistSeverity');
  const protocolSelect = document.getElementById('blacklistProtocol');
  const notesTextarea = document.getElementById('blacklistNotes');
  const submitBtn = document.getElementById('submitBlacklistBroadcast');
  const observerInput = document.getElementById('blacklistObserverInput');
  const syncBridgeBtn = document.getElementById('btnSyncFromBridgeApi');
  const historySearch = document.getElementById('blacklistHistorySearch');

  // Abas do Modal
  const tabBroadcast = document.getElementById('tabBlacklistBroadcast');
  const tabPersonal = document.getElementById('tabBlacklistPersonal');
  const tabFollowed = document.getElementById('tabBlacklistFollowed');

  const contentBroadcast = document.getElementById('blacklistBroadcastContent');
  const contentPersonal = document.getElementById('blacklistHistoryContent');
  const contentFollowed = document.getElementById('blacklistFollowedContent');

  // Toggle e formulário de listas seguidas
  const toggleIncludeFollowed = document.getElementById('toggleIncludeFollowed');
  const newFollowAccountInput = document.getElementById('newFollowBlacklistAccount');
  const btnFollowNew = document.getElementById('btnFollowNewBlacklist');

  if (toggleIncludeFollowed) {
    toggleIncludeFollowed.checked = getShouldIncludeFollowed();
    toggleIncludeFollowed.addEventListener('change', (e) => {
      setShouldIncludeFollowed(e.target.checked);
      refreshPostsDisplay();
      updateHeaderBlacklistBadge();
      showNotification(
        e.target.checked
          ? 'Accounts from followed blacklists are included in the moderation filter.'
          : 'Only your personal blacklist is active in the moderation filter.',
        'info'
      );
    });
  }

  if (btnFollowNew) {
    btnFollowNew.addEventListener('click', async () => {
      const targetAccount = (newFollowAccountInput?.value || '')
        .trim()
        .toLowerCase()
        .replace(/^@/, '');

      if (!targetAccount) {
        showNotification('Enter the username of the blacklist you want to follow.', 'warning');
        return;
      }

      if (!currentUser) {
        showNotification('You must be signed in to Hive with Keychain.', 'error');
        return;
      }

      try {
        btnFollowNew.disabled = true;
        btnFollowNew.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Broadcasting...';

        await broadcastFollowBlacklist({
          targetListAccount: targetAccount,
          action: 'follow_blacklist',
        });

        showNotification(`Success! You are now following @${targetAccount}'s on-chain blacklist!`, 'success');
        if (newFollowAccountInput) newFollowAccountInput.value = '';

        // Sincroniza novamente para atualizar a lista
        await syncOnchainBlacklist(getBlacklistObserver(), true);
        renderFollowedBlacklists();
        refreshPostsDisplay();
        updateHeaderBlacklistBadge();
      } catch (err) {
        console.error('Error following blacklist:', err);
        showNotification(`Failed to follow blacklist: ${err.message || err}`, 'error');
      } finally {
        btnFollowNew.disabled = false;
        btnFollowNew.innerHTML = '<i class="fas fa-user-plus"></i> Follow List (Keychain)';
      }
    });
  }

  if (observerInput) {
    observerInput.value = getBlacklistObserver();
    observerInput.addEventListener('change', () => {
      if (observerInput.value.trim()) {
        setBlacklistObserver(observerInput.value.trim());
      }
    });
  }

  if (syncBridgeBtn) {
    syncBridgeBtn.addEventListener('click', async () => {
      const obs = (observerInput?.value || getBlacklistObserver()).trim();
      setBlacklistObserver(obs);
      try {
        syncBridgeBtn.disabled = true;
        syncBridgeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
        const res = await syncOnchainBlacklist(obs, true);
        showNotification(
          `Synced ${res.personalCount} personal accounts and ${res.followedListsCount} followed lists for @${obs}.`,
          'success'
        );
        renderPersonalBlacklist();
        renderFollowedBlacklists();
        refreshPostsDisplay();
        updateHeaderBlacklistBadge();
      } catch (err) {
        console.error('Bridge sync error:', err);
        showNotification(`Sync error: ${err.message || err}`, 'error');
      } finally {
        syncBridgeBtn.disabled = false;
        syncBridgeBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Sync (bridge.get_follow_list)';
      }
    });
  }

  if (historySearch) {
    historySearch.addEventListener('input', () => {
      renderPersonalBlacklist();
    });
  }

  // Navegação entre abas
  function switchTab(activeTab, activeContent) {
    [tabBroadcast, tabPersonal, tabFollowed].forEach((t) => t?.classList.remove('active'));
    [contentBroadcast, contentPersonal, contentFollowed].forEach((c) => c?.classList.add('hidden'));

    activeTab?.classList.add('active');
    activeContent?.classList.remove('hidden');
  }

  if (tabBroadcast) {
    tabBroadcast.addEventListener('click', () => {
      switchTab(tabBroadcast, contentBroadcast);
    });
  }

  if (tabPersonal) {
    tabPersonal.addEventListener('click', () => {
      switchTab(tabPersonal, contentPersonal);
      renderPersonalBlacklist();
    });
  }

  if (tabFollowed) {
    tabFollowed.addEventListener('click', () => {
      switchTab(tabFollowed, contentFollowed);
      renderFollowedBlacklists();
    });
  }

  // Mudança do motivo pré-definido
  if (reasonSelect && customReasonInput) {
    reasonSelect.addEventListener('change', () => {
      if (reasonSelect.value === 'Other') {
        customReasonInput.classList.remove('hidden');
        customReasonInput.focus();
      } else {
        customReasonInput.classList.add('hidden');
      }
      updateLiveJsonPreview();
    });
  }

  // Atualização em tempo real do preview do payload JSON
  [targetInput, customReasonInput, severitySelect, protocolSelect, notesTextarea].forEach((el) => {
    if (el) {
      el.addEventListener('input', updateLiveJsonPreview);
      el.addEventListener('change', updateLiveJsonPreview);
    }
  });

  // Botão de Transmissão
  if (submitBtn) {
    submitBtn.addEventListener('click', handleBlacklistSubmit);
  }

  // Fechar modal
  modal.querySelectorAll('.close-modal, .btn-close-blacklist').forEach((btn) => {
    btn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });

  // Inscreve para atualizar badges
  subscribeToBlacklistUpdates(() => {
    updateHeaderBlacklistBadge();
    updateModalBadges();
  });

  updateHeaderBlacklistBadge();
  updateModalBadges();
}

/**
 * Atualiza os números nos badges do modal
 */
export function updateModalBadges() {
  const personalCount = getPersonalBlacklist().length;
  const followedLists = getFollowedBlacklists().length;

  const countBadge1 = document.getElementById('historyAccountsCount');
  const countBadge2 = document.getElementById('personalAccountsCount');
  const countFollowedBadge = document.getElementById('followedListsCountBadge');

  if (countBadge1) countBadge1.textContent = String(personalCount);
  if (countBadge2) countBadge2.textContent = String(personalCount);
  if (countFollowedBadge) countFollowedBadge.textContent = String(followedLists);
}

/**
 * Atualiza o badge de contador no cabeçalho
 */
export function updateHeaderBlacklistBadge() {
  const badge = document.getElementById('headerBlacklistCountBadge');
  if (badge) {
    badge.textContent = String(getOnchainBlacklistedCount());
  }
}

/**
 * Atualiza a prévia interativa do JSON que será transmitido à blockchain
 */
export function updateLiveJsonPreview() {
  const previewElement = document.getElementById('blacklistJsonPreview');
  if (!previewElement) return;

  const targetUser = (document.getElementById('blacklistTargetUser')?.value || 'BlacklistedUsername')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
  const broadcaster = currentUser?.username || 'sm-silva';
  const reasonSelect = document.getElementById('blacklistReason')?.value || 'Spam / Post Flood';
  const customReason = document.getElementById('blacklistCustomReason')?.value || '';
  const reason = reasonSelect === 'Other' && customReason ? customReason : reasonSelect;
  const severity = document.getElementById('blacklistSeverity')?.value || 'high';
  const protocol = document.getElementById('blacklistProtocol')?.value || 'follow';
  const notes = document.getElementById('blacklistNotes')?.value || '';

  const timestamp = new Date().toISOString();

  let previewObj = {};

  if (protocol === 'follow') {
    previewObj = {
      operation: 'custom_json',
      required_auths: [],
      required_posting_auths: [broadcaster],
      id: 'follow',
      json: JSON.stringify([
        'follow',
        {
          follower: broadcaster,
          following: targetUser || 'BlacklistedUsername',
          what: ['blacklist'],
          blacklist_description: reason,
        },
      ]),
    };
  } else if (protocol === 'hive_moderation') {
    previewObj = {
      operation: 'custom_json',
      required_auths: [],
      required_posting_auths: [broadcaster],
      id: 'hive_moderation',
      json: JSON.stringify({
        app: 'hive-moderation-dashboard/1.0',
        action: 'blacklist',
        account: targetUser || 'BlacklistedUsername',
        reason: reason,
        blacklist_description: reason,
        severity: severity,
        notes: notes,
        moderator: broadcaster,
        timestamp: timestamp,
      }),
    };
  } else {
    previewObj = {
      description: 'Dual broadcast (universal follow with blacklist_description + moderation protocol)',
      operacao_1_universal: {
        operation: 'custom_json',
        id: 'follow',
        json: JSON.stringify([
          'follow',
          {
            follower: broadcaster,
            following: targetUser || 'BlacklistedUsername',
            what: ['blacklist'],
            blacklist_description: reason,
          },
        ]),
      },
      operacao_2_moderacao: {
        operation: 'custom_json',
        id: 'hive_moderation',
        json: JSON.stringify({
          app: 'hive-moderation-dashboard/1.0',
          action: 'blacklist',
          account: targetUser || 'BlacklistedUsername',
          reason: reason,
          blacklist_description: reason,
          severity: severity,
          notes: notes,
          moderator: broadcaster,
          timestamp: timestamp,
        }),
      },
    };
  }

  previewElement.textContent = JSON.stringify(previewObj, null, 2);
}

/**
 * Abre o modal de Blacklist On-Chain preenchendo os dados do alvo
 */
export function openOnchainBlacklistModal(targetAccount = '', options = {}) {
  const modal = document.getElementById('onchainBlacklistModal');
  if (!modal) return;

  activeTargetAccount = String(targetAccount || '').trim().replace(/^@/, '');

  const targetInput = document.getElementById('blacklistTargetUser');
  if (targetInput) {
    targetInput.value = activeTargetAccount;
  }

  const reasonSelect = document.getElementById('blacklistReason');
  if (reasonSelect && options.reason) {
    let matched = false;
    for (let i = 0; i < reasonSelect.options.length; i++) {
      if (reasonSelect.options[i].value === options.reason) {
        reasonSelect.selectedIndex = i;
        matched = true;
        break;
      }
    }
    if (!matched) {
      reasonSelect.value = 'Other';
      const customInput = document.getElementById('blacklistCustomReason');
      if (customInput) {
        customInput.classList.remove('hidden');
        customInput.value = options.reason;
      }
    }
  }

  const severitySelect = document.getElementById('blacklistSeverity');
  if (severitySelect && options.severity) {
    severitySelect.value = options.severity;
  }

  const notesTextarea = document.getElementById('blacklistNotes');
  if (notesTextarea && options.notes) {
    notesTextarea.value = options.notes;
  }

  const observerInput = document.getElementById('blacklistObserverInput');
  if (observerInput) {
    observerInput.value = getBlacklistObserver();
  }

  updateLiveJsonPreview();
  renderPersonalBlacklist();
  renderFollowedBlacklists();
  updateModalBadges();

  document.getElementById('tabBlacklistBroadcast')?.click();
  modal.classList.remove('hidden');
}

/**
 * Manipula a submissão do formulário de transmissão
 */
async function handleBlacklistSubmit() {
  const targetUser = (document.getElementById('blacklistTargetUser')?.value || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
  const reasonSelect = document.getElementById('blacklistReason')?.value || 'Spam / Post Flood';
  const customReason = document.getElementById('blacklistCustomReason')?.value || '';
  const reason = reasonSelect === 'Other' && customReason ? customReason : reasonSelect;
  const severity = document.getElementById('blacklistSeverity')?.value || 'high';
  const protocol = document.getElementById('blacklistProtocol')?.value || 'follow';
  const notes = document.getElementById('blacklistNotes')?.value || '';
  const submitBtn = document.getElementById('submitBlacklistBroadcast');

  if (!currentUser) {
    showNotification('Sign in to your Hive account before broadcasting.', 'error');
    return;
  }

  if (!isKeychainInstalled()) {
    showNotification('Hive Keychain extension not detected.', 'error');
    return;
  }

  if (!targetUser) {
    showNotification('Enter the username of the account to blacklist.', 'warning');
    return;
  }

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Broadcasting with Keychain...';
    }

    const res = await broadcastBlacklistUser({
      targetUser: targetUser,
      action: 'blacklist',
      reason: reason,
      severity: severity,
      notes: notes,
      protocol: protocol,
    });

    showNotification(
      `Success! @${res.target} was added to the blacklist with reason "${reason}" via Keychain!`,
      'success'
    );

    refreshPostsDisplay();
    updateHeaderBlacklistBadge();
    updateModalBadges();

    // Alterna para a aba de blacklist pessoal
    document.getElementById('tabBlacklistPersonal')?.click();
  } catch (error) {
    console.error('Blacklist broadcast error:', error);
    showNotification(`Broadcast failed: ${error.message || error}`, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-shield-alt"></i> Broadcast to Blockchain with Keychain';
    }
  }
}

/**
 * Renderiza a lista de contas na blacklist pessoal do observador
 */
export function renderPersonalBlacklist() {
  const container = document.getElementById('onchainBlacklistHistoryList');
  if (!container) return;

  const searchQuery = (document.getElementById('blacklistHistorySearch')?.value || '').toLowerCase().trim();
  const personalAccounts = getPersonalBlacklist();
  const localHistory = getOnchainBlacklistHistory();

  const accountsMap = new Map();

  // 1. Contas da API bridge.get_follow_list do observer
  personalAccounts.forEach((item) => {
    const name = (typeof item === 'string' ? item : item.name).toLowerCase().trim();
    accountsMap.set(name, {
      account: name,
      source: 'bridge_api',
      reason: item.blacklist_description || 'Blacklist on-chain',
      severity: 'high',
      protocol: 'follow',
      timestamp: null,
    });
  });

  // 2. Sobrepõe com metadados locais de transmissão recente
  localHistory.forEach((item) => {
    const name = item.account.toLowerCase().trim();
    accountsMap.set(name, {
      ...accountsMap.get(name),
      account: name,
      source: 'local_broadcast',
      reason: item.reason || accountsMap.get(name)?.reason || 'Blacklist on-chain',
      severity: item.severity || 'high',
      protocol: item.protocol || 'follow',
      notes: item.notes || '',
      timestamp: item.timestamp,
      moderator: item.moderator,
    });
  });

  let accounts = Array.from(accountsMap.values());

  if (searchQuery) {
    accounts = accounts.filter(
      (a) => a.account.includes(searchQuery) || (a.reason && a.reason.toLowerCase().includes(searchQuery))
    );
  }

  updateModalBadges();

  if (accounts.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box" style="text-align: center; padding: 24px; color: #6b7280;">
        <i class="fas fa-user-shield" style="font-size: 2.2rem; color: #9ca3af; margin-bottom: 8px;"></i>
        <p style="font-weight: 500; margin: 4px 0;">${searchQuery ? 'No accounts match this filter.' : 'Your personal blacklist is empty.'}</p>
        <span style="font-size: 0.82rem; color: #64748b;">
          Click "Sync (bridge.get_follow_list)" to load accounts, or use the "Broadcast" tab to add accounts.
        </span>
      </div>
    `;
    return;
  }

  const itemsHtml = accounts
    .map((item) => {
      const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleString('en-US') : 'On-Chain';

      return `
        <div class="blacklist-history-card" data-account="${escapeHTML(item.account)}">
          <div class="bl-card-left">
            <img class="bl-user-avatar" src="${escapeHTML(getProxiedImageUrl(`https://images.hive.blog/u/${encodeURIComponent(item.account)}/avatar/small`, 96, 96))}" alt="@${escapeHTML(item.account)}" loading="lazy" referrerpolicy="no-referrer" />
            <div class="bl-user-info">
              <div class="bl-user-name">
                <strong>@${escapeHTML(item.account)}</strong>
                <span class="badge-blacklisted-flair"><i class="fas fa-ban"></i> BLACKLISTED</span>
                <span class="bl-protocol-badge">${item.source === 'bridge_api' ? 'Hive Blockchain' : 'Keychain Local'}</span>
              </div>
              <div class="bl-reason">
                <strong>blacklist_description:</strong> 
                <span style="color: #b91c1c; font-weight: 500;">${escapeHTML(item.reason || 'Spam / Abuse')}</span>
              </div>
              ${item.notes ? `<div class="bl-notes"><strong>Notes:</strong> "${escapeHTML(item.notes)}"</div>` : ''}
              <div class="bl-meta">
                <span><i class="far fa-clock"></i> ${dateStr}</span>
                ${item.moderator ? `<span><i class="fas fa-user-shield"></i> Moderator: @${escapeHTML(item.moderator)}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="bl-card-right">
            <a href="https://peakd.com/@${escapeHTML(item.account)}" target="_blank" rel="noopener noreferrer" class="btn-icon" title="View profile on PeakD">
              <i class="fas fa-external-link-alt"></i>
            </a>
            <a href="https://hiveblocks.com/@${escapeHTML(item.account)}" target="_blank" rel="noopener noreferrer" class="btn-icon" title="View on HiveBlocks">
              <i class="fas fa-cube"></i>
            </a>
            <button class="btn-small btn-outline-danger unblacklist-btn" data-account="${escapeHTML(item.account)}" title="Remove from on-chain blacklist (broadcast un-blacklist)">
              <i class="fas fa-undo"></i> Remove
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = itemsHtml;

  // Listeners para un-blacklist
  container.querySelectorAll('.unblacklist-btn').forEach((btn) => {
    btn.addEventListener('click', async function () {
      const account = this.getAttribute('data-account');
      if (!confirm(`Remove @${account} from the on-chain blacklist using Hive Keychain?`)) {
        return;
      }

      if (!currentUser) {
        showNotification('Sign in with Hive Keychain to broadcast this removal.', 'error');
        return;
      }

      try {
        this.disabled = true;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing...';

        await broadcastBlacklistUser({
          targetUser: account,
          action: 'unblacklist',
          protocol: 'follow',
        });

        showNotification(`@${account} was removed from the on-chain blacklist!`, 'success');
        renderPersonalBlacklist();
        refreshPostsDisplay();
        updateHeaderBlacklistBadge();
        updateModalBadges();
      } catch (err) {
        console.error('Error removing blacklist:', err);
        showNotification(`Removal error: ${err.message || err}`, 'error');
        this.disabled = false;
        this.innerHTML = '<i class="fas fa-undo"></i> Remove';
      }
    });
  });
}

/**
 * Renderiza as Blacklists Seguidas pelo observador (follow_blacklist)
 */
export function renderFollowedBlacklists() {
  const container = document.getElementById('followedBlacklistsContainer');
  if (!container) return;

  const followed = getFollowedBlacklists();
  updateModalBadges();

  if (followed.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box" style="text-align: center; padding: 24px; color: #6b7280; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
        <i class="fas fa-users-slash" style="font-size: 2.2rem; color: #9ca3af; margin-bottom: 8px;"></i>
        <p style="font-weight: 600; margin: 4px 0; color: #334155;">You are not following any other on-chain blacklists yet.</p>
        <p style="font-size: 0.84rem; color: #64748b; margin-bottom: 12px;">
          Add a list above or follow community projects such as <code>@themarkymark</code>, <code>@faireye</code>, or <code>@hive.blog</code>.
        </p>
        <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
          <button class="btn-small btn-secondary quick-follow-btn" data-account="themarkymark">
            <i class="fas fa-plus"></i> + @themarkymark (General Abuse)
          </button>
          <button class="btn-small btn-secondary quick-follow-btn" data-account="faireye">
            <i class="fas fa-plus"></i> + @faireye (Curators)
          </button>
          <button class="btn-small btn-secondary quick-follow-btn" data-account="hive.blog">
            <i class="fas fa-plus"></i> + @hive.blog (Phishing)
          </button>
        </div>
      </div>
    `;

    container.querySelectorAll('.quick-follow-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('newFollowBlacklistAccount');
        if (input) {
          input.value = btn.getAttribute('data-account');
          document.getElementById('btnFollowNewBlacklist')?.click();
        }
      });
    });
    return;
  }

  const itemsHtml = followed
    .map((list) => {
      const desc = list.blacklist_description || list.muted_list_description || 'Public community moderation list';
      const count = list.count || (Array.isArray(list.accounts) ? list.accounts.length : 0);

      return `
        <div class="followed-blacklist-card" style="display: flex; justify-content: space-between; align-items: center; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img src="${escapeHTML(getProxiedImageUrl(`https://images.hive.blog/u/${encodeURIComponent(list.name)}/avatar/small`, 96, 96))}" alt="@${escapeHTML(list.name)}" style="width: 42px; height: 42px; border-radius: 50%; border: 2px solid #e2e8f0;" loading="lazy" referrerpolicy="no-referrer" />
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="font-size: 0.95rem; color: #0f172a;">@${escapeHTML(list.name)}</strong>
                <span style="background: #e0e7ff; color: #4338ca; font-size: 0.72rem; font-weight: 600; padding: 2px 8px; border-radius: 12px;">
                  <i class="fas fa-check-circle"></i> Followed List
                </span>
                <span style="background: #f1f5f9; color: #475569; font-size: 0.72rem; padding: 2px 8px; border-radius: 12px;">
                  ${count > 0 ? `${count} blocked accounts` : 'List active'}
                </span>
              </div>
              <div style="font-size: 0.82rem; color: #475569; margin-top: 3px;">
                <span style="font-weight: 600; color: #64748b;">On-chain description:</span>
                <em>"${escapeHTML(desc)}"</em>
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <a href="https://peakd.com/@${escapeHTML(list.name)}" target="_blank" rel="noopener noreferrer" class="btn-icon" title="View profile on PeakD">
              <i class="fas fa-external-link-alt"></i>
            </a>
            <button class="btn-small btn-outline-danger unfollow-list-btn" data-account="${escapeHTML(list.name)}" title="Unfollow this on-chain blacklist">
              <i class="fas fa-user-minus"></i> Unfollow
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = itemsHtml;

  // Listeners para Unfollow (unfollow_blacklist)
  container.querySelectorAll('.unfollow-list-btn').forEach((btn) => {
    btn.addEventListener('click', async function () {
      const listAccount = this.getAttribute('data-account');
      if (!confirm(`Unfollow @${listAccount}'s on-chain blacklist using Hive Keychain?`)) {
        return;
      }

      if (!currentUser) {
        showNotification('Sign in with Hive Keychain to broadcast.', 'error');
        return;
      }

      try {
        this.disabled = true;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Broadcasting...';

        await broadcastFollowBlacklist({
          targetListAccount: listAccount,
          action: 'unfollow_blacklist',
        });

        showNotification(`You unfollowed @${listAccount}'s on-chain blacklist!`, 'success');

        // Atualiza a sincronização
        await syncOnchainBlacklist(getBlacklistObserver(), true);
        renderFollowedBlacklists();
        refreshPostsDisplay();
        updateHeaderBlacklistBadge();
        updateModalBadges();
      } catch (err) {
        console.error('Error unfollowing blacklist:', err);
        showNotification(`Error: ${err.message || err}`, 'error');
        this.disabled = false;
        this.innerHTML = '<i class="fas fa-user-minus"></i> Unfollow';
      }
    });
  });
}
