// src/app.js

import { loadChartJS, updatePostsDisplay, updateSystemStatus, selectAllPosts,refreshPostsDisplay } from './ui/domHelpers.js';
import { loadSettings, applySettings, saveSettings } from './core/settings.js';
import { initLoginSystem } from './core/auth.js';
import { initNavigation } from './core/navigation.js';
import { initModalListeners, openMutedUsersManager } from './ui/modals.js';
import { loadInitialData, loadPosts, showCacheStats, clearCache } from './api/dataLoader.js';
import { searchPosts, applyFilter, performAdvancedSearch } from './moderation/filtering.js';
import { scanForSpam, scanForPlagiarism } from './moderation/scan.js';
import { moderationSettings, setPostsPerPage, currentPage, setCurrentPage, postsPerPage,
          filteredPosts, getPostTypeFilter, setPostTypeFilter,getSortCriteria,setSortCriteria } from './config.js';
import { debounce } from './utils/helpers.js';



// Configuração Global no Window/Global Scope (para compatibilidade com funções inline)
// O ideal é evitar isso, mas mantemos para funções que não foram alteradas
window.loadPosts = loadPosts;
window.showCacheStats = showCacheStats;
window.clearCache = clearCache;
window.openMutedUsersManager = openMutedUsersManager;

// Funções de Ação/Eventos
function initEventListeners() {
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
  await loadInitialData();
  updateSystemStatus();

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
}