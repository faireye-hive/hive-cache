// src/app.js

import { loadChartJS, updatePostsDisplay, updateSystemStatus, refreshPostsDisplay, selectAppFilter, updateAppFilterDropdown, updateDomainFilterDropdown, selectDomainFilter, initRecentPostsControls } from './ui/domHelpers.js';
import { loadSettings, applySettings, saveSettings } from './core/settings.js';
import { initLoginSystem } from './core/auth.js';
import { initNavigation } from './core/navigation.js';
import { initModalListeners, openMutedUsersManager, closeModal } from './ui/modals.js';
import { initOnchainBlacklistModal, openOnchainBlacklistModal } from './ui/onchainBlacklistModal.js';
import { initDownvoteModal, openDownvoteModal } from './ui/downvoteModal.js';
import { loadInitialData, loadPosts, showCacheStats, clearCache, syncBlockchainFromNetwork } from './api/dataLoader.js';
import { loadReputationsBackupFile } from './api/reputationService.js';
import { searchPosts, applyFilter, performAdvancedSearch } from './moderation/filtering.js';
import { initAccountInvestigation } from './ui/accountInvestigation.js';
import { initBlacklistRanking } from './moderation/blacklistRanking.js';
import { moderationSettings, setPostsPerPage, setCurrentPage,
          getPostTypeFilter, setPostTypeFilter, getSortCriteria, setSortCriteria, getAppFilter, setAppFilter, getDomainFilter, setDomainFilter, getBlacklistFilter, setBlacklistFilter, getMaxReputationFilter, setMaxReputationFilter } from './config.js';
import { debounce } from './utils/helpers.js';
import { showNotification } from './ui/notifications.js';
import { updateHeaderBlacklistBadge } from './ui/onchainBlacklistModal.js';
import { syncOnchainBlacklist, getOnchainBlacklistedCount } from './api/onchainBlacklistService.js';
import { initHybridSyncModal, openHybridSyncModal } from './ui/hybridSyncModal.js';
import { syncBlockchainRpcFromNetwork } from './api/dataLoader.js';



// Configuração Global no Window/Global Scope (para compatibilidade com funções inline)
// O ideal é evitar isso, mas mantemos para funções que não foram alteradas
window.loadPosts = loadPosts;
window.showCacheStats = showCacheStats;
window.clearCache = clearCache;
window.openMutedUsersManager = openMutedUsersManager;
window.closeModal = closeModal;
window.syncBlockchainFromNetwork = syncBlockchainFromNetwork;
window.syncBlockchainRpcFromNetwork = syncBlockchainRpcFromNetwork;
window.selectAppFilter = selectAppFilter;
window.openOnchainBlacklistModal = openOnchainBlacklistModal;
window.openDownvoteModal = openDownvoteModal;
window.openHybridSyncModal = openHybridSyncModal;

// Funções de Ação/Eventos
function initEventListeners() {
  const syncBtn = document.getElementById("syncBlockchainBtn");
  if (syncBtn) {
    syncBtn.addEventListener("click", () => syncBlockchainFromNetwork());
  }
  document.getElementById("refreshBtn").addEventListener("click", loadPosts);
  document
    .getElementById("cacheStatsBtn")
    .addEventListener("click", showCacheStats);
  document
    .getElementById("clearCacheBtn")
    .addEventListener("click", clearCache);

  document
    .getElementById("mutedUsersBtn")
    .addEventListener("click", openMutedUsersManager);

  document.getElementById("postsPerPage").addEventListener("change", (e) => {
    const newPerPage = parseInt(e.target.value);
    setPostsPerPage(newPerPage);
    moderationSettings.postsPerPage = newPerPage;
    saveSettings(); // Chama saveSettings que aplica a configuração
    setCurrentPage(1);
    updatePostsDisplay();
  });

  // Busca
  document
    .getElementById("searchInput")
    .addEventListener("input", debounce(searchPosts, 300)); // debounce deve ser importado
  document.getElementById("searchFilter").addEventListener("change", searchPosts);

  // Filtros rápidos
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      document
        .querySelectorAll(".filter-btn")
        .forEach((b) => b.classList.remove("active"));
      this.classList.add("active");
      applyFilter(this.getAttribute("data-filter"));
    });
  });

  // Busca avançada
  document
    .getElementById("performAdvancedSearch")
    .addEventListener("click", performAdvancedSearch);
}


// Inicialização Principal
document.addEventListener("DOMContentLoaded", async function () {
  await loadChartJS();

  loadSettings();
  applySettings();
  initPostTypeFilter()
  initLoginSystem();
  initNavigation();
  initEventListeners();
  initModalListeners(); // Agora no módulo ui/modals.js
  initOnchainBlacklistModal();
  initDownvoteModal();
  initHybridSyncModal();
  initRecentPostsControls();
  initBlacklistRanking();
  initAccountInvestigation();
  await loadReputationsBackupFile();
  await loadInitialData();
  updateSystemStatus();
  updateHeaderBlacklistBadge();

  // Sincronização em segundo plano da Blacklist On-Chain via bridge.get_follow_list
  syncOnchainBlacklist()
    .then((accounts) => {
      updateHeaderBlacklistBadge();
      refreshPostsDisplay();
    })
    .catch((err) => {
      console.warn('On-chain blacklist background sync is pending:', err.message);
    });

  setInterval(updateSystemStatus, 30000);
});


function initPostTypeFilter() {

  // NOVO: Ordenação
  const sortSelect = document.getElementById("sortCriteria");
  if (sortSelect) {
      // Garante o estado inicial
      sortSelect.value = getSortCriteria(); 
      
      sortSelect.addEventListener("change", (e) => {
          setSortCriteria(e.target.value);
          setCurrentPage(1); // Volta para a primeira página
          refreshPostsDisplay(); // Recarrega com a nova ordenação
      });
  }
    const filterSelect = document.getElementById("postTypeFilter");
    if (filterSelect) {
        filterSelect.addEventListener('change', (e) => {
            const newFilter = e.target.value;
            // 1. Define o novo estado
            setPostTypeFilter(newFilter); 
            // 2. Volta para a primeira página ao mudar o filtro
            setCurrentPage(1); 
            // 3. Recarrega a exibição
            refreshPostsDisplay(); 
        });
        
        // Garante que o dropdown reflita o estado atual
        filterSelect.value = getPostTypeFilter();
    }

    // NOVO: Filtro por Aplicativo (App)
    const appSelect = document.getElementById("appFilter");
    if (appSelect) {
        appSelect.addEventListener('change', (e) => {
            const newApp = e.target.value;
            setAppFilter(newApp);
            setCurrentPage(1);
            refreshPostsDisplay();
            if (newApp !== "all") {
                showNotification(`Filtering posts by app: ${newApp}`, "info");
            } else {
                showNotification("Showing posts from all apps", "info");
            }
        });

        appSelect.value = getAppFilter();
    }

    // NOVO: Filtro de Links e Grouped Domains
    const domainSelect = document.getElementById("domainFilter");
    if (domainSelect) {
        domainSelect.value = getDomainFilter();
        domainSelect.addEventListener('change', (e) => {
            selectDomainFilter(e.target.value);
        });
    }

    // NOVO: Filtro de Blacklist On-Chain
    const blacklistSelect = document.getElementById("blacklistFilter");
    if (blacklistSelect) {
        blacklistSelect.value = getBlacklistFilter();
        blacklistSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            setBlacklistFilter(val);
            setCurrentPage(1);
            refreshPostsDisplay();
            if (val === 'hide-blacklisted') {
                showNotification("Posts from on-chain blacklisted accounts are hidden", "info");
            } else if (val === 'only-blacklisted') {
                showNotification("Showing only authors on the on-chain blacklist", "warning");
            } else {
                showNotification("Showing all posts (including blacklisted accounts)", "info");
            }
        });
    }

    // NOVO: Filtro de Reputação Máxima (Ocultar quem tiver reputação maior que o valor)
    const reputationSelect = document.getElementById("reputationFilter");
    if (reputationSelect) {
        const currentMaxRep = getMaxReputationFilter();
        if (currentMaxRep !== null) {
            // Verifica se existe opção com esse valor
            const existingOption = reputationSelect.querySelector(`option[value="${currentMaxRep}"]`);
            if (existingOption) {
                reputationSelect.value = String(currentMaxRep);
            } else {
                // Adiciona a opção personalizada dinamicamente
                const opt = document.createElement("option");
                opt.value = String(currentMaxRep);
                opt.textContent = `Custom (≤ ${currentMaxRep})`;
                reputationSelect.appendChild(opt);
                reputationSelect.value = String(currentMaxRep);
            }
        } else {
            reputationSelect.value = "all";
        }

        reputationSelect.addEventListener("change", (e) => {
            const val = e.target.value;
            if (val === "custom") {
                const promptVal = prompt(
                    "Set the MAXIMUM allowed reputation (e.g. 25 to focus on new or suspicious accounts):\nAuthors with a reputation HIGHER than this value will be hidden.",
                    "25"
                );
                if (promptVal !== null && promptVal.trim() !== "") {
                    const parsed = parseInt(promptVal.trim(), 10);
                    if (!isNaN(parsed)) {
                        setMaxReputationFilter(parsed);
                        // Atualiza dropdown com a opção personalizada
                        let opt = reputationSelect.querySelector(`option[value="${parsed}"]`);
                        if (!opt) {
                            opt = document.createElement("option");
                            opt.value = String(parsed);
                            opt.textContent = `Custom (≤ ${parsed})`;
                            reputationSelect.appendChild(opt);
                        }
                        reputationSelect.value = String(parsed);
                        setCurrentPage(1);
                        refreshPostsDisplay();
                        showNotification(`Filter enabled: hiding authors with reputation > ${parsed} (≤ ${parsed})`, "warning");
                        return;
                    } else {
                        showNotification("Invalid reputation value", "error");
                        reputationSelect.value = currentMaxRep !== null ? String(currentMaxRep) : "all";
                        return;
                    }
                } else {
                    reputationSelect.value = currentMaxRep !== null ? String(currentMaxRep) : "all";
                    return;
                }
            }

            if (val === "all") {
                setMaxReputationFilter(null);
                setCurrentPage(1);
                refreshPostsDisplay();
                showNotification("Reputation filter disabled (all reputations shown)", "info");
            } else {
                const num = parseInt(val, 10);
                setMaxReputationFilter(num);
                setCurrentPage(1);
                refreshPostsDisplay();
                showNotification(`Hiding authors with reputation > ${num} (showing only ≤ ${num})`, "warning");
            }
        });
    }

    // Botão de acesso rápido à Blacklist On-chain no cabeçalho
    const btnHeaderSync = document.getElementById("btnHeaderBlacklistSync");
    if (btnHeaderSync) {
        btnHeaderSync.addEventListener("click", () => {
            openOnchainBlacklistModal();
        });
    }
}
