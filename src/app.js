// src/app.js

import { loadChartJS, updatePostsDisplay, updateSystemStatus, selectAllPosts, refreshPostsDisplay, selectAppFilter, updateAppFilterDropdown, initViewModeToggle } from './ui/domHelpers.js';
import { loadSettings, applySettings, saveSettings } from './core/settings.js';
import { initLoginSystem } from './core/auth.js';
import { initNavigation } from './core/navigation.js';
import { initModalListeners, openMutedUsersManager, closeModal } from './ui/modals.js';
import { initOnchainBlacklistModal, openOnchainBlacklistModal } from './ui/onchainBlacklistModal.js';
import { initDownvoteModal, openDownvoteModal } from './ui/downvoteModal.js';
import { loadInitialData, loadPosts, showCacheStats, clearCache, syncBlockchainFromNetwork } from './api/dataLoader.js';
import { loadReputationsBackupFile } from './api/reputationService.js';
import { searchPosts, applyFilter, performAdvancedSearch } from './moderation/filtering.js';
import { scanForSpam, scanForPlagiarism } from './moderation/scan.js';
import { moderationSettings, setPostsPerPage, currentPage, setCurrentPage, postsPerPage,
          filteredPosts, getPostTypeFilter, setPostTypeFilter, getSortCriteria, setSortCriteria, getAppFilter, setAppFilter, getBlacklistFilter, setBlacklistFilter, getMaxReputationFilter, setMaxReputationFilter } from './config.js';
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
    syncBtn.addEventListener("click", () => syncBlockchainFromNetwork(24));
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

  // Paginação
  document.getElementById("prevPage").addEventListener("click", () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      updatePostsDisplay();
    }
  });

  document.getElementById("nextPage").addEventListener("click", () => {
    const totalPages = Math.ceil(filteredPosts.length / postsPerPage);
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
      updatePostsDisplay();
    }
  });

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

  // Moderação
  document.getElementById("scanSpamBtn").addEventListener("click", scanForSpam);
  document
    .getElementById("scanPlagiarismBtn")
    .addEventListener("click", scanForPlagiarism);
  document
    .getElementById("selectAll")
    .addEventListener("change", selectAllPosts);

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
  initViewModeToggle();
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
      console.warn('Sincronização em background da blacklist on-chain pendente:', err.message);
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
                showNotification(`Filtrando posts pelo aplicativo: ${newApp}`, "info");
            } else {
                showNotification("Exibindo posts de todos os aplicativos", "info");
            }
        });

        appSelect.value = getAppFilter();
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
                showNotification("Posts de contas na blacklist on-chain estão ocultados", "info");
            } else if (val === 'only-blacklisted') {
                showNotification("Exibindo exclusivamente autores na blacklist on-chain", "warning");
            } else {
                showNotification("Exibindo todos os posts (inclusive da blacklist)", "info");
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
                opt.textContent = `Personalizado (≤ ${currentMaxRep})`;
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
                    "Defina a reputação MÁXIMA permitida (ex: 25 para focar em contas novas ou suspeitas):\nAutores com reputação MAIOR que esse valor serão ocultados.",
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
                            opt.textContent = `Personalizado (≤ ${parsed})`;
                            reputationSelect.appendChild(opt);
                        }
                        reputationSelect.value = String(parsed);
                        setCurrentPage(1);
                        refreshPostsDisplay();
                        showNotification(`Filtro ativado: ocultando autores com reputação > ${parsed} (≤ ${parsed})`, "warning");
                        return;
                    } else {
                        showNotification("Valor de reputação inválido", "error");
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
                showNotification("Filtro de reputação desativado (todas as reputações exibidas)", "info");
            } else {
                const num = parseInt(val, 10);
                setMaxReputationFilter(num);
                setCurrentPage(1);
                refreshPostsDisplay();
                showNotification(`Ocultando autores com reputação > ${num} (exibindo apenas ≤ ${num})`, "warning");
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