import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

export const DB_CONFIG = {
  host: process.env.PGHOST || 'hafsql-sql.mahdiyari.info',
  port: parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.PGDATABASE || 'haf_block_log',
  user: process.env.PGUSER || 'hafsql_public',
  password: process.env.PGPASSWORD || 'hafsql_public',
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 5,
};

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool(DB_CONFIG);
    pool.on('error', (err) => {
      console.error('[HAFSQL] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

export let syncStatus = {
  isSyncing: false,
  lastSyncTime: null,
  lastPostCount: 0,
  lastError: null,
  lastDurationMs: 0,
};

/**
 * Sync real blockchain posts/comments from Hive HAFSQL database to data.json
 * @param {number} hours - Number of hours to look back (default: 24)
 * @param {number} limit - Optional limit of records (default: null for all in range)
 */
export async function syncHiveBlockchainData({ hours = 24, limit = null } = {}) {
  if (syncStatus.isSyncing) {
    throw new Error('A sincronização já está em andamento. Aguarde.');
  }

  syncStatus.isSyncing = true;
  syncStatus.lastError = null;
  const startTime = Date.now();

  const client = await getPool().connect();
  try {
    console.log(`[HAFSQL] Starting sync from Hive blockchain for last ${hours} hours...`);
    
    const limitClause = limit ? `LIMIT ${parseInt(limit, 10)}` : '';
    
    const query = `
      SELECT id, title, body, author, permlink, parent_author, parent_permlink, created,
             last_edited, cashout_time, remaining_till_cashout, tags, category,
             json_metadata, root_author, root_permlink, pending_payout_value, author_rewards,
             total_payout_value, curator_payout_value, beneficiary_payout_value,
             total_rshares, net_rshares, total_vote_weight, beneficiaries, max_accepted_payout,
             percent_hbd, allow_votes, allow_curation_rewards, deleted
      FROM hafsql.comments
      WHERE created >= NOW() - INTERVAL '${parseInt(hours, 10)} hours'
        AND author NOT IN ('ai-summaries', 'kgakakillerg', 'taskmaster4450le', 'ben.haase', 'conscript', 'hivebuzz', 'actifit', 'pizzabot', 'ladytoken', 'redditposh')
      ORDER BY created DESC
      ${limitClause}
    `;

    const result = await client.query(query);
    const rowCount = result.rows.length;
    console.log(`[HAFSQL] Fetched ${rowCount} rows from Hive blockchain. Generating NDJSON...`);

    const dataPath = path.join(__dirname, 'data.json');
    const tempPath = path.join(__dirname, 'data.json.tmp');

    // Write file in NDJSON streaming fashion
    const writeStream = fs.createWriteStream(tempPath, { encoding: 'utf8' });
    for (let i = 0; i < rowCount; i++) {
      const row = result.rows[i];
      // Format remaining_till_cashout if it is an object from postgres interval
      if (row.remaining_till_cashout && typeof row.remaining_till_cashout === 'object') {
        const d = row.remaining_till_cashout.days || 0;
        const h = row.remaining_till_cashout.hours || 0;
        row.remaining_till_cashout = `${d} days ${h} hours`;
      }
      // Ensure pending_payout_value format has currency if missing
      if (typeof row.pending_payout_value === 'number') {
        row.pending_payout_value = `${row.pending_payout_value.toFixed(3)} HBD`;
      }
      writeStream.write(JSON.stringify(row) + '\n');
    }

    await new Promise((resolve, reject) => {
      writeStream.end(resolve);
      writeStream.on('error', reject);
    });

    // Atomic replace
    fs.renameSync(tempPath, dataPath);

    const duration = Date.now() - startTime;
    syncStatus.lastSyncTime = new Date().toISOString();
    syncStatus.lastPostCount = rowCount;
    syncStatus.lastDurationMs = duration;
    console.log(`[HAFSQL] Successfully synced ${rowCount} posts in ${duration}ms!`);

    return {
      success: true,
      count: rowCount,
      durationMs: duration,
      timestamp: syncStatus.lastSyncTime,
      source: 'hafsql'
    };
  } catch (error) {
    console.error('[HAFSQL] Error during blockchain sync:', error);
    syncStatus.lastError = error.message;
    throw error;
  } finally {
    client.release();
    syncStatus.isSyncing = false;
  }
}

const HIVE_RPC_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://api.deathwing.me',
  'https://rpc.mahdiyari.info',
];

/**
 * Sincroniza os posts mais recentes diretamente dos nós RPC da Hive Blockchain (SEM HAFSQL).
 * Sistema híbrido: atualiza e mescla no cache local (data.json).
 * IMPORTANTE: Os nós RPC da Hive impõem limite estrito de [1:20] posts por requisição.
 * Para buscar quantidades maiores (ex: 40 ou 60), faz paginação em lotes de 20.
 * @param {number} limit - Quantidade total de posts desejada (padrão: 20)
 */
export async function syncHiveRpcData({ limit = 20 } = {}) {
  if (syncStatus.isSyncing) {
    throw new Error('Uma sincronização já está em andamento. Aguarde.');
  }

  syncStatus.isSyncing = true;
  syncStatus.lastError = null;
  const startTime = Date.now();

  try {
    const totalWanted = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 60);
    console.log(`[HIVE-RPC] Sincronizando até ${totalWanted} posts via RPC direto (lotes seguros de máx 20 por requisição)...`);

    let rawPosts = [];
    let usedNode = '';

    for (const node of HIVE_RPC_NODES) {
      try {
        const collected = [];
        let startAuthor = undefined;
        let startPermlink = undefined;
        let consecutiveEmpty = 0;

        while (collected.length < totalWanted && consecutiveEmpty < 2) {
          const batchSize = Math.min(20, (totalWanted - collected.length) + (startAuthor ? 1 : 0));
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);

          const params = {
            sort: 'created',
            limit: batchSize,
            observer: 'hive.blog',
          };
          if (startAuthor && startPermlink) {
            params.start_author = startAuthor;
            params.start_permlink = startPermlink;
          }

          const response = await fetch(node, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'bridge.get_ranked_posts',
              params: params,
              id: 1,
            }),
          });
          clearTimeout(timeoutId);

          if (!response.ok) break;

          const json = await response.json();
          if (json?.error) {
            console.warn(`[HIVE-RPC] Nó ${node} retornou erro:`, json.error.message);
            break;
          }

          if (Array.isArray(json?.result) && json.result.length > 0) {
            const sliceIdx = (startAuthor && startPermlink) ? 1 : 0;
            const newItems = json.result.slice(sliceIdx);
            if (newItems.length === 0) {
              consecutiveEmpty++;
              break;
            }
            collected.push(...newItems);
            const lastItem = json.result[json.result.length - 1];
            startAuthor = lastItem.author;
            startPermlink = lastItem.permlink;
          } else {
            consecutiveEmpty++;
            break;
          }
        }

        if (collected.length > 0) {
          rawPosts = collected;
          usedNode = node;
          break;
        }
      } catch (err) {
        console.warn(`[HIVE-RPC] Falha ao consultar nó ${node}:`, err.message);
      }
    }

    // Se bridge falhar em todos, tenta condenser_api.get_discussions_by_created (com limite <= 20)
    if (rawPosts.length === 0) {
      for (const node of HIVE_RPC_NODES) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);

          const response = await fetch(node, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'condenser_api.get_discussions_by_created',
              params: [{ limit: Math.min(20, totalWanted), tag: '' }],
              id: 2,
            }),
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const json = await response.json();
            if (Array.isArray(json?.result) && json.result.length > 0) {
              rawPosts = json.result;
              usedNode = node;
              break;
            }
          }
        } catch (err) {
          // próximo nó
        }
      }
    }

    if (rawPosts.length === 0) {
      throw new Error('Não foi possível obter dados dos nós RPC da Hive.');
    }

    // Normaliza posts para o formato esperado pelo dashboard
    const normalizedNewPosts = rawPosts.map((p) => {
      let meta = {};
      try {
        meta = typeof p.json_metadata === 'string' ? JSON.parse(p.json_metadata) : (p.json_metadata || {});
      } catch (e) {
        meta = {};
      }

      const pendingVal = p.pending_payout_value ?? (typeof p.payout === 'number' ? `${p.payout.toFixed(3)} HBD` : '0.000 HBD');

      let parsedRep = null;
      if (typeof p.author_reputation === 'number' && !isNaN(p.author_reputation)) {
        parsedRep = Math.round(p.author_reputation);
      } else if (p.author_reputation) {
        const floatRep = parseFloat(p.author_reputation);
        if (!isNaN(floatRep)) parsedRep = Math.round(floatRep);
      }

      return {
        id: p.post_id || p.id || Math.floor(Math.random() * 100000000),
        title: p.title || '',
        body: p.body || '',
        author: p.author,
        author_reputation: parsedRep,
        permlink: p.permlink,
        parent_author: p.parent_author || '',
        parent_permlink: p.parent_permlink || '',
        created: p.created,
        last_edited: p.updated || p.last_edited || p.created,
        cashout_time: p.cashout_time || '',
        remaining_till_cashout: '7 days',
        tags: Array.isArray(meta.tags) ? meta.tags : (p.category ? [p.category] : []),
        category: p.category || (Array.isArray(meta.tags) ? meta.tags[0] : ''),
        json_metadata: typeof p.json_metadata === 'object' ? JSON.stringify(p.json_metadata) : (p.json_metadata || '{}'),
        root_author: p.root_author || p.author,
        root_permlink: p.root_permlink || p.permlink,
        pending_payout_value: pendingVal,
        author_rewards: p.author_rewards || '0.000 HBD',
        total_payout_value: p.total_payout_value || '0.000 HBD',
        curator_payout_value: p.curator_payout_value || '0.000 HBD',
        beneficiary_payout_value: '0.000 HBD',
        total_rshares: p.net_rshares || 0,
        net_rshares: p.net_rshares || 0,
        total_vote_weight: 0,
        beneficiaries: p.beneficiaries || [],
        max_accepted_payout: p.max_accepted_payout || '1000000.000 HBD',
        percent_hbd: p.percent_hbd ?? 10000,
        allow_votes: p.allow_votes ?? true,
        allow_curation_rewards: p.allow_curation_rewards ?? true,
        deleted: false,
      };
    });

    const dataPath = path.join(__dirname, 'data.json');
    const tempPath = path.join(__dirname, 'data.json.tmp');

    // Lê posts existentes para mesclar (sem duplicatas)
    let existingMap = new Map();
    if (fs.existsSync(dataPath)) {
      try {
        const fileContent = fs.readFileSync(dataPath, 'utf8');
        const lines = fileContent.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            const item = JSON.parse(line);
            if (item.author && item.permlink) {
              const key = `${item.author}/${item.permlink}`;
              existingMap.set(key, item);
            }
          }
        }
      } catch (e) {
        console.warn('[HIVE-RPC] Aviso ao ler data.json existente:', e.message);
      }
    }

    // Novos posts têm precedência
    for (const p of normalizedNewPosts) {
      const key = `${p.author}/${p.permlink}`;
      existingMap.set(key, p);
    }

    // Ordena do mais recente para o mais antigo
    const allMerged = Array.from(existingMap.values()).sort((a, b) => {
      const dateA = new Date(a.created || 0).getTime();
      const dateB = new Date(b.created || 0).getTime();
      return dateB - dateA;
    });

    // Escreve de volta no formato NDJSON
    const writeStream = fs.createWriteStream(tempPath, { encoding: 'utf8' });
    for (const item of allMerged) {
      writeStream.write(JSON.stringify(item) + '\n');
    }

    await new Promise((resolve, reject) => {
      writeStream.end(resolve);
      writeStream.on('error', reject);
    });

    fs.renameSync(tempPath, dataPath);

    const duration = Date.now() - startTime;
    syncStatus.lastSyncTime = new Date().toISOString();
    syncStatus.lastPostCount = allMerged.length;
    syncStatus.lastDurationMs = duration;

    console.log(`[HIVE-RPC] Sincronização RPC direta concluída via ${usedNode}: ${normalizedNewPosts.length} novos, ${allMerged.length} total.`);

    return {
      success: true,
      newPostsCount: normalizedNewPosts.length,
      totalCount: allMerged.length,
      durationMs: duration,
      timestamp: syncStatus.lastSyncTime,
      source: 'rpc_direct',
      node: usedNode,
    };
  } catch (error) {
    console.error('[HIVE-RPC] Erro na sincronização via RPC:', error);
    syncStatus.lastError = error.message;
    throw error;
  } finally {
    syncStatus.isSyncing = false;
  }
}

const REPUTATIONS_FILE = path.join(__dirname, 'reputations.json');
const REPUTATIONS_TEMP = path.join(__dirname, 'reputations.json.tmp');

/**
 * Lê o arquivo de backup reputations.json
 */
export function loadReputationsBackup() {
  try {
    if (fs.existsSync(REPUTATIONS_FILE)) {
      const raw = fs.readFileSync(REPUTATIONS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        if (data.reputations && typeof data.reputations === 'object') {
          return data;
        }
        return {
          version: 1,
          lastUpdated: new Date().toISOString(),
          count: Object.keys(data).length,
          reputations: data,
        };
      }
    }
  } catch (err) {
    console.warn('[REPUTATION-BACKUP] Erro ao carregar reputations.json:', err.message);
  }
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    count: 0,
    reputations: {},
  };
}

/**
 * Salva e mescla pontuações de reputação no arquivo de backup reputations.json
 * @param {Record<string, number>} newScores
 */
export function saveReputationsBackup(newScores) {
  if (!newScores || typeof newScores !== 'object') return null;

  const current = loadReputationsBackup();
  const reps = { ...current.reputations };
  let modified = false;

  for (const [author, score] of Object.entries(newScores)) {
    if (!author) continue;
    const cleanAuthor = String(author).trim().toLowerCase().replace(/^@/, '');
    const numScore = parseInt(score, 10);
    if (!isNaN(numScore)) {
      if (reps[cleanAuthor] !== numScore) {
        reps[cleanAuthor] = numScore;
        modified = true;
      }
    }
  }

  if (modified || !fs.existsSync(REPUTATIONS_FILE)) {
    const output = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      count: Object.keys(reps).length,
      reputations: reps,
    };
    fs.writeFileSync(REPUTATIONS_TEMP, JSON.stringify(output, null, 2), 'utf8');
    fs.renameSync(REPUTATIONS_TEMP, REPUTATIONS_FILE);
    return output;
  }

  return current;
}

/**
 * Sincroniza reputações ausentes dos autores do data.json diretamente na blockchain
 * e persiste no arquivo reputations.json
 * @param {number} limit - Máximo de autores a sincronizar nesta rodada (padrão 100)
 */
export async function syncMissingReputations({ limit = 100 } = {}) {
  const currentBackup = loadReputationsBackup();
  const knownReps = currentBackup.reputations || {};

  // Lê autores únicos de data.json
  const dataPath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(dataPath)) {
    return { success: false, error: 'data.json não encontrado' };
  }

  const readline = (await import('readline')).default;
  const rl = readline.createInterface({
    input: fs.createReadStream(dataPath),
    crlfDelay: Infinity,
  });

  const authorCounts = new Map();
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const p = JSON.parse(line);
      if (p.author) {
        const a = p.author.toLowerCase().trim().replace(/^@/, '');
        authorCounts.set(a, (authorCounts.get(a) || 0) + 1);
      }
    } catch (e) {}
  }

  // Ordena autores pelos que mais postam primeiro
  const sortedMissing = [...authorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((entry) => entry[0])
    .filter((author) => knownReps[author] === undefined);

  const toFetch = sortedMissing.slice(0, Math.min(limit, 200));
  if (toFetch.length === 0) {
    return {
      success: true,
      message: 'Todos os autores já estão com reputação em cache no backup!',
      totalCached: Object.keys(knownReps).length,
      newlyFetched: 0,
    };
  }

  const newlyFetched = {};
  const node = HIVE_RPC_NODES[0] || 'https://api.hive.blog';

  for (let i = 0; i < toFetch.length; i += 20) {
    const chunk = toFetch.slice(i, i + 20);
    const body = chunk.map((author, idx) => ({
      jsonrpc: '2.0',
      method: 'bridge.get_profile',
      params: { account: author },
      id: idx + 1,
    }));

    try {
      const res = await fetch(node, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (Array.isArray(json)) {
        json.forEach((item) => {
          if (item?.result?.name && item.result.reputation !== undefined) {
            const authorName = item.result.name.toLowerCase();
            const rep = Math.round(item.result.reputation);
            newlyFetched[authorName] = rep;
          }
        });
      }
    } catch (err) {
      console.warn('[REPUTATION-BACKUP] Erro no lote de reputações:', err.message);
    }
  }

  const updatedBackup = saveReputationsBackup(newlyFetched);

  return {
    success: true,
    newlyFetched: Object.keys(newlyFetched).length,
    totalCached: updatedBackup.count,
    remainingMissing: sortedMissing.length - Object.keys(newlyFetched).length,
  };
}

