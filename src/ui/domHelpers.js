// src/ui/domHelpers.js

import { moderationSettings, allPosts, filteredPosts, currentPage, postsPerPage, flaggedPosts, setCurrentPage, setPostsPerPage, getPostTypeFilter, getSortCriteria, getAppFilter, setAppFilter, getDomainFilter, setDomainFilter, getViewMode, setViewMode, getBlacklistFilter, setBlacklistFilter, getMaxReputationFilter, setMaxReputationFilter } from '../config.js';
import { isUserMuted, muteUser, unmuteUser } from '../moderation/muting.js';
import { calculateRiskLevel, formatDate, escapeHTML, extractPostApp, normalizeAppName, copyTextToClipboard } from '../utils/helpers.js';
import { extractPostDomains, groupPostsByDomain, extractPostUrls } from '../utils/linkExtractor.js';
import { showPostDetail, openModerationPanel } from './modals.js';
import { toggleFlagPost } from '../moderation/flagging.js';
import { showNotification } from './notifications.js';
import { openOnchainBlacklistModal } from './onchainBlacklistModal.js';
import { createSafeImagePreviewHtml } from '../utils/imageProxy.js';
import { renderAuthorReputationHtml, queueReputationFetch, handleManualReputationRefresh, getCachedReputation } from '../api/reputationService.js';
import { openDownvoteModal } from './downvoteModal.js';
import { isAccountOnchainBlacklisted, getAccountBlacklistDetails } from '../api/onchainBlacklistService.js';

// Mova updatePostsDisplay para cá (apenas a função wrapper)
export function updatePostsDisplay() {
  refreshPostsDisplay();
}

/**
 * Inicializa a alternância entre Grid e List
 */
export function initViewModeToggle() {
  const gridBtn = document.getElementById("viewModeGrid");
  const listBtn = document.getElementById("viewModeList");

  if (gridBtn && listBtn) {
    gridBtn.addEventListener("click", () => {
      setViewMode("grid");
      refreshPostsDisplay();
    });
    listBtn.addEventListener("click", () => {
      setViewMode("list");
      refreshPostsDisplay();
    });
  }
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

  // B. APLICAR FILTRO DE APP
  const currentAppFilter = getAppFilter();
  if (currentAppFilter && currentAppFilter !== 'all') {
    postsToShow = postsToShow.filter(post => {
      const rawApp = extractPostApp(post);
      const normApp = normalizeAppName(rawApp);
      return normApp === currentAppFilter || rawApp.toLowerCase() === currentAppFilter;
    });
  }
  
  // C. APLICAR FILTRO DE MUTADOS
  postsToShow = postsToShow.filter((post) => !isUserMuted(post.author));
  
  // D. APLICAR FILTRO DE BLACKLIST ON-CHAIN
  const currentBlacklistFilter = getBlacklistFilter();
  if (currentBlacklistFilter === 'hide-blacklisted') {
    postsToShow = postsToShow.filter((post) => !isAccountOnchainBlacklisted(post.author));
  } else if (currentBlacklistFilter === 'only-blacklisted') {
    postsToShow = postsToShow.filter((post) => isAccountOnchainBlacklisted(post.author));
  }

  // E. APLICAR FILTRO DE REPUTAÇÃO MÁXIMA (Ocultar usuários com reputação maior que o limite selecionado)
  const maxRep = getMaxReputationFilter();
  if (maxRep !== null && !isNaN(maxRep)) {
    postsToShow = postsToShow.filter((post) => {
      const rep = getCachedReputation(post.author);
      // Se não estiver no cache ainda, NÃO permitir que autores sem verificação escapem do filtro!
      // Disparamos a requisição em background e só exibimos quem comprovadamente tiver score <= maxRep
      if (rep === null || typeof rep !== 'number' || isNaN(rep)) {
        queueReputationFetch([post.author]);
        return false;
      }
      return rep <= maxRep;
    });
  }

  // F. APLICAR FILTRO DE DOMÍNIOS E LINKS EXTERNOS AGRUPADOS
  const currentDomainFilter = getDomainFilter();
  if (currentDomainFilter && currentDomainFilter !== 'all') {
    if (currentDomainFilter === 'has-links') {
      postsToShow = postsToShow.filter((post) => extractPostDomains(post).length > 0);
    } else if (currentDomainFilter === 'no-links') {
      postsToShow = postsToShow.filter((post) => extractPostDomains(post).length === 0);
    } else {
      postsToShow = postsToShow.filter((post) => {
        const domains = extractPostDomains(post);
        return domains.includes(currentDomainFilter);
      });
    }
  }
  
  
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

  const currentViewMode = getViewMode();
  if (container) {
    container.className = currentViewMode === "list" ? "posts-container view-mode-list" : "posts-container view-mode-grid";
  }

  // Atualiza botões de toggle
  const gridBtn = document.getElementById("viewModeGrid");
  const listBtn = document.getElementById("viewModeList");
  if (gridBtn && listBtn) {
    gridBtn.classList.toggle("active", currentViewMode === "grid");
    listBtn.classList.toggle("active", currentViewMode === "list");
  }

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
    const postElement = createPostCard(post, currentViewMode);
    container.appendChild(postElement);
  });

  // Dispara busca e cache de reputação assíncrona para autores visíveis
  const visibleAuthors = pagePosts.map((p) => p.author);
  queueReputationFetch(visibleAuthors);

  document.getElementById("prevPage").disabled = currentPage === 1;
  document.getElementById("nextPage").disabled = currentPage === totalPages;
}

// Mova createPostCard para cá
export function createPostCard(post, viewMode = "grid") {
    const div = document.createElement("div");
    const isBlacklisted = isAccountOnchainBlacklisted(post.author);
    const blacklistClass = isBlacklisted ? "is-blacklisted-card" : "";
    div.className = `post-card ${blacklistClass} ${viewMode === "list" ? "post-card-list" : "post-card-grid"}`;
    div.dataset.id = post.id;
    div.dataset.author = post.author;

    const isFlagged = flaggedPosts[post.id];
    const flagClass = isFlagged ? "flagged" : "";
    const riskLevel = calculateRiskLevel(post);
    const payoutValue = parseFloat(post.pending_payout_value || 0);

    const title = escapeHTML(post.title) || "";
    const titleLimit = viewMode === "list" ? 75 : 50;
    const shortTitle = title.length > titleLimit ? title.substring(0, titleLimit) + "..." : title;
    
    const content = escapeHTML(post.body) || "Sem conteúdo";
    const contentLimit = viewMode === "list" ? 220 : 150;
    const shortContent =
        content.length > contentLimit ? content.substring(0, contentLimit) + "..." : content;

    let tagsHtml = "";
    if (post.tags) {
        const tagArray = Array.isArray(post.tags)
            ? post.tags.slice(0, 3)
            : post.tags.split(",").slice(0, 3);

        tagsHtml = tagArray
            .map((tag) => `<span class="post-tag">${escapeHTML(tag.trim())}</span>`)
            .join("");
    }

    const rawApp = extractPostApp(post);
    const normApp = normalizeAppName(rawApp);
    const appTooltip = normApp !== "desconhecido" ? `Filtrar posts por ${normApp}` : "App desconhecido";

    // Preview seguro de imagem via Proxy oficial da Hive
    const imageHtml = createSafeImagePreviewHtml(post, {
      width: viewMode === "list" ? 140 : 480,
      height: viewMode === "list" ? 100 : 0,
      className: viewMode === "list" ? "list-thumb-image" : "post-banner-image",
    });

    // Badge de Reputação com botão de atualização manual
    const authorRepHtml = renderAuthorReputationHtml(post.author, post.author_reputation);

    // Flair de Blacklist On-Chain com indicação da origem e motivo (blacklist_description)
    let blacklistFlairHtml = '';
    if (isBlacklisted) {
      const blDetails = getAccountBlacklistDetails(post.author);
      if (blDetails && blDetails.source === 'followed') {
        const titleText = `Blacklist de @${blDetails.sourceOwner}${blDetails.description ? ': ' + blDetails.description : ''}`;
        blacklistFlairHtml = `<span class="badge-blacklisted-flair" style="background:#4338ca;border-color:#6366f1;" title="${escapeHTML(titleText)}"><i class="fas fa-ban"></i> LISTA @${escapeHTML(blDetails.sourceOwner.toUpperCase())}</span>`;
      } else {
        const desc = blDetails?.description ? `: ${blDetails.description}` : '';
        const titleText = `Blacklist Pessoal On-Chain${desc}`;
        blacklistFlairHtml = `<span class="badge-blacklisted-flair" title="${escapeHTML(titleText)}"><i class="fas fa-ban"></i> BLACKLISTED</span>`;
      }
    }

    // Domínios externos detectados no post para atalho rápido
    const postDomains = extractPostDomains(post, true).slice(0, 2);
    let domainChipsHtml = '';
    if (postDomains.length > 0) {
      domainChipsHtml = `<div class="post-domains-row">${postDomains.map(d => `<span class="post-domain-chip" data-domain="${escapeHTML(d)}" title="Filtrar posts pelo domínio: ${escapeHTML(d)}"><i class="fas fa-link"></i> ${escapeHTML(d)}</span>`).join('')}</div>`;
    }

    if (viewMode === "list") {
      div.innerHTML = `
        <div class="list-card-left">
          ${imageHtml || '<div class="list-thumb-placeholder"><i class="fas fa-file-alt"></i></div>'}
        </div>
        <div class="list-card-center">
          <div class="list-meta-row">
            <span class="post-author">@${escapeHTML(post.author)}</span>
            ${authorRepHtml}
            ${blacklistFlairHtml}
            ${post.parent_author ? '<span class="post-type">Comentário</span>' : '<span class="post-type">Post</span>'}
            <span class="post-app" data-app="${escapeHTML(normApp)}" title="${escapeHTML(appTooltip)}">
              <i class="fas fa-cube"></i> ${escapeHTML(rawApp || "Desconhecido")}
            </span>
            <div class="risk-badge risk-${riskLevel}">${riskLevel.toUpperCase()}</div>
          </div>
          <h3 class="post-title">${shortTitle || '<span style="color:#9ca3af;font-style:italic;">Sem título</span>'}</h3>
          <p class="post-excerpt">${shortContent}</p>
          <div class="post-tags">${tagsHtml}</div>
          ${domainChipsHtml}
        </div>
        <div class="list-card-right">
          <div class="list-payout-date">
            <span class="post-payout">$${payoutValue.toFixed(2)}</span>
            <span class="post-date">${formatDate(post.created)}</span>
          </div>
          <div class="post-actions">
            <button class="btn-icon copy-body-btn" title="Copiar texto do post (apenas o body)">
              <i class="fas fa-copy"></i>
            </button>
            <button class="btn-icon view-post" title="Ver detalhes">
              <i class="fas fa-eye"></i>
            </button>
            <button class="btn-icon downvote-post-btn" title="Dar Downvote na Blockchain (Hive Keychain)">
              <i class="fas fa-arrow-down"></i>
            </button>
            <button class="btn-icon flag-post ${flagClass}" title="${isFlagged ? "Remover flag" : "Sinalizar"}">
              <i class="fas fa-flag"></i>
            </button>
            <button class="btn-icon onchain-blacklist-btn" title="Blacklist na Blockchain (Custom JSON)">
              <i class="fas fa-shield-virus"></i>
            </button>
            <button class="btn-icon moderate-post" title="Moderar Autor">
              <i class="fas fa-user-shield"></i>
            </button>
          </div>
        </div>
      `;
    } else {
      // Modo Grade
      div.innerHTML = `
        ${imageHtml}
        <div class="post-card-header ${post.parent_author ? "parented" : ""}">
            <div class="post-author-wrapper">
              <span class="post-author">@${escapeHTML(post.author)}</span>
              ${authorRepHtml}
              ${blacklistFlairHtml}
            </div>
            ${post.parent_author ? '<span class="post-type">Comentário</span>' : '<span class="post-type">Post</span>'}
            <span class="post-payout">$${payoutValue.toFixed(2)}</span>
        </div>
        <div class="post-card-body">
            <h3 class="post-title">${shortTitle}</h3>
            <p class="post-excerpt">${shortContent}</p>
            <div class="post-tags">${tagsHtml}</div>
            ${domainChipsHtml}
            <div class="risk-badge risk-${riskLevel}">${riskLevel.toUpperCase()}</div>
            <div class="post-app" data-app="${escapeHTML(normApp)}" title="${escapeHTML(appTooltip)}">
                <i class="fas fa-cube"></i> App: ${escapeHTML(rawApp || "Desconhecido")}
            </div>
        </div>
        <div class="post-card-footer">
            <span class="post-date">${formatDate(post.created)}</span>
            <div class="post-actions">
                <button class="btn-icon copy-body-btn" title="Copiar texto do post (apenas o body)">
                    <i class="fas fa-copy"></i>
                </button>
                <button class="btn-icon view-post" title="Ver detalhes">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn-icon downvote-post-btn" title="Dar Downvote na Blockchain (Hive Keychain)">
                    <i class="fas fa-arrow-down"></i>
                </button>
                <button class="btn-icon flag-post ${flagClass}" title="${isFlagged ? "Remover flag" : "Sinalizar"}">
                    <i class="fas fa-flag"></i>
                </button>
                <button class="btn-icon onchain-blacklist-btn" title="Blacklist na Blockchain (Custom JSON)">
                    <i class="fas fa-shield-virus"></i>
                </button>
                <button class="btn-icon moderate-post" title="Moderar">
                    <i class="fas fa-user-shield"></i>
                </button>
            </div>
        </div>
      `;
    }

    const appBadge = div.querySelector(".post-app");
    if (appBadge && normApp && normApp !== "desconhecido") {
      appBadge.addEventListener("click", (e) => {
        e.stopPropagation();
        selectAppFilter(normApp);
      });
    }

    div.querySelectorAll(".post-domain-chip").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        const dom = chip.getAttribute("data-domain");
        if (dom) selectDomainFilter(dom);
      });
    });

    const copyBtn = div.querySelector(".copy-body-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const textToCopy = post.body || "";
        const success = await copyTextToClipboard(textToCopy);
        const icon = copyBtn.querySelector("i");
        if (icon) {
          icon.className = "fas fa-check";
          icon.style.color = "#10b981";
          setTimeout(() => {
            icon.className = "fas fa-copy";
            icon.style.color = "";
          }, 2000);
        }
        if (success) {
          showNotification("Conteúdo (body) copiado para a área de transferência!", "success");
        } else {
          showNotification("Não foi possível copiar o conteúdo automaticamente", "error");
        }
      });
    }

    const viewBtn = div.querySelector(".view-post");
    const flagBtn = div.querySelector(".flag-post");
    const modBtn = div.querySelector(".moderate-post");
    const onchainBtn = div.querySelector(".onchain-blacklist-btn");
    const downvoteBtn = div.querySelector(".downvote-post-btn");
    const refreshRepBtn = div.querySelector(".btn-refresh-rep");

    if (viewBtn) viewBtn.addEventListener("click", () => showPostDetail(post));
    if (flagBtn) flagBtn.addEventListener("click", () => toggleFlagPost(post.id));
    if (modBtn) modBtn.addEventListener("click", () => openModerationPanel(post));
    if (downvoteBtn) {
      downvoteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openDownvoteModal(post);
      });
    }
    if (refreshRepBtn) {
      refreshRepBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleManualReputationRefresh(post.author, refreshRepBtn);
      });
    }
    if (onchainBtn) {
      onchainBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openOnchainBlacklistModal(post.author, {
          reason: riskLevel === "high" ? "Spam / Abuso Detectado" : "Violação de Regras",
          severity: riskLevel === "high" ? "high" : "medium",
          notes: `Post: "${post.title || post.id}" (${riskLevel.toUpperCase()} risco)`,
        });
      });
    }

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

// Seleciona um app específico e filtra a listagem
export function selectAppFilter(appName) {
  setAppFilter(appName);

  const appSelect = document.getElementById("appFilter");
  if (appSelect) {
    appSelect.value = appName;
    if (appSelect.value !== appName) {
      const opt = document.createElement("option");
      opt.value = appName;
      opt.textContent = appName;
      appSelect.appendChild(opt);
      appSelect.value = appName;
    }
  }

  // Navega para a aba de posts se estiver em outra
  const postsNavBtn = document.querySelector('.nav-item[data-section="posts-section"]');
  if (postsNavBtn && !postsNavBtn.classList.contains("active")) {
    postsNavBtn.click();
  }

  setCurrentPage(1);
  refreshPostsDisplay();
  showNotification(
    appName === "all" ? "Exibindo todos os apps" : `Filtrando posts pelo aplicativo: ${appName}`,
    "info"
  );
}

// Popula dinamicamente o dropdown de seleção de apps com contagens reais
export function updateAppFilterDropdown() {
  const appSelect = document.getElementById("appFilter");
  if (!appSelect) return;

  const currentSelected = getAppFilter();
  const appCounts = {};

  allPosts.forEach((post) => {
    const raw = extractPostApp(post);
    const norm = normalizeAppName(raw);
    appCounts[norm] = (appCounts[norm] || 0) + 1;
  });

  const sortedApps = Object.entries(appCounts).sort((a, b) => b[1] - a[1]);

  appSelect.innerHTML = "";
  
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = `Todos os Apps (${allPosts.length.toLocaleString('pt-BR')})`;
  appSelect.appendChild(allOption);

  sortedApps.forEach(([appName, count]) => {
    const opt = document.createElement("option");
    opt.value = appName;
    opt.textContent = `${appName} (${count.toLocaleString('pt-BR')})`;
    appSelect.appendChild(opt);
  });

  if (currentSelected && (currentSelected === "all" || appCounts[currentSelected])) {
    appSelect.value = currentSelected;
  } else {
    appSelect.value = "all";
    setAppFilter("all");
  }
}

/**
 * Define o filtro de domínio programaticamente e atualiza a interface
 * @param {string} domainName 
 */
export function selectDomainFilter(domainName) {
  const domainSelect = document.getElementById("domainFilter");
  setDomainFilter(domainName);
  if (domainSelect) {
    domainSelect.value = domainName;
  }
  setCurrentPage(1);
  refreshPostsDisplay();
  showNotification(
    domainName === "all"
      ? "Exibindo posts com todos os links"
      : domainName === "has-links"
      ? "Exibindo posts que possuem links"
      : domainName === "no-links"
      ? "Exibindo posts sem links externos"
      : `Filtrando posts pelo domínio: ${domainName}`,
    "info"
  );
}

/**
 * Popula dinamicamente o dropdown de seleção de links e domínios agrupados com contagens reais
 */
export function updateDomainFilterDropdown() {
  const domainSelect = document.getElementById("domainFilter");
  if (!domainSelect) return;

  const currentSelected = getDomainFilter();
  const grouped = groupPostsByDomain(allPosts, false);

  let postsWithLinksCount = 0;
  let postsWithoutLinksCount = 0;

  allPosts.forEach((p) => {
    const domains = extractPostDomains(p, false);
    if (domains.length > 0) {
      postsWithLinksCount++;
    } else {
      postsWithoutLinksCount++;
    }
  });

  domainSelect.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = `Todos os Links / Domínios (${allPosts.length.toLocaleString('pt-BR')})`;
  domainSelect.appendChild(allOption);

  const hasLinksOpt = document.createElement("option");
  hasLinksOpt.value = "has-links";
  hasLinksOpt.textContent = `🔗 Com Links (${postsWithLinksCount.toLocaleString('pt-BR')})`;
  domainSelect.appendChild(hasLinksOpt);

  const noLinksOpt = document.createElement("option");
  noLinksOpt.value = "no-links";
  noLinksOpt.textContent = `📄 Sem Links (${postsWithoutLinksCount.toLocaleString('pt-BR')})`;
  domainSelect.appendChild(noLinksOpt);

  if (grouped.length > 0) {
    const optGroup = document.createElement("optgroup");
    optGroup.label = "Domínios Agrupados";

    // Mostra os 120 domínios mais frequentes
    grouped.slice(0, 120).forEach(({ domain, count, isImageCdn }) => {
      const opt = document.createElement("option");
      opt.value = domain;
      const cdnTag = isImageCdn ? " [CDN]" : "";
      opt.textContent = `${domain}${cdnTag} (${count.toLocaleString('pt-BR')})`;
      optGroup.appendChild(opt);
    });

    domainSelect.appendChild(optGroup);
  }

  if (currentSelected && (currentSelected === "all" || currentSelected === "has-links" || currentSelected === "no-links" || grouped.some(g => g.domain === currentSelected))) {
    domainSelect.value = currentSelected;
  } else {
    domainSelect.value = "all";
    setDomainFilter("all");
  }
}

