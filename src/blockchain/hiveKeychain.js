// src/blockchain/hiveKeychain.js

import { currentUser } from '../config.js';
import { muteUser, unmuteUser } from '../moderation/muting.js';
import { showNotification } from '../ui/notifications.js';
import { addOnchainBlacklistedAccount, removeOnchainBlacklistedAccount } from '../api/onchainBlacklistService.js';

const STORAGE_KEY_BLACKLIST = 'hive_onchain_blacklist_history';

/**
 * Verifica se a extensão Hive Keychain está presente no navegador
 */
export function isKeychainInstalled() {
  return typeof window !== 'undefined' && Boolean(window.hive_keychain);
}

/**
 * Aguarda a injeção da extensão Hive Keychain caso ainda esteja carregando
 */
export function waitForKeychain(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (isKeychainInstalled()) {
      return resolve(true);
    }
    const startTime = Date.now();
    const interval = setInterval(() => {
      if (isKeychainInstalled()) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - startTime >= timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 100);
  });
}

/**
 * Efetua login autenticado solicitando assinatura de buffer via Hive Keychain
 * @param {string} rawUsername
 * @returns {Promise<Object>}
 */
export function loginWithHiveKeychain(rawUsername) {
  return new Promise((resolve, reject) => {
    if (!isKeychainInstalled()) {
      return reject(
        new Error('Hive Keychain extension not found. Make sure it is installed and enabled.')
      );
    }

    const cleanUser = String(rawUsername || '')
      .trim()
      .toLowerCase()
      .replace(/^@/, '');

    if (!cleanUser || cleanUser.length < 3) {
      return reject(new Error('Enter a valid Hive username (at least 3 characters).'));
    }

    const timestamp = new Date().toISOString();
    const challengeMessage = `Hive Moderation Dashboard Auth\nUser: @${cleanUser}\nDate: ${timestamp}`;

    window.hive_keychain.requestSignBuffer(
      cleanUser,
      challengeMessage,
      'Posting',
      (response) => {
        if (!response) {
          return reject(new Error('No response received from Hive Keychain.'));
        }

        if (response.success) {
          const userSession = {
            username: cleanUser,
            role: 'moderator',
            loginMethod: 'keychain',
            publicKey: response.publicKey || null,
            signedAt: timestamp,
            avatar: `https://images.hive.blog/u/${cleanUser}/avatar/small`,
          };
          resolve(userSession);
        } else {
          const errorMsg = response.message || response.error || 'Authentication canceled or rejected in Keychain.';
          reject(new Error(errorMsg));
        }
      }
    );
  });
}

/**
 * Transmite uma operação custom_json para a Hive Blockchain via Keychain
 * @param {string} username
 * @param {string} id - Identificador custom_json (ex: 'follow', 'hive_moderation')
 * @param {string} keyType - 'Posting' ou 'Active'
 * @param {string} jsonString - Payload serializado em JSON
 * @param {string} displayName - Texto descritivo exibido na popup do Keychain
 * @returns {Promise<Object>}
 */
export function broadcastCustomJson(username, id, keyType, jsonString, displayName) {
  return new Promise((resolve, reject) => {
    if (!isKeychainInstalled()) {
      return reject(new Error('Hive Keychain is not available in this browser.'));
    }

    window.hive_keychain.requestCustomJson(
      username,
      id,
      keyType || 'Posting',
      jsonString,
      displayName || 'Hive Moderation Operation',
      (response) => {
        if (!response) {
          return reject(new Error('No response received from Hive Keychain.'));
        }

        if (response.success) {
          resolve(response);
        } else {
          const errorMsg = response.message || response.error || 'Operation canceled or rejected in Keychain.';
          reject(new Error(errorMsg));
        }
      }
    );
  });
}

/**
 * Transmite a inclusão ou remoção de usuário na Blacklist on-chain via custom_json
 * Suporta:
 * 1. Padrão Hive Universal ("follow" com ["ignore"])
 * 2. Protocolo de Moderação com Metadados ("hive_moderation")
 * 3. Ambos ("both")
 */
export async function broadcastBlacklistUser({
  targetUser,
  action = 'blacklist',
  reason = 'Spam / Abuse',
  severity = 'high',
  notes = '',
  protocol = 'both',
}) {
  const broadcaster = currentUser?.username;
  if (!broadcaster) {
    throw new Error('You must be signed in to your Hive account to broadcast on the blockchain.');
  }

  const cleanTarget = String(targetUser || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');

  if (!cleanTarget || cleanTarget.length < 3) {
    throw new Error('Invalid target account.');
  }

  if (cleanTarget === broadcaster) {
    throw new Error('You cannot add your own account to the blacklist.');
  }

  const timestamp = new Date().toISOString();
  const results = [];

  // 1. Operação Padrão Hive (follow: blacklist)
  if (protocol === 'follow' || protocol === 'both') {
    const followObj = {
      follower: broadcaster,
      following: cleanTarget,
      what: action === 'blacklist' ? ['blacklist'] : [],
    };
    if (action === 'blacklist' && reason) {
      followObj.blacklist_description = reason;
    }

    const followPayload = ['follow', followObj];

    const followJson = JSON.stringify(followPayload);
    const displayName =
      action === 'blacklist'
        ? `Hive Blacklist: Add @${cleanTarget}`
        : `Hive Blacklist: Remove @${cleanTarget}`;

    const resFollow = await broadcastCustomJson(
      broadcaster,
      'follow',
      'Posting',
      followJson,
      displayName
    );
    results.push({ type: 'follow', response: resFollow });
    if (action === 'blacklist') {
      addOnchainBlacklistedAccount(cleanTarget, { reason, severity, notes }, broadcaster);
    } else {
      removeOnchainBlacklistedAccount(cleanTarget, broadcaster);
    }
  }

  // 2. Operação Estruturada de Moderação (hive_moderation)
  if (protocol === 'hive_moderation' || protocol === 'both') {
    const moderationPayload = {
      app: 'hive-moderation-dashboard/1.0',
      action: action === 'blacklist' ? 'blacklist' : 'unblacklist',
      account: cleanTarget,
      reason: reason || 'Not specified',
      blacklist_description: reason || 'Not specified',
      severity: severity || 'medium',
      notes: notes || '',
      moderator: broadcaster,
      timestamp: timestamp,
    };

    const modJson = JSON.stringify(moderationPayload);
    const displayName =
      action === 'blacklist'
        ? `Hive Moderation: Blacklist @${cleanTarget}`
        : `Hive Moderation: Remove @${cleanTarget} from the blacklist`;

    const resMod = await broadcastCustomJson(
      broadcaster,
      'hive_moderation',
      'Posting',
      modJson,
      displayName
    );
    results.push({ type: 'hive_moderation', response: resMod });
  }

  // Atualiza histórico local de blacklist on-chain
  const txId = results[0]?.response?.result?.id || results[0]?.response?.data?.tx_id || `tx_${Date.now()}`;
  
  if (action === 'blacklist') {
    saveOnchainBlacklistRecord({
      account: cleanTarget,
      reason: reason,
      severity: severity,
      notes: notes,
      protocol: protocol,
      moderator: broadcaster,
      timestamp: timestamp,
      txId: txId,
    });

    // Muta localmente também para atualização imediata dos cards
    muteUser(cleanTarget);
  } else {
    removeOnchainBlacklistRecord(cleanTarget);
    unmuteUser(cleanTarget);
  }

  return {
    success: true,
    target: cleanTarget,
    action: action,
    txId: txId,
    results: results,
  };
}

/**
 * Retorna o histórico de usuários colocados na blacklist on-chain
 */
export function getOnchainBlacklistHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BLACKLIST);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Erro ao ler histórico de blacklist:', e);
    return [];
  }
}

/**
 * Salva um registro no histórico local de blacklist on-chain
 */
export function saveOnchainBlacklistRecord(record) {
  try {
    const list = getOnchainBlacklistHistory();
    const filtered = list.filter(
      (item) => item.account.toLowerCase() !== record.account.toLowerCase()
    );
    filtered.unshift(record);
    localStorage.setItem(STORAGE_KEY_BLACKLIST, JSON.stringify(filtered));
  } catch (e) {
    console.error('Erro ao salvar registro de blacklist:', e);
  }
}

/**
 * Remove um registro do histórico local de blacklist on-chain
 */
export function removeOnchainBlacklistRecord(account) {
  try {
    const clean = String(account).toLowerCase().replace(/^@/, '');
    const list = getOnchainBlacklistHistory();
    const filtered = list.filter((item) => item.account.toLowerCase() !== clean);
    localStorage.setItem(STORAGE_KEY_BLACKLIST, JSON.stringify(filtered));
  } catch (e) {
    console.error('Erro ao remover registro de blacklist:', e);
  }
}

/**
 * Verifica se um usuário está no histórico de blacklist on-chain
 */
export function isUserBlacklistedOnchain(account) {
  const clean = String(account || '').toLowerCase().replace(/^@/, '');
  const list = getOnchainBlacklistHistory();
  return list.some((item) => item.account.toLowerCase() === clean);
}

/**
 * Transmite um downvote (flag de recompensas) para a Hive blockchain via Hive Keychain
 * @param {Object} params
 * @param {string} params.author - Autor do post
 * @param {string} params.permlink - Permlink do post
 * @param {number} [params.weight=-10000] - Peso do downvote em basis points (-10000 a -1)
 * @returns {Promise<Object>}
 */
export function broadcastDownvote({ author, permlink, weight = -10000 }) {
  return new Promise((resolve, reject) => {
    if (!isKeychainInstalled()) {
      return reject(
        new Error('Hive Keychain extension not found. Install the extension or open the app in a new tab.')
      );
    }

    const voter = currentUser?.username;
    if (!voter) {
      return reject(
        new Error('You must be signed in with Hive Keychain to vote or downvote.')
      );
    }

    const cleanAuthor = String(author || '').trim().toLowerCase().replace(/^@/, '');
    if (!cleanAuthor || !permlink) {
      return reject(new Error('Invalid post author or permlink.'));
    }

    // Garante que o peso seja negativo entre -10000 e -1 (-100% a -0.01%)
    let numWeight = parseInt(weight, 10);
    if (isNaN(numWeight)) numWeight = -10000;
    if (numWeight > 0) numWeight = -numWeight;
    if (numWeight < -10000) numWeight = -10000;
    if (numWeight > -1) numWeight = -10000;

    window.hive_keychain.requestVote(
      voter,
      permlink,
      cleanAuthor,
      numWeight,
      (response) => {
        if (!response) {
          return reject(new Error('No response received from Hive Keychain.'));
        }
        if (response.success) {
          resolve({
            success: true,
            voter: voter,
            author: cleanAuthor,
            permlink: permlink,
            weight: numWeight,
            response: response,
          });
        } else {
          const msg = response.message || response.error || 'Downvote cancelado ou recusado no Keychain.';
          reject(new Error(msg));
        }
      }
    );
  });
}

export const MAX_BULK_DOWNVOTES = 20;

export function broadcastBulkDownvotes(posts, weight) {
  const keychain = window.hive_keychain;
  const voter = currentUser?.username;
  if (!voter || currentUser.loginMethod === 'guest') {
    throw new Error('Sign in with Hive Keychain to downvote.');
  }
  if (typeof keychain?.requestBroadcast !== 'function') {
    throw new Error('Hive Keychain does not support bulk broadcasting in this browser.');
  }
  if (posts.length < 1 || posts.length > MAX_BULK_DOWNVOTES ||
      !Number.isInteger(weight) || weight < -10000 || weight > -1) {
    throw new Error('Invalid downvote selection or weight.');
  }

  const targets = new Set();
  const operations = posts.map(({ author, permlink }) => {
    const target = `${author}/${permlink}`;
    if (!author || !permlink || targets.has(target)) {
      throw new Error('Each vote must target a different valid Hive post.');
    }
    targets.add(target);
    return ['vote', { voter, author, permlink, weight }];
  });

  return new Promise((resolve, reject) => {
    keychain.requestBroadcast(voter, operations, 'Posting', response => {
      if (response?.success) resolve(response);
      else reject(new Error(response?.message || response?.error || 'Hive Keychain did not confirm the downvotes.'));
    });
  });
}

/**
 * Segue ou deixa de seguir a blacklist de outro usuário na Hive via Hive Keychain (Custom JSON follow: follow_blacklist)
 * @param {Object} params
 * @param {string} params.targetListAccount - Conta dona da blacklist a ser seguida (ex: 'themarkymark', 'faireye')
 * @param {'follow_blacklist'|'unfollow_blacklist'} [params.action='follow_blacklist']
 * @returns {Promise<Object>}
 */
export async function broadcastFollowBlacklist({
  targetListAccount,
  action = 'follow_blacklist',
}) {
  const broadcaster = currentUser?.username;
  if (!broadcaster) {
    throw new Error('You must be signed in to your Hive account to broadcast on the blockchain.');
  }

  const cleanTarget = String(targetListAccount || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');

  if (!cleanTarget || cleanTarget.length < 3) {
    throw new Error('Invalid username for the list you want to follow.');
  }

  if (cleanTarget === broadcaster) {
    throw new Error('You cannot follow your own blacklist.');
  }

  const what = action === 'follow_blacklist' ? ['follow_blacklist'] : ['unfollow_blacklist'];
  const followPayload = [
    'follow',
    {
      follower: broadcaster,
      following: cleanTarget,
      what: what,
    },
  ];

  const followJson = JSON.stringify(followPayload);
  const displayName =
    action === 'follow_blacklist'
      ? `Follow Hive Blacklist: @${cleanTarget}`
      : `Unfollow Hive Blacklist: @${cleanTarget}`;

  const res = await broadcastCustomJson(
    broadcaster,
    'follow',
    'Posting',
    followJson,
    displayName
  );

  return {
    success: true,
    target: cleanTarget,
    action: action,
    response: res,
  };
}

