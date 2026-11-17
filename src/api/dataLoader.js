// src/api/dataLoader.js

import { setAllPosts, allPosts } from '../config.js';
export { allPosts };
import { updatePostsDisplay, updateFlaggedCount, updateAppFilterDropdown, updateDomainFilterDropdown } from '../ui/domHelpers.js';
import { showNotification } from '../ui/notifications.js';
import { loadRankingByPosts, loadRankingByPayout, precalculateAuthorStats, updateCachedStatistics } from '../utils/statsCalculators.js';
import { updateSystemStatus } from '../ui/domHelpers.js';
import { seedReputationCacheFromPosts } from './reputationService.js';
import { refreshBlacklistRanking } from '../moderation/blacklistRanking.js';


const BLACKLIST_FILE_PATH = './blacklist.json';

export let AUTHOR_BLACKLIST = new Set();

export async function loadInitialData() {
  await loadPosts();
  await loadBlacklist();
  loadRankingByPosts();
  loadRankingByPayout();
  updateFlaggedCount();
}

async function readCachedPosts(response) {
  const posts = [];
  let pending = "";
  let lineNumber = 0;

  function append(line) {
    lineNumber++;
    if (!line.trim()) return;
    try {
      posts.push(JSON.parse(line));
    } catch {
      try {
        // Older cache files may contain invalid backslash escapes.
        posts.push(JSON.parse(line.replace(/\\([^"\\\/bfnrtu])/g, "$1")));
      } catch {
        console.warn(`Skipped invalid cache entry on line ${lineNumber}`);
      }
    }
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const lines = (pending + value).split("\n");
      pending = lines.pop();
      lines.forEach(append);
    }
    if (pending) append(pending);
    return posts.filter(post => post && typeof post.author === "string");
  } finally {
    reader.releaseLock();
  }
}

export async function loadPosts() {
  const loadingElement = document.getElementById("loadingPosts");
  loadingElement.classList.remove("hidden");

  try {
    const response = await fetch("./data.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await readCachedPosts(response);
    console.log(`Loaded ${data.length} cached posts and comments`);

    setAllPosts(data);
    precalculateAuthorStats();
    seedReputationCacheFromPosts(data);
    updateAppFilterDropdown();
    updateDomainFilterDropdown();
    updatePostsDisplay();
    updateSystemStatus();

    document.getElementById("cacheCount").textContent = allPosts.length;
    document.getElementById("lastUpdate").textContent = "Now";
    if (document.getElementById('stats-section')?.classList.contains('active')) {
      updateCachedStatistics();
    }
    refreshBlacklistRanking();
  } catch (error) {
    // ... lógica de erro ...
    console.error("Erro ao carregar posts:", error);
    showNotification(
      "Failed to load posts. Check data.json and your connection.",
      "error"
    );

    const container = document.getElementById("postsContainer");
    container.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Failed to Process Data (NDJSON)</h3>
                <p>Check that data.json exists and uses the NDJSON format (one JSON object per line).</p>
                <button type="button" class="btn-primary retry-load-btn">
                    <i class="fas fa-sync-alt"></i> Tentar novamente
                </button>
            </div>
        `;
    container.querySelector(".retry-load-btn")?.addEventListener("click", () => window.location.reload());
  } finally {
    loadingElement.classList.add("hidden");
  }
}

// Funções showCacheStats e clearCache
export async function showCacheStats() {
  try {
    const res = await fetch('/api/blockchain-status');
    const data = await res.json();
    const count = allPosts.length;
    const sizeMB = data.file?.sizeMB || '0';
    const lastSync = data.sync?.lastSyncTime ? new Date(data.sync.lastSyncTime).toLocaleTimeString('en-US') : 'N/A';
    showNotification(
      `Hive cache: ${count} posts (${sizeMB} MB). Last HAFSQL sync: ${lastSync}`,
      "info"
    );
  } catch (e) {
    showNotification(`Posts in memory: ${allPosts.length}`, "info");
  }
}

export async function syncBlockchainFromNetwork(hours = 168) {
  const syncBtn = document.getElementById("syncBlockchainBtn");
  const originalText = syncBtn ? syncBtn.innerHTML : "";
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
  }

  showNotification(`Downloading posts and comments from HAFSQL for the last ${hours === 168 ? '7 days' : hours + ' hours'}…`, "info");

  try {
    const response = await fetch(`/api/sync-blockchain?hours=${hours}`, {
      method: 'POST'
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    showNotification(
      `Success! Downloaded ${result.count.toLocaleString('en-US')} Hive blockchain posts in ${(result.durationMs / 1000).toFixed(1)}s.`,
      "success"
    );

    // Recarrega os posts na memória da aplicação e atualiza visualização
    await loadPosts();
    loadRankingByPosts();
    loadRankingByPayout();
    updateFlaggedCount();
  } catch (error) {
    console.error("Blockchain sync error:", error);
    showNotification(
      `Sync failed: ${error.message}`,
      "error"
    );
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = originalText || '<i class="fas fa-cloud-download-alt"></i> Sync Blockchain';
    }
  }
}

/**
 * Sincroniza novos posts da blockchain Hive via RPC nativo (SEM HAFSQL).
 * Atualiza e mescla no cache local NDJSON.
 */
export async function syncBlockchainRpcFromNetwork(limit = 20) {
  showNotification(`Downloading recent posts directly via Hive RPC (without HAFSQL)...`, "info");

  try {
    const response = await fetch(`/api/sync-rpc?limit=${limit}`, {
      method: 'POST'
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    showNotification(
      `RPC sync complete! Downloaded ${result.newPostsCount} recent posts via ${result.node || 'Hive'}. Total cached: ${result.totalCount}.`,
      "success"
    );

    // Recarrega os posts na memória e atualiza visualizações
    await loadPosts();
    loadRankingByPosts();
    loadRankingByPayout();
    updateFlaggedCount();
    return result;
  } catch (error) {
    console.error("Hive RPC sync error:", error);
    showNotification(
      `RPC sync failed: ${error.message}`,
      "error"
    );
    throw error;
  }
}

export async function clearCache() {
  return new Promise((resolve) => {
    const keys = ["flaggedPosts", "mutedUsers", "moderationSettings"];

    keys.forEach((k) => localStorage.removeItem(k));

    // Recarrega as configurações para limpar os objetos exportados
    // Idealmente você teria uma função `resetSettings`
    window.location.reload(); // Recarregar é a forma mais fácil de redefinir o estado global neste caso

    resolve(true);
  });
}




export async function loadBlacklist() {
    try {
        // 1. Fazer a requisição HTTP GET para o arquivo JSON
        const response = await fetch(BLACKLIST_FILE_PATH);

        // Verifica se a requisição foi bem-sucedida (código 200)
        if (!response.ok) {
            throw new Error(`Network error or file not found. Status: ${response.status}`);
        }

        // 2. Converte a resposta para um Array JavaScript
        const authorsArray = await response.json();

        // 3. Cria o Set para buscas O(1)
        const tempBlacklist = new Set(authorsArray);

        // 4. ATUALIZAÇÃO SÍNCRONA
        AUTHOR_BLACKLIST = tempBlacklist;
        
        // Retorna o Set para confirmação, se necessário
        return AUTHOR_BLACKLIST;

    } catch (error) {
        console.error(`[RISK CORE] ❌ ERRO ao carregar a lista negra no frontend: ${error.message}`);
        // Em caso de falha, AUTHOR_BLACKLIST permanece um Set vazio, evitando quebrar a aplicação.
        return new Set();
    }
}
