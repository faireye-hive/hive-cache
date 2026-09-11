// src/api/reputationService.js

import { showNotification } from '../ui/notifications.js';
import { getReputationSyncMode } from '../config.js';

const STORAGE_KEY = 'hive_author_reputations_v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias de validade no cache

// APIs de reputação individuais com CORS aberto
const REPUTATION_ENDPOINTS = [
  (acc) => `https://api.hive.blog/reputation-api/accounts/${acc}/reputation`,
  (acc) => `https://rpc.mahdiyari.info/hafsql/reputations/${acc}`,
];

// Nós RPC da blockchain Hive com alta disponibilidade e resposta rápida
export const HIVE_RPC_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://api.deathwing.me',
  'https://rpc.mahdiyari.info',
];

// Cache em memória
const reputationMemoryCache = new Map();
const pendingFetches = new Map(); // evita requisições duplicadas simultâneas

/**
 * Alimenta o cache de reputação diretamente a partir dos posts carregados (ex: data.json)
 * Evita requisições redundantes de rede para autores que já vieram com author_reputation
 * @param {Array} posts
 */
export function seedReputationCacheFromPosts(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return;
  const batchToSave = new Map();

  posts.forEach((p) => {
    if (!p || !p.author) return;
    const author = String(p.author).trim().toLowerCase().replace(/^@/, '');
    if (!author) return;

    // Se o post já possui author_reputation calculado
    if (typeof p.author_reputation === 'number' && !isNaN(p.author_reputation)) {
      const score = Math.round(p.author_reputation);
      if (!reputationMemoryCache.has(author)) {
        reputationMemoryCache.set(author, score);
        batchToSave.set(author, score);
      }
    }
  });

  if (batchToSave.size > 0) {
    saveBatchToLocalStorage(batchToSave);
  }
}

// Inicializa lendo do localStorage (Sistema Híbrido: Cache Local Instantâneo)
(function initCacheFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      const now = Date.now();
      for (const [author, entry] of Object.entries(data)) {
        if (entry && typeof entry.score === 'number' && now - (entry.updatedAt || 0) < CACHE_TTL_MS) {
          reputationMemoryCache.set(author.toLowerCase(), entry.score);
        }
      }
    }
  } catch (e) {
    console.error('Erro ao ler cache de reputação:', e);
  }
})();

let pendingServerBackup = {};
let serverBackupTimeout = null;

function scheduleServerReputationBackup(scoresObj) {
  Object.assign(pendingServerBackup, scoresObj);
  if (serverBackupTimeout) clearTimeout(serverBackupTimeout);
  serverBackupTimeout = setTimeout(async () => {
    const toSend = { ...pendingServerBackup };
    pendingServerBackup = {};
    if (Object.keys(toSend).length === 0) return;
    try {
      await fetch('/api/reputations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reputations: toSend }),
      });
    } catch (e) {
      // Ignora silenciosamente se o endpoint não estiver acessível
    }
  }, 2500);
}

/**
 * Carrega o arquivo backup reputations.json do servidor para inicialização instantânea
 */
export async function loadReputationsBackupFile() {
  try {
    const res = await fetch('/reputations.json');
    if (res.ok) {
      const data = await res.json();
      const reps = data.reputations || data;
      if (reps && typeof reps === 'object') {
        const batch = new Map();
        for (const [author, score] of Object.entries(reps)) {
          if (typeof score === 'number') {
            const clean = author.toLowerCase().trim().replace(/^@/, '');
            reputationMemoryCache.set(clean, score);
            batch.set(clean, score);
            updateAuthorReputationBadges(clean, score);
          }
        }
        if (batch.size > 0) {
          saveBatchToLocalStorage(batch, false);
        }
        console.log(`[ReputationService] Inicializadas ${batch.size} reputações do arquivo de backup.`);
        return batch.size;
      }
    }
  } catch (err) {
    console.warn('[ReputationService] Aviso ao carregar backup de reputações:', err.message);
  }
  return 0;
}

function saveToLocalStorage(author, score) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    data[author.toLowerCase()] = {
      score: score,
      updatedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    scheduleServerReputationBackup({ [author.toLowerCase()]: score });
  } catch (e) {
    console.error('Erro ao persistir reputação no localStorage:', e);
  }
}

function saveBatchToLocalStorage(mapOfScores, syncToServer = true) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    const serverObj = {};
    for (const [author, score] of mapOfScores.entries()) {
      data[author.toLowerCase()] = {
        score: score,
        updatedAt: now,
      };
      serverObj[author.toLowerCase()] = score;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (syncToServer && Object.keys(serverObj).length > 0) {
      scheduleServerReputationBackup(serverObj);
    }
  } catch (e) {
    console.error('Erro ao persistir lote de reputação no localStorage:', e);
  }
}

/**
 * Retorna estatísticas do cache de reputação
 */
export function getReputationCacheStats() {
  let storageCount = 0;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      storageCount = Object.keys(JSON.parse(raw)).length;
    }
  } catch (e) {
    storageCount = reputationMemoryCache.size;
  }
  return {
    memoryCount: reputationMemoryCache.size,
    storageCount: storageCount,
    ttlDays: 7,
  };
}

/**
 * Limpa todo o cache de reputação (memória e localStorage)
 */
export function clearReputationCache() {
  reputationMemoryCache.clear();
  pendingFetches.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Erro ao remover cache do storage:', e);
  }
}

/**
 * Retorna a reputação em cache se existir
 * @param {string} rawAuthor
 * @returns {number|null}
 */
export function getCachedReputation(rawAuthor) {
  if (!rawAuthor) return null;
  const author = String(rawAuthor).trim().toLowerCase().replace(/^@/, '');
  return reputationMemoryCache.has(author) ? reputationMemoryCache.get(author) : null;
}

/**
 * Converte valor bruto de reputação da blockchain para a escala amigável (-100 a +100)
 */
export function formatRawReputation(rawVal) {
  if (rawVal === null || rawVal === undefined || rawVal === '') return 25;
  const num = parseFloat(rawVal);
  if (isNaN(num)) return 25;

  // Se já vier no formato amigável padrão (ex: 70, 76.11, 11.74, etc.)
  if (num >= -100 && num <= 100) {
    return Math.round(num);
  }

  // Caso seja a reputação crua de 64 bits da blockchain Hive
  const isNegative = num < 0;
  const absVal = Math.abs(num);
  if (absVal === 0) return 25;

  let rep = Math.log10(absVal);
  rep = Math.max(rep - 9, 0);
  if (rep <= 0) return isNegative ? -25 : 25;

  let score = isNegative ? -1 : 1;
  score = score * rep * 9 + 25;
  return Math.round(score);
}

/**
 * Sincroniza reputações de múltiplos autores em lote via RPC nativo da Hive (SEM HAFSQL).
 * Utiliza o método bridge.get_profile em JSON-RPC Batch de 20 contas por lote (limite seguro da Hive).
 * @param {string[]} authors
 * @param {boolean} forceRefresh
 * @returns {Promise<Map<string, number>>}
 */
export async function fetchReputationsRpcBatch(authors, forceRefresh = false) {
  if (!Array.isArray(authors) || authors.length === 0) return new Map();

  const toFetch = [
    ...new Set(
      authors
        .map((a) => String(a || '').trim().toLowerCase().replace(/^@/, ''))
        .filter((a) => a && (forceRefresh || !reputationMemoryCache.has(a)))
    ),
  ];

  const results = new Map();
  if (toFetch.length === 0) {
    authors.forEach((a) => {
      const clean = String(a || '').trim().toLowerCase().replace(/^@/, '');
      if (clean && reputationMemoryCache.has(clean)) {
        results.set(clean, reputationMemoryCache.get(clean));
      }
    });
    return results;
  }

  // Lotes de 20 autores (respeita o padrão de segurança e estabilidade da Hive)
  const BATCH_SIZE = 20;
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const chunk = toFetch.slice(i, i + BATCH_SIZE);
    let success = false;

    // Constrói payload de batch JSON-RPC com bridge.get_profile
    const batchBody = chunk.map((authorName, idx) => ({
      jsonrpc: '2.0',
      method: 'bridge.get_profile',
      params: { account: authorName },
      id: idx + 1,
    }));

    for (const node of HIVE_RPC_NODES) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(node, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(batchBody),
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const json = await response.json();
          if (Array.isArray(json) && json.length > 0) {
            const batchScores = new Map();

            json.forEach((item) => {
              if (item?.result && item.result.name && item.result.reputation !== undefined) {
                const authorName = String(item.result.name).toLowerCase();
                const score = formatRawReputation(item.result.reputation);
                reputationMemoryCache.set(authorName, score);
                batchScores.set(authorName, score);
                results.set(authorName, score);
                updateAuthorReputationBadges(authorName, score);
              }
            });

            // Para autores do chunk que possam ser contas neutras sem perfil preenchido
            for (const accName of chunk) {
              if (!batchScores.has(accName)) {
                // Tenta fallback rápido para a api direta
                try {
                  const fastRes = await fetch(`https://api.hive.blog/reputation-api/accounts/${accName}/reputation`);
                  if (fastRes.ok) {
                    const txt = (await fastRes.text()).trim();
                    const fastScore = formatRawReputation(txt);
                    reputationMemoryCache.set(accName, fastScore);
                    batchScores.set(accName, fastScore);
                    results.set(accName, fastScore);
                    updateAuthorReputationBadges(accName, fastScore);
                    continue;
                  }
                } catch (e) {}

                // Se não respondeu, assume 25
                const defScore = 25;
                reputationMemoryCache.set(accName, defScore);
                batchScores.set(accName, defScore);
                results.set(accName, defScore);
                updateAuthorReputationBadges(accName, defScore);
              }
            }

            saveBatchToLocalStorage(batchScores);
            success = true;
            break;
          }
        }
      } catch (err) {
        // Tenta próximo nó
      }
    }

    // Se nenhum nó RPC respondeu o batch JSON-RPC, tenta fallback individual
    if (!success) {
      await Promise.allSettled(chunk.map((a) => fetchAuthorReputation(a, forceRefresh)));
    }
  }

  return results;
}

/**
 * Atualiza todas as reputações dos autores da lista usando HAFSQL (Modo Total / Forçar HAFSQL)
 * Endpoint: https://rpc.mahdiyari.info/hafsql/reputations/${author}
 * @param {string[]} authors
 * @param {Function} [onProgress] - callback (doneCount, totalCount, lastAuthor, lastScore)
 * @returns {Promise<{ updatedCount: number, errorsCount: number }>}
 */
export async function syncAllWithHafsql(authors, onProgress = null) {
  if (!Array.isArray(authors) || authors.length === 0) {
    return { updatedCount: 0, errorsCount: 0 };
  }

  const uniqueAuthors = [
    ...new Set(
      authors
        .map((a) => String(a || '').trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean)
    ),
  ];

  let updatedCount = 0;
  let errorsCount = 0;
  const batchScores = new Map();
  const CONCURRENCY = 6;

  for (let i = 0; i < uniqueAuthors.length; i += CONCURRENCY) {
    const batch = uniqueAuthors.slice(i, i + CONCURRENCY);

    await Promise.allSettled(
      batch.map(async (author) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);

          const res = await fetch(`https://rpc.mahdiyari.info/hafsql/reputations/${author}`, {
            headers: { Accept: 'application/json, text/plain, */*' },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (res.ok) {
            const text = await res.text();
            let parsedVal = null;
            if (!isNaN(text.trim())) {
              parsedVal = parseFloat(text.trim());
            } else {
              try {
                const j = JSON.parse(text);
                parsedVal = j.reputation ?? j.rep ?? j.result;
              } catch (e) {}
            }

            const finalScore = formatRawReputation(parsedVal !== null ? parsedVal : 25);
            reputationMemoryCache.set(author, finalScore);
            batchScores.set(author, finalScore);
            updateAuthorReputationBadges(author, finalScore);
            updatedCount++;

            if (typeof onProgress === 'function') {
              onProgress(updatedCount, uniqueAuthors.length, author, finalScore);
            }
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch (err) {
          // Se falhar no HAFSQL específico, tenta via RPC como fallback
          try {
            const fallbackScore = await fetchAuthorReputation(author, true);
            batchScores.set(author, fallbackScore);
            updatedCount++;
          } catch (e) {
            errorsCount++;
          }
        }
      })
    );

    // Salva progresso no localStorage
    saveBatchToLocalStorage(batchScores);
  }

  return { updatedCount, errorsCount };
}

/**
 * Busca a reputação de um autor em uma das APIs fornecidas, com fallback inteligente
 * @param {string} rawAuthor
 * @param {boolean} forceRefresh
 * @returns {Promise<number>}
 */
export async function fetchAuthorReputation(rawAuthor, forceRefresh = false) {
  const author = String(rawAuthor || '').trim().toLowerCase().replace(/^@/, '');
  if (!author) return 25;

  // Se já estiver no cache e não for forçado, retorna imediatamente
  if (!forceRefresh && reputationMemoryCache.has(author)) {
    return reputationMemoryCache.get(author);
  }

  // Evita múltiplas requisições paralelas para o mesmo autor
  if (pendingFetches.has(author)) {
    return pendingFetches.get(author);
  }

  const fetchPromise = (async () => {
    let finalScore = null;
    const mode = getReputationSyncMode();

    // 1. Tenta bridge.get_profile nos nós Hive RPC
    for (const node of HIVE_RPC_NODES) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const rpcRes = await fetch(node, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'bridge.get_profile',
            params: { account: author },
            id: 1,
          }),
        });
        clearTimeout(timeoutId);

        if (rpcRes.ok) {
          const data = await rpcRes.json();
          if (data?.result?.reputation !== undefined && data.result.reputation !== null) {
            finalScore = formatRawReputation(data.result.reputation);
            break;
          }
        }
      } catch (err) {
        // Próximo node
      }
    }

    // 2. Se ainda não encontrou, tenta as APIs de reputação direta
    if (finalScore === null) {
      for (const makeUrl of REPUTATION_ENDPOINTS) {
        try {
          const url = makeUrl(author);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);

          const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: 'application/json, text/plain, */*' },
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const text = await response.text();
            const trimmed = text.trim();

            let parsedVal = null;
            if (!isNaN(trimmed)) {
              parsedVal = parseFloat(trimmed);
            } else {
              try {
                const json = JSON.parse(trimmed);
                parsedVal = json.reputation ?? json.rep ?? json.result;
              } catch (e) {}
            }

            if (parsedVal !== null && !isNaN(parsedVal)) {
              finalScore = formatRawReputation(parsedVal);
              break;
            }
          }
        } catch (err) {}
      }
    }

    // 3. Fallback final: condenser_api.get_account_reputations
    if (finalScore === null) {
      for (const node of HIVE_RPC_NODES) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3500);

          const rpcRes = await fetch(node, {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'condenser_api.get_account_reputations',
              params: [author, 1],
              id: 1,
            }),
          });
          clearTimeout(timeoutId);

          if (rpcRes.ok) {
            const data = await rpcRes.json();
            if (Array.isArray(data?.result) && data.result[0]?.account === author && data.result[0]?.reputation !== undefined) {
              finalScore = formatRawReputation(data.result[0].reputation);
              break;
            }
          }
        } catch (err) {}
      }
    }

    // Se ainda assim falhar, define 25 (reputação neutra de nova conta)
    if (finalScore === null) {
      finalScore = 25;
    }

    // Salva no cache em memória e persistência
    reputationMemoryCache.set(author, finalScore);
    saveToLocalStorage(author, finalScore);

    // Atualiza todos os elementos visuais na página correspondentes a esse autor
    updateAuthorReputationBadges(author, finalScore);

    pendingFetches.delete(author);
    return finalScore;
  })();

  pendingFetches.set(author, fetchPromise);
  return fetchPromise;
}

/**
 * Dispara atualização em lote para uma lista de autores visíveis
 * Utiliza o método de lote RPC ultra-rápido (1 chamada para todos os autores)
 * @param {string[]} authors
 */
export async function queueReputationFetch(authors) {
  if (!Array.isArray(authors) || authors.length === 0) return;
  await fetchReputationsRpcBatch(authors, false);
}

/**
 * Atualização manual forçada disparada pelo clique do usuário
 * @param {string} rawAuthor
 * @param {HTMLElement} [btnElement]
 */
export async function handleManualReputationRefresh(rawAuthor, btnElement) {
  const author = String(rawAuthor || '').trim().toLowerCase().replace(/^@/, '');
  if (!author) return;

  if (btnElement) {
    btnElement.classList.add('spinning');
  }

  try {
    const newScore = await fetchAuthorReputation(author, true);
    showNotification(`Reputação de @${author} atualizada: ${newScore}`, 'success');
  } catch (err) {
    showNotification(`Erro ao atualizar reputação de @${author}`, 'error');
  } finally {
    if (btnElement) {
      setTimeout(() => {
        btnElement.classList.remove('spinning');
      }, 500);
    }
  }
}

/**
 * Atualiza todos os badges DOM na tela para um autor específico
 * @param {string} author
 * @param {number} score
 */
export function updateAuthorReputationBadges(author, score) {
  const elements = document.querySelectorAll(`[data-author-rep="${author.toLowerCase()}"]`);
  elements.forEach((badge) => {
    badge.textContent = `(${score})`;
    badge.className = `author-reputation-badge ${getReputationClass(score)}`;
    badge.title = `Reputação Hive: ${score} (Clique no ícone para atualizar)`;
  });
}

/**
 * Retorna a classe CSS de cor para o nível de reputação
 */
export function getReputationClass(score) {
  if (score >= 70) return 'rep-high';
  if (score >= 50) return 'rep-normal';
  if (score >= 25) return 'rep-low';
  return 'rep-warning'; // Abaixo de 25: alerta para moderadores!
}

/**
 * Gera o fragmento HTML do badge de reputação e botão de atualização manual
 * @param {string} rawAuthor
 * @param {number} [fallbackScore] - Reputação opcional já presente no post
 * @returns {string}
 */
export function renderAuthorReputationHtml(rawAuthor, fallbackScore = null) {
  const author = String(rawAuthor || '').trim().toLowerCase().replace(/^@/, '');
  let cached = getCachedReputation(author);

  if (cached === null && typeof fallbackScore === 'number' && !isNaN(fallbackScore)) {
    cached = Math.round(fallbackScore);
    reputationMemoryCache.set(author, cached);
  }

  const displayVal = cached !== null ? `(${cached})` : `(...)`;
  const repClass = cached !== null ? getReputationClass(cached) : 'rep-loading';
  const title = cached !== null ? `Reputação Hive: ${cached}` : 'Carregando reputação...';

  return `
    <span class="author-rep-container" data-author="${author}">
      <span class="author-reputation-badge ${repClass}" data-author-rep="${author}" title="${title}">
        ${displayVal}
      </span>
      <button type="button" class="btn-refresh-rep" data-author-action="${author}" title="Atualizar reputação de @${author} via API">
        <i class="fas fa-sync-alt"></i>
      </button>
    </span>
  `;
}
