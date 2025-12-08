// src/ui/domHelpers.js

import { moderationSettings, filteredPosts, currentPage, postsPerPage, flaggedPosts, setCurrentPage, setPostsPerPage, getPostTypeFilter,getSortCriteria } from '../config.js';
import { isUserMuted, muteUser, unmuteUser } from '../moderation/muting.js';
import { calculateRiskLevel, formatDate, escapeHTML } from '../utils/helpers.js';
import { showPostDetail, openModerationPanel } from './modals.js';
import { toggleFlagPost } from '../moderation/flagging.js';

// Mova updatePostsDisplay para cá (apenas a função wrapper)
export function updatePostsDisplay() {
  refreshPostsDisplay();
}

// Mova refreshPostsDisplay para cá (e renomeie a chamada para toggleFlagPost)
export function refreshPostsDisplay() {
  // 1. Iniciar filtragem pelos posts do filtro de busca original
  let postsToShow = filteredPosts;
  
  // A. APLICAR FILTRO DE TIPO DE POSTAGEM
  const currentPostTypeFilter = getPostTypeFilter();

  if (currentPostTypeFilter === 'only-posts') {
    // parent_author é null/undefined para posts originais
    postsToShow = postsToShow.filter(post => !post.parent_author);
  } else if (currentPostTypeFilter === 'only-comments') {
    // parent_author existe para comentários
    postsToShow = postsToShow.filter(post => post.parent_author);
  }
  
  // B. APLICAR FILTRO DE MUTADOS
  postsToShow = postsToShow.filter((post) => !isUserMuted(post.author));
  
  
  // C. APLICAR ORDENAÇÃO (NOVA LÓGICA OTIMIZADA)
  const criteria = getSortCriteria();

  if (criteria !== 'created-desc') {
      
      // 1. Pré-calcular a chave de ordenação em O(N)
      const postsWithSortKey = postsToShow.map(post => {
          let sortKey = 0;
          
          if (criteria === 'payout-desc') {
              // Payout é calculado rapidamente, mas usamos a estrutura otimizada por consistência
              sortKey = parseFloat(post.pending_payout_value || 0);
          } else if (criteria === 'risk-desc') {
              // ⭐️ OTIMIZAÇÃO: calculateRiskLevel é chamado APENAS UMA VEZ por post aqui
              const level = calculateRiskLevel(post);
              // Converte o nível de risco para um valor numérico para ordenação
              sortKey = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
          }
          
          return { post, sortKey };
      });

      // 2. Ordenar a lista usando a chave pré-calculada (O(N log N) rápido)
      postsWithSortKey.sort((a, b) => {
          // Ordenação decrescente (do maior para o menor) para Payout e Risco
          return b.sortKey - a.sortKey; 
      });

      // 3. Mapear de volta para o array de posts original
      postsToShow = postsWithSortKey.map(item => item.post);
  }
  // FIM DA ORDENAÇÃO OTIMIZADA


  const container = document.getElementById("postsContainer");
  const pageInfo = document.getElementById("pageInfo");

  if (postsToShow.length === 0) {
    container.innerHTML = '<div class="no-posts">Nenhum post encontrado</div>';
    pageInfo.textContent = "Página 0 de 0";
    return;
  }

  // D. APLICAR PAGINAÇÃO
  const startIndex = (currentPage - 1) * postsPerPage;
  const endIndex = startIndex + postsPerPage;
  const pagePosts = postsToShow.slice(startIndex, endIndex);

  const totalPages = Math.ceil(postsToShow.length / postsPerPage);

  // **Tratamento de página inválida:** Recua para a última página se a atual for muito alta
  if (currentPage > totalPages && totalPages > 0) {
    setCurrentPage(totalPages);
    refreshPostsDisplay(); // Chamar recursivamente após redefinir
    return;
  }

  pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;

  container.innerHTML = "";
  pagePosts.forEach((post) => {
    const postElement = createPostCard(post);
    container.appendChild(postElement);
  });

  document.getElementById("prevPage").disabled = currentPage === 1;
  document.getElementById("nextPage").disabled = currentPage === totalPages;
}

// Mova createPostCard para cá
export function createPostCard(post) {
    const div = document.createElement("div");
    div.className = "post-card";
    div.dataset.id = post.id;

    const isFlagged = flaggedPosts[post.id];
    const flagClass = isFlagged ? "flagged" : "";
    const riskLevel = calculateRiskLevel(post);
    const payoutValue = parseFloat(post.pending_payout_value || 0);

    const title = escapeHTML(post.title) || "";
    const shortTitle = title.length > 50 ? title.substring(0, 50) + "..." : title;
    const content = escapeHTML(post.body) || "Sem conteúdo";
    const shortContent =
        content.length > 150 ? content.substring(0, 150) + "..." : content;

    let tagsHtml = "";
    if (post.tags) {
        // ... tags logic ...
        const tagArray = Array.isArray(post.tags)
            ? post.tags.slice(0, 3)
            : post.tags.split(",").slice(0, 3);

        tagsHtml = tagArray
            .map((tag) => `<span class="post-tag">${tag.trim()}</span>`)
            .join("");
    }

    div.innerHTML = `
        <div class="post-card-header ${post.parent_author ? "parented" : ""}">
            <span class="post-author">@${post.author}</span>
            ${post.parent_author ? '<span class="post-type">Comentário</span>' : '<span class="post-type">Post</span>'}
            <span class="post-payout">$${payoutValue.toFixed(2)}</span>
        </div>
        <div class="post-card-body">
            <h3 class="post-title">${shortTitle}</h3>
            <p class="post-excerpt">${shortContent}</p>
            <div class="post-tags">${tagsHtml}</div>
            <div class="risk-badge risk-${riskLevel}">${riskLevel.toUpperCase()}</div>
            <div class="post-app">App: ${post.json_metadata.app || "Desconhecido"}</div>
        </div>
        <div class="post-card-footer">
            <span class="post-date">${formatDate(post.created)}</span>
            <div class="post-actions">
                <button class="btn-icon view-post" title="Ver detalhes">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn-icon flag-post ${flagClass}" title="${isFlagged ? "Remover flag" : "Sinalizar"}">
                    <i class="fas fa-flag"></i>
                </button>
                <button class="btn-icon moderate-post" title="Moderar">
                    <i class="fas fa-user-shield"></i>
                </button>
            </div>
        </div>
    `;

    const viewBtn = div.querySelector(".view-post");
    const flagBtn = div.querySelector(".flag-post");
    const modBtn = div.querySelector(".moderate-post");

    if (viewBtn) viewBtn.addEventListener("click", () => showPostDetail(post));
    if (flagBtn) flagBtn.addEventListener("click", () => toggleFlagPost(post.id));
    if (modBtn) modBtn.addEventListener("click", () => openModerationPanel(post));

    const muteBtn = document.createElement("button");
    const isMuted = isUserMuted(post.author);
    muteBtn.className = `btn-icon mute-user-btn ${isMuted ? "muted" : ""}`;
    muteBtn.title = isMuted ? "Desmutar usuário" : "Mutuar usuário";
    muteBtn.innerHTML = `<i class="fas fa-volume-mute"></i>`;

    muteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isUserMuted(post.author)) {
            unmuteUser(post.author);
        } else {
            muteUser(post.author);
        }
        // Após mutar/desmutar, o botão é atualizado pelo refreshPostsDisplay (via muteUser/unmuteUser)
    });

    const actionsContainer = div.querySelector(".post-actions");
    if (actionsContainer) {
        actionsContainer.appendChild(muteBtn);
    }

    return div;
}

// Mova updateFlaggedCount para cá
export function updateFlaggedCount() {
  const count = Object.keys(flaggedPosts).length;
  document.getElementById("flaggedCount").textContent = count;
}

// Mova selectAllPosts para cá
export function selectAllPosts() {
  const selectAll = document.getElementById("selectAll");
  const checkboxes = document.querySelectorAll(".post-checkbox");
  checkboxes.forEach((cb) => (cb.checked = selectAll.checked));
}

// Mova updateSystemStatus para cá
export function updateSystemStatus() {
  updateFlaggedCount();

  const onlineUsers = Math.floor(Math.random() * 10) + 1;
  document.getElementById("onlineUsers").textContent = onlineUsers;
}

// Mova loadChartJS para cá
export function loadChartJS() {
  return new Promise((resolve) => {
    if (typeof Chart !== "undefined") {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js";
    script.integrity =
      "sha512-ElRFoEQdI5Ht6kZvyzXhYG9NqjtkmlkfYk0wr6wHxU9JEHakS7UJZNeml5ALk+8IKlU6jDgMabC3vkumRokgJA==";
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";

    script.onload = () => resolve();
    script.onerror = () => {
      console.warn("Chart.js não pôde ser carregado, gráficos desabilitados");
      resolve();
    };

    document.head.appendChild(script);
  });
}