// src/api/onchainBlacklistService.js

import { currentUser } from '../config.js';

const STORAGE_KEY_PERSONAL = 'hive_onchain_blacklist_personal';
const STORAGE_KEY_FOLLOWED_LISTS = 'hive_onchain_followed_lists';
const STORAGE_KEY_OBSERVER = 'hive_onchain_blacklist_observer';
const STORAGE_KEY_INCLUDE_FOLLOWED = 'hive_onchain_include_followed';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

const RPC_ENDPOINTS = [
  'https://api.hive.blog/',
  'https://rpc.mahdiyari.info/',
  'https://api.deathwing.me/',
  'https://hive-api.arcange.eu/',
];

// Cache em memória para verificação O(1) ultra-rápida
const blacklistedAccountsSet = new Set();
const accountDetailsMap = new Map(); // account -> { name, source, sourceOwner, description, reason }

let personalBlacklist = []; // [{ name, blacklist_description, muted_list_description }]
let followedBlacklists = []; // [{ name, blacklist_description, muted_list_description, count, accounts: [] }]
let includeFollowedInFilter = localStorage.getItem(STORAGE_KEY_INCLUDE_FOLLOWED) !== 'false'; // default true
let lastSyncTimestamp = 0;
let currentObserver = localStorage.getItem(STORAGE_KEY_OBSERVER) || 'sm-silva';
const updateListeners = new Set();

/**
 * Inicializa os caches a partir do localStorage
 */
export function initOnchainBlacklistCache() {
  try {
    const rawPersonal = localStorage.getItem(STORAGE_KEY_PERSONAL);
    if (rawPersonal) {
      const parsed = JSON.parse(rawPersonal);
      if (Array.isArray(parsed.accounts)) {
        personalBlacklist = parsed.accounts;
        if (parsed.observer) currentObserver = parsed.observer;
        if (parsed.timestamp) lastSyncTimestamp = parsed.timestamp;
      }
    }

    const rawFollowed = localStorage.getItem(STORAGE_KEY_FOLLOWED_LISTS);
    if (rawFollowed) {
      const parsed = JSON.parse(rawFollowed);
      if (Array.isArray(parsed)) {
        followedBlacklists = parsed;
      }
    }

    rebuildConsolidatedBlacklist();
  } catch (err) {
    console.warn('[OnchainBlacklist] Erro ao carregar cache local:', err);
  }
}

// Inicializa imediatamente na importação
initOnchainBlacklistCache();

/**
 * Reconstrói o Set e o Map consolidados de contas blacklisted
 */
function rebuildConsolidatedBlacklist() {
  blacklistedAccountsSet.clear();
  accountDetailsMap.clear();

  // 1. Contas da blacklist pessoal
  personalBlacklist.forEach((item) => {
    if (!item) return;
    const name = (typeof item === 'string' ? item : item.name).toLowerCase().trim();
    if (name) {
      blacklistedAccountsSet.add(name);
      accountDetailsMap.set(name, {
        name,
        source: 'personal',
        sourceOwner: getBlacklistObserver(),
        description: item.blacklist_description || item.reason || '',
        mutedDescription: item.muted_list_description || '',
        addedAt: item.addedAt || null,
      });
    }
  });

  // 2. Contas das blacklists seguidas (se ativado)
  if (includeFollowedInFilter && Array.isArray(followedBlacklists)) {
    followedBlacklists.forEach((list) => {
      if (!list || !list.name) return;
      const listOwner = list.name.toLowerCase().trim();
      const listDesc = list.blacklist_description || list.muted_list_description || '';

      if (Array.isArray(list.accounts)) {
        list.accounts.forEach((acc) => {
          const accName = (typeof acc === 'string' ? acc : acc.name).toLowerCase().trim();
          if (!accName) return;

          blacklistedAccountsSet.add(accName);
          // Se já estava na blacklist pessoal, mantém pessoal como primária
          if (!accountDetailsMap.has(accName)) {
            accountDetailsMap.set(accName, {
              name: accName,
              source: 'followed',
              sourceOwner: listOwner,
              description: acc.blacklist_description || listDesc,
              listOwnerDescription: listDesc,
            });
          }
        });
      }
    });
  }
}

/**
 * Obtém o observador configurado (ou usuário autenticado)
 */
export function getBlacklistObserver() {
  if (currentUser?.username) {
    return currentUser.username.toLowerCase();
  }
  return (currentObserver || 'sm-silva').toLowerCase();
}

/**
 * Define o observador utilizado para consulta na blockchain
 */
export function setBlacklistObserver(newObserver) {
  if (!newObserver) return;
  currentObserver = newObserver.trim().toLowerCase().replace(/^@/, '');
  localStorage.setItem(STORAGE_KEY_OBSERVER, currentObserver);
}

/**
 * Verifica se uma conta está na blacklist on-chain ativa
 * @param {string} username
 * @returns {boolean}
 */
export function isAccountOnchainBlacklisted(username) {
  if (!username) return false;
  const clean = String(username).toLowerCase().trim().replace(/^@/, '');
  return blacklistedAccountsSet.has(clean);
}

/**
 * Retorna detalhes ricos sobre o status de blacklist de uma conta
 * @param {string} username
 * @returns {Object|null}
 */
export function getAccountBlacklistDetails(username) {
  if (!username) return null;
  const clean = String(username).toLowerCase().trim().replace(/^@/, '');
  return accountDetailsMap.get(clean) || null;
}

/**
 * Retorna a contagem total de contas ativas na blacklist
 */
export function getOnchainBlacklistedCount() {
  return blacklistedAccountsSet.size;
}

/**
 * Retorna a lista de contas na blacklist pessoal
 */
export function getPersonalBlacklist() {
  return [...personalBlacklist];
}

/**
 * Retorna as listas de outros moderadores seguidas pelo observador
 */
export function getFollowedBlacklists() {
  return [...followedBlacklists];
}

/**
 * Retorna se as contas das blacklists seguidas estão incluídas no filtro
 */
export function getShouldIncludeFollowed() {
  return includeFollowedInFilter;
}

/**
 * Altera a configuração de incluir ou não as blacklists seguidas no filtro
 */
export function setShouldIncludeFollowed(include) {
  includeFollowedInFilter = Boolean(include);
  localStorage.setItem(STORAGE_KEY_INCLUDE_FOLLOWED, String(includeFollowedInFilter));
  rebuildConsolidatedBlacklist();
  notifyUpdateListeners();
}

/**
 * Registra um callback para ser notificado quando a lista mudar
 */
export function subscribeToBlacklistUpdates(callback) {
  if (typeof callback === 'function') {
    updateListeners.add(callback);
  }
  return () => updateListeners.delete(callback);
}

function notifyUpdateListeners() {
  const info = {
    count: blacklistedAccountsSet.size,
    personalCount: personalBlacklist.length,
    followedListsCount: followedBlacklists.length,
    observer: getBlacklistObserver(),
    includeFollowed: includeFollowedInFilter,
    lastSync: lastSyncTimestamp,
  };

  updateListeners.forEach((fn) => {
    try {
      fn(info);
    } catch (e) {
      console.error('[OnchainBlacklist] Erro no listener:', e);
    }
  });
}

/**
 * Adiciona uma conta à lista pessoal em memória e no cache local
 */
export function addOnchainBlacklistedAccount(username, metadata = {}) {
  if (!username) return;
  const clean = String(username).toLowerCase().trim().replace(/^@/, '');

  const exists = personalBlacklist.some(
    (item) => (typeof item === 'string' ? item : item.name).toLowerCase() === clean
  );

  const reason = metadata.reason || metadata.blacklist_description || 'Adicionado via Keychain';

  if (!exists) {
    personalBlacklist.unshift({
      name: clean,
      blacklist_description: reason,
      muted_list_description: '',
      addedAt: new Date().toISOString(),
    });
  } else {
    // Atualiza descrição se fornecida
    const idx = personalBlacklist.findIndex(
      (item) => (typeof item === 'string' ? item : item.name).toLowerCase() === clean
    );
    if (idx !== -1) {
      personalBlacklist[idx].blacklist_description = reason;
    }
  }

  rebuildConsolidatedBlacklist();
  saveCacheToStorage();
  notifyUpdateListeners();
}

/**
 * Remove uma conta da lista pessoal
 */
export function removeOnchainBlacklistedAccount(username) {
  if (!username) return;
  const clean = String(username).toLowerCase().trim().replace(/^@/, '');

  personalBlacklist = personalBlacklist.filter(
    (item) => (typeof item === 'string' ? item : item.name).toLowerCase() !== clean
  );

  rebuildConsolidatedBlacklist();
  saveCacheToStorage();
  notifyUpdateListeners();
}

/**
 * Salva com segurança no localStorage prevenindo estouro de quota
 */
function saveCacheToStorage() {
  try {
    const personalPayload = {
      observer: getBlacklistObserver(),
      timestamp: lastSyncTimestamp,
      accounts: personalBlacklist,
    };
    localStorage.setItem(STORAGE_KEY_PERSONAL, JSON.stringify(personalPayload));

    // Para as listas seguidas, salva metadados e resumo sem estourar o limite de 5MB
    const followedMeta = followedBlacklists.map((f) => ({
      name: f.name,
      blacklist_description: f.blacklist_description || '',
      muted_list_description: f.muted_list_description || '',
      count: f.count || (Array.isArray(f.accounts) ? f.accounts.length : 0),
      // Se a lista de contas for razoável (< 3000 itens), salva; se for gigante (como themarkymark com 70k), não infla o localStorage
      accounts: Array.isArray(f.accounts) && f.accounts.length < 3000 ? f.accounts : [],
    }));

    localStorage.setItem(STORAGE_KEY_FOLLOWED_LISTS, JSON.stringify(followedMeta));
  } catch (err) {
    console.warn('[OnchainBlacklist] Aviso ao persistir cache local (quota ou restrição):', err.message);
  }
}

/**
 * Executa uma chamada RPC para a API Hive bridge
 */
async function callBridgeApi(method, params) {
  const payload = {
    jsonrpc: '2.0',
    method: method,
    id: Math.floor(Math.random() * 10000) + 1,
    params: params,
  };

  let lastError = null;
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json.error) throw new Error(json.error.message || 'RPC Error');
      return json.result || [];
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Falha em todos os endpoints RPC.');
}

/**
 * Sincroniza a blacklist pessoal e as blacklists seguidas na blockchain Hive via bridge.get_follow_list
 * @param {string} [customObserver]
 * @param {boolean} [forceRefresh=false]
 */
export async function syncOnchainBlacklist(customObserver = null, forceRefresh = false) {
  const observer = (customObserver || getBlacklistObserver()).toLowerCase().trim().replace(/^@/, '');

  // 1. Consulta a Blacklist Pessoal do Observador (follow_type: 'blacklisted')
  console.log(`[OnchainBlacklist] Sincronizando blacklist pessoal para @${observer}...`);
  const personalRaw = await callBridgeApi('bridge.get_follow_list', {
    observer: observer,
    follow_type: 'blacklisted',
  });

  personalBlacklist = (personalRaw || []).map((item) => ({
    name: String(item.name || '').toLowerCase().trim(),
    blacklist_description: item.blacklist_description || '',
    muted_list_description: item.muted_list_description || '',
  })).filter((item) => item.name);

  // 2. Consulta as Blacklists Seguidas pelo Observador (follow_type: 'follow_blacklist')
  console.log(`[OnchainBlacklist] Sincronizando blacklists seguidas para @${observer}...`);
  let followedRaw = [];
  try {
    followedRaw = await callBridgeApi('bridge.get_follow_list', {
      observer: observer,
      follow_type: 'follow_blacklist',
    });
  } catch (e) {
    console.warn('[OnchainBlacklist] Erro ao buscar follow_blacklist:', e.message);
  }

  const followedSummary = [];
  for (const f of followedRaw || []) {
    if (!f || !f.name) continue;
    const fName = String(f.name).toLowerCase().trim();

    // Busca as contas da lista seguida
    let listAccounts = [];
    try {
      console.log(`[OnchainBlacklist] Buscando contas da lista seguida @${fName}...`);
      const subList = await callBridgeApi('bridge.get_follow_list', {
        observer: fName,
        follow_type: 'blacklisted',
      });
      listAccounts = (subList || []).map((item) => ({
        name: String(item.name || '').toLowerCase().trim(),
        blacklist_description: item.blacklist_description || '',
        muted_list_description: item.muted_list_description || '',
      })).filter((i) => i.name);
    } catch (subErr) {
      console.warn(`[OnchainBlacklist] Não foi possível carregar contas de @${fName}:`, subErr.message);
      // Preserva cache prévio se existia
      const existing = followedBlacklists.find((prev) => prev.name === fName);
      if (existing && Array.isArray(existing.accounts)) {
        listAccounts = existing.accounts;
      }
    }

    followedSummary.push({
      name: fName,
      blacklist_description: f.blacklist_description || '',
      muted_list_description: f.muted_list_description || '',
      count: listAccounts.length,
      accounts: listAccounts,
    });
  }

  followedBlacklists = followedSummary;
  lastSyncTimestamp = Date.now();
  currentObserver = observer;

  rebuildConsolidatedBlacklist();
  saveCacheToStorage();
  notifyUpdateListeners();

  return {
    observer: observer,
    personalCount: personalBlacklist.length,
    followedListsCount: followedBlacklists.length,
    totalBlacklistedCount: blacklistedAccountsSet.size,
    personalBlacklist: personalBlacklist,
    followedBlacklists: followedBlacklists,
  };
}
