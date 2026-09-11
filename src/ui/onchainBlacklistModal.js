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
          ? 'Contas das blacklists seguidas ativadas no filtro de moderação.'
          : 'Apenas a sua blacklist pessoal está ativa no filtro de moderação.',
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
        showNotification('Informe o nome da conta da blacklist que deseja seguir.', 'warning');
        return;
      }

      if (!currentUser) {
        showNotification('Você precisa estar logado com sua conta Hive via Keychain.', 'error');
        return;
      }

      try {
        btnFollowNew.disabled = true;
        btnFollowNew.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Transmitindo...';

        await broadcastFollowBlacklist({
          targetListAccount: targetAccount,
          action: 'follow_blacklist',
        });

        showNotification(`Sucesso! Agora você segue a blacklist de @${targetAccount} on-chain!`, 'success');
        if (newFollowAccountInput) newFollowAccountInput.value = '';

        // Sincroniza novamente para atualizar a lista
        await syncOnchainBlacklist(getBlacklistObserver(), true);
        renderFollowedBlacklists();
        refreshPostsDisplay();
        updateHeaderBlacklistBadge();
      } catch (err) {
        console.error('Erro ao seguir blacklist:', err);
        showNotification(`Falha ao seguir blacklist: ${err.message || err}`, 'error');
      } finally {
        btnFollowNew.disabled = false;
        btnFollowNew.innerHTML = '<i class="fas fa-user-plus"></i> Seguir Lista (Keychain)';
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
        syncBridgeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sincronizando...';
        const res = await syncOnchainBlacklist(obs, true);
        showNotification(
          `Sincronizado! ${res.personalCount} contas pessoais e ${res.followedListsCount} listas seguidas para @${obs}.`,
          'success'
        );
        renderPersonalBlacklist();
        renderFollowedBlacklists();
        refreshPostsDisplay();
        updateHeaderBlacklistBadge();
      } catch (err) {
        console.error('Erro na sincronização via bridge:', err);
        showNotification(`Erro ao sincronizar: ${err.message || err}`, 'error');
      } finally {
        syncBridgeBtn.disabled = false;
        syncBridgeBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Sincronizar (bridge.get_follow_list)';
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
      if (reasonSelect.value === 'Outro') {
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
  const reasonSelect = document.getElementById('blacklistReason')?.value || 'Spam / Flood de Posts';
  const customReason = document.getElementById('blacklistCustomReason')?.value || '';
  const reason = reasonSelect === 'Outro' && customReason ? customReason : reasonSelect;
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
      description: 'Transmissão Dupla (Universal follow com blacklist_description + Protocolo de Moderação)',
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
      reasonSelect.value = 'Outro';
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
  const reasonSelect = document.getElementById('blacklistReason')?.value || 'Spam / Flood de Posts';
  const customReason = document.getElementById('blacklistCustomReason')?.value || '';
  const reason = reasonSelect === 'Outro' && customReason ? customReason : reasonSelect;
  const severity = document.getElementById('blacklistSeverity')?.value || 'high';
  const protocol = document.getElementById('blacklistProtocol')?.value || 'follow';
  const notes = document.getElementById('blacklistNotes')?.value || '';
  const submitBtn = document.getElementById('submitBlacklistBroadcast');

  if (!currentUser) {
    showNotification('Você precisa efetuar login com sua conta Hive antes de transmitir.', 'error');
    return;
  }

  if (!isKeychainInstalled()) {
    showNotification('Extensão Hive Keychain não detectada no navegador.', 'error');
    return;
  }

  if (!targetUser) {
    showNotification('Informe o nome de usuário da conta a ser colocada na blacklist.', 'warning');
    return;
  }

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Transmitindo no Keychain...';
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
      `Sucesso! @${res.target} adicionado à Blacklist com a razão "${reason}" via Keychain!`,
      'success'
    );

    refreshPostsDisplay();
    updateHeaderBlacklistBadge();
    updateModalBadges();

    // Alterna para a aba de blacklist pessoal
    document.getElementById('tabBlacklistPersonal')?.click();
  } catch (error) {
    console.error('Erro na transmissão da blacklist:', error);
    showNotification(`Falha ao transmitir: ${error.message || error}`, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-shield-alt"></i> Transmitir para Blockchain via Keychain';
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
        <p style="font-weight: 500; margin: 4px 0;">${searchQuery ? 'Nenhuma conta encontrada com este filtro.' : 'Nenhuma conta na sua blacklist pessoal.'}</p>
        <span style="font-size: 0.82rem; color: #64748b;">
          Clique em "Sincronizar (bridge.get_follow_list)" para carregar ou use a aba "Transmitir" para adicionar contas.
        </span>
      </div>
    `;
    return;
  }

  const itemsHtml = accounts
    .map((item) => {
      const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleString('pt-BR') : 'On-Chain';

      return `
        <div class="blacklist-history-card" data-account="${escapeHTML(item.account)}">
          <div class="bl-card-left">
            <img class="bl-user-avatar" src="https://images.hive.blog/u/${escapeHTML(item.account)}/avatar/small" alt="@${escapeHTML(item.account)}" onerror="this.src='https://images.hive.blog/u/hive/avatar/small'" />
            <div class="bl-user-info">
              <div class="bl-user-name">
                <strong>@${escapeHTML(item.account)}</strong>
                <span class="badge-blacklisted-flair"><i class="fas fa-ban"></i> BLACKLISTED</span>
                <span class="bl-protocol-badge">${item.source === 'bridge_api' ? 'Hive Blockchain' : 'Keychain Local'}</span>
              </div>
              <div class="bl-reason">
                <strong>blacklist_description:</strong> 
                <span style="color: #b91c1c; font-weight: 500;">${escapeHTML(item.reason || 'Spam / Abuso')}</span>
              </div>
              ${item.notes ? `<div class="bl-notes"><strong>Notas:</strong> "${escapeHTML(item.notes)}"</div>` : ''}
              <div class="bl-meta">
                <span><i class="far fa-clock"></i> ${dateStr}</span>
                ${item.moderator ? `<span><i class="fas fa-user-shield"></i> Mod: @${escapeHTML(item.moderator)}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="bl-card-right">
            <a href="https://peakd.com/@${escapeHTML(item.account)}" target="_blank" rel="noopener noreferrer" class="btn-icon" title="Ver perfil no PeakD">
              <i class="fas fa-external-link-alt"></i>
            </a>
            <a href="https://hiveblocks.com/@${escapeHTML(item.account)}" target="_blank" rel="noopener noreferrer" class="btn-icon" title="Ver no HiveBlocks">
              <i class="fas fa-cube"></i>
            </a>
            <button class="btn-small btn-outline-danger unblacklist-btn" data-account="${escapeHTML(item.account)}" title="Remover da Blacklist On-Chain (transmitir un-blacklist)">
              <i class="fas fa-undo"></i> Remover
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
      if (!confirm(`Deseja remover @${account} da Blacklist on-chain via Hive Keychain?`)) {
        return;
      }

      if (!currentUser) {
        showNotification('Faça login com Hive Keychain para transmitir a remoção.', 'error');
        return;
      }

      try {
        this.disabled = true;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removendo...';

        await broadcastBlacklistUser({
          targetUser: account,
          action: 'unblacklist',
          protocol: 'follow',
        });

        showNotification(`@${account} foi removido da Blacklist on-chain!`, 'success');
        renderPersonalBlacklist();
        refreshPostsDisplay();
        updateHeaderBlacklistBadge();
        updateModalBadges();
      } catch (err) {
        console.error('Erro ao remover blacklist:', err);
        showNotification(`Erro ao remover: ${err.message || err}`, 'error');
        this.disabled = false;
        this.innerHTML = '<i class="fas fa-undo"></i> Remover';
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
        <p style="font-weight: 600; margin: 4px 0; color: #334155;">Você ainda não segue nenhuma outra blacklist on-chain.</p>
        <p style="font-size: 0.84rem; color: #64748b; margin-bottom: 12px;">
          Adicione uma lista acima ou siga projetos de referência como <code>@themarkymark</code>, <code>@faireye</code> ou <code>@hive.blog</code>.
        </p>
        <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
          <button class="btn-small btn-secondary quick-follow-btn" data-account="themarkymark">
            <i class="fas fa-plus"></i> + @themarkymark (Abuso Geral)
          </button>
          <button class="btn-small btn-secondary quick-follow-btn" data-account="faireye">
            <i class="fas fa-plus"></i> + @faireye (Curadores)
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
      const desc = list.blacklist_description || list.muted_list_description || 'Lista pública de moderação da comunidade';
      const count = list.count || (Array.isArray(list.accounts) ? list.accounts.length : 0);

      return `
        <div class="followed-blacklist-card" style="display: flex; justify-content: space-between; align-items: center; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img src="https://images.hive.blog/u/${escapeHTML(list.name)}/avatar/small" alt="@${escapeHTML(list.name)}" style="width: 42px; height: 42px; border-radius: 50%; border: 2px solid #e2e8f0;" onerror="this.src='https://images.hive.blog/u/hive/avatar/small'" />
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="font-size: 0.95rem; color: #0f172a;">@${escapeHTML(list.name)}</strong>
                <span style="background: #e0e7ff; color: #4338ca; font-size: 0.72rem; font-weight: 600; padding: 2px 8px; border-radius: 12px;">
                  <i class="fas fa-check-circle"></i> Lista Seguida
                </span>
                <span style="background: #f1f5f9; color: #475569; font-size: 0.72rem; padding: 2px 8px; border-radius: 12px;">
                  ${count > 0 ? `${count} contas banidas` : 'Lista ativa'}
                </span>
              </div>
              <div style="font-size: 0.82rem; color: #475569; margin-top: 3px;">
                <span style="font-weight: 600; color: #64748b;">Descrição on-chain:</span> 
                <em>"${escapeHTML(desc)}"</em>
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <a href="https://peakd.com/@${escapeHTML(list.name)}" target="_blank" rel="noopener noreferrer" class="btn-icon" title="Ver perfil no PeakD">
              <i class="fas fa-external-link-alt"></i>
            </a>
            <button class="btn-small btn-outline-danger unfollow-list-btn" data-account="${escapeHTML(list.name)}" title="Deixar de seguir esta blacklist on-chain">
              <i class="fas fa-user-minus"></i> Deixar de Seguir
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = itemsHtml;

  // Listeners para Deixar de Seguir (unfollow_blacklist)
  container.querySelectorAll('.unfollow-list-btn').forEach((btn) => {
    btn.addEventListener('click', async function () {
      const listAccount = this.getAttribute('data-account');
      if (!confirm(`Deseja deixar de seguir a blacklist de @${listAccount} on-chain via Hive Keychain?`)) {
        return;
      }

      if (!currentUser) {
        showNotification('Faça login com Hive Keychain para transmitir.', 'error');
        return;
      }

      try {
        this.disabled = true;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Transmitindo...';

        await broadcastFollowBlacklist({
          targetListAccount: listAccount,
          action: 'unfollow_blacklist',
        });

        showNotification(`Você deixou de seguir a blacklist de @${listAccount} on-chain!`, 'success');

        // Atualiza a sincronização
        await syncOnchainBlacklist(getBlacklistObserver(), true);
        renderFollowedBlacklists();
        refreshPostsDisplay();
        updateHeaderBlacklistBadge();
        updateModalBadges();
      } catch (err) {
        console.error('Erro ao deixar de seguir blacklist:', err);
        showNotification(`Erro: ${err.message || err}`, 'error');
        this.disabled = false;
        this.innerHTML = '<i class="fas fa-user-minus"></i> Deixar de Seguir';
      }
    });
  });
}
