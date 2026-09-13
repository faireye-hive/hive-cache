// src/api/dataLoader.js

import { setAllPosts, setFilteredPosts, allPosts } from '../config.js';
export { allPosts };
import { updatePostsDisplay, updateFlaggedCount, updateAppFilterDropdown, updateDomainFilterDropdown } from '../ui/domHelpers.js';
import { showNotification } from '../ui/notifications.js';
import { loadRankingByPosts, loadRankingByPayout, precalculateAuthorStats } from '../utils/statsCalculators.js';
import { updateSystemStatus } from '../ui/domHelpers.js';
import { seedReputationCacheFromPosts } from './reputationService.js';


const BLACKLIST_FILE_PATH = './blacklist.json';

export let AUTHOR_BLACKLIST = new Set();

export async function loadInitialData() {
  await loadPosts();
  await loadBlacklist();
  precalculateAuthorStats();
  loadRankingByPosts();
  loadRankingByPayout();
  updateFlaggedCount();
}

// Mova a função loadPosts para cá
export async function loadPosts() {
  const loadingElement = document.getElementById("loadingPosts");
  loadingElement.classList.remove("hidden");

  try {
    const response = await fetch("./data.json");
    // ... restante da lógica de loadPosts, movendo todas as reatribuições de
    // allPosts e filteredPosts para setAllPosts e setFilteredPosts ...

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const text = await response.text();
    const lines = text.split("\n").filter((line) => line.trim() !== "");

    const data = lines
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (e) {
          // Tentativa de recuperação caso a linha contenha caracteres de escape ilegais em JSON (ex: \( ou \_)
          try {
            const sanitized = line.replace(/\\([^"\\\/bfnrtu])/g, "$1");
            return JSON.parse(sanitized);
          } catch (fallbackError) {
            console.error(`Erro no parsing da linha ${index + 1}:`, line, e);
            return null;
          }
        }
      })
      .filter((item) => item !== null);

    console.log(`Posts carregados via NDJSON: ${data.length}`);

    if (data.length > 0) {
      setAllPosts(data);
      setFilteredPosts([...data]);
      seedReputationCacheFromPosts(data);
      updateAppFilterDropdown();
      updateDomainFilterDropdown();
      updatePostsDisplay();
      updateSystemStatus();

      document.getElementById("cacheCount").textContent = allPosts.length;
      document.getElementById("lastUpdate").textContent = "Agora";
    }
  } catch (error) {
    // ... lógica de erro ...
    console.error("Erro ao carregar posts:", error);
    showNotification(
      "Erro ao carregar posts. Verifique o arquivo 'data.json' e a conexão.",
      "error"
    );

    const container = document.getElementById("postsContainer");
    container.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Falha ao Processar Dados (NDJSON)</h3>
                <p>Verifique se o arquivo data.json existe e se está no formato NDJSON (JSON por linha).</p>
                <button onclick="window.location.reload()" class="btn-primary">
                    <i class="fas fa-sync-alt"></i> Tentar novamente
                </button>
            </div>
        `;
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
    const lastSync = data.sync?.lastSyncTime ? new Date(data.sync.lastSyncTime).toLocaleTimeString('pt-BR') : 'N/A';
    showNotification(
      `Cache Hive: ${count} posts (${sizeMB} MB). Último sync HAFSQL: ${lastSync}`,
      "info"
    );
  } catch (e) {
    showNotification(`Posts em memória: ${allPosts.length}`, "info");
  }
}

export async function syncBlockchainFromNetwork(hours = 24) {
  const syncBtn = document.getElementById("syncBlockchainBtn");
  const originalText = syncBtn ? syncBtn.innerHTML : "";
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sincronizando...';
  }

  showNotification(`Baixando dados reais da blockchain Hive (últimas ${hours}h via HAFSQL)...`, "info");

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
      `Sucesso! ${result.count.toLocaleString('pt-BR')} posts reais baixados da blockchain Hive em ${(result.durationMs / 1000).toFixed(1)}s.`,
      "success"
    );

    // Recarrega os posts na memória da aplicação e atualiza visualização
    await loadPosts();
    precalculateAuthorStats();
    loadRankingByPosts();
    loadRankingByPayout();
    updateFlaggedCount();
  } catch (error) {
    console.error("Erro na sincronização da blockchain:", error);
    showNotification(
      `Falha na sincronização: ${error.message}`,
      "error"
    );
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = originalText || '<i class="fas fa-cloud-download-alt"></i> Sincronizar Blockchain';
    }
  }
}

/**
 * Sincroniza novos posts da blockchain Hive via RPC nativo (SEM HAFSQL).
 * Atualiza e mescla no cache local NDJSON.
 */
export async function syncBlockchainRpcFromNetwork(limit = 20) {
  showNotification(`Baixando posts recentes diretamente via Hive RPC (sem HAFSQL)...`, "info");

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
      `Sincronização RPC concluída! ${result.newPostsCount} posts recentes baixados via nó ${result.node || 'Hive'}. Total em cache: ${result.totalCount}.`,
      "success"
    );

    // Recarrega os posts na memória e atualiza visualizações
    await loadPosts();
    precalculateAuthorStats();
    loadRankingByPosts();
    loadRankingByPayout();
    updateFlaggedCount();
    return result;
  } catch (error) {
    console.error("Erro na sincronização RPC da blockchain:", error);
    showNotification(
      `Falha na sincronização RPC: ${error.message}`,
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
            throw new Error(`Erro de rede ou arquivo não encontrado. Status: ${response.status}`);
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
