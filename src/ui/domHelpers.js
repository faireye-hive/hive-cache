// src/ui/domHelpers.js

import { moderationSettings, allPosts, currentPage, postsPerPage, flaggedPosts, setCurrentPage, setPostsPerPage, getPostTypeFilter, getSortCriteria, getAppFilter, setAppFilter, getDomainFilter, setDomainFilter, getViewMode, setViewMode, getBlacklistFilter, setBlacklistFilter, getMaxReputationFilter, setMaxReputationFilter } from '../config.js';
import { getRecentPostMatches } from '../moderation/filtering.js';
import { isUserMuted, muteUser, unmuteUser } from '../moderation/muting.js';
import { calculateRiskLevel, escapeHTML, renderPublicationTime, formatPendingPayout, extractPostApp, normalizeAppName, copyTextToClipboard } from '../utils/helpers.js';
import { getAuthorPendingPayout7d } from '../utils/statsCalculators.js';
import { extractPostDomains, groupPostsByDomain, extractPostUrls } from '../utils/linkExtractor.js';
import { accountLinkHtml } from './accountInvestigation.js';
import { showPostDetail } from './modals.js';
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

let groupByAuthor = false;

export function initRecentPostsControls() {
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

  const groupButton = document.getElementById("groupPostsByAuthor");
  groupButton.addEventListener("click", () => {
    groupByAuthor = !groupByAuthor;
    groupButton.setAttribute("aria-pressed", String(groupByAuthor));
    for (const option of document.getElementById("postsPerPage").options) {
      option.textContent = groupByAuthor ? `${option.value} authors per page` : `${option.value} per page`;
    }
    setCurrentPage(1);
    refreshPostsDisplay();
  });

  for (const [id, direction] of [["prevPage", -1], ["nextPage", 1]]) {
    document.getElementById(id).addEventListener("click", () => {
      setCurrentPage(currentPage + direction);
      refreshPostsDisplay();
    });
  }
}

// Mova refreshPostsDisplay para cá (e renomeie a chamada para toggleFlagPost)
export function refreshPostsDisplay() {
  let postsToShow = getRecentPostMatches();
  
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


  const byAuthor = new Map();
  for (const post of postsToShow) {
    if (!byAuthor.has(post.author)) byAuthor.set(post.author, []);
    byAuthor.get(post.author).push(post);
  }

  const container = document.getElementById("postsContainer");
  const currentViewMode = getViewMode();
  container.className = `posts-container view-mode-${currentViewMode}`;
  const summary = document.getElementById("postResultsSummary");
  const authorLabel = byAuthor.size === 1 ? "unique author" : "unique authors";
  const entryLabel = postsToShow.length === 1 ? "matching entry" : "matching entries";
  summary.textContent = `${byAuthor.size.toLocaleString()} ${authorLabel} · ${postsToShow.length.toLocaleString()} ${entryLabel}`;

  // Atualiza botões de toggle
  const gridBtn = document.getElementById("viewModeGrid");
  const listBtn = document.getElementById("viewModeList");
  if (gridBtn && listBtn) {
    gridBtn.classList.toggle("active", currentViewMode === "grid");
    listBtn.classList.toggle("active", currentViewMode === "list");
  }

  const entries = groupByAuthor ? [...byAuthor.values()] : postsToShow;
  const totalPages = Math.ceil(entries.length / postsPerPage);
  setCurrentPage(Math.max(1, Math.min(currentPage, totalPages)));
  document.getElementById("pageInfo").textContent = totalPages ? `Page ${currentPage} of ${totalPages}` : "Page 0 of 0";
  document.getElementById("prevPage").disabled = currentPage <= 1;
  document.getElementById("nextPage").disabled = currentPage >= totalPages;

  if (!entries.length) {
    container.innerHTML = '<div class="no-posts">No posts found</div>';
    return;
  }

  const startIndex = (currentPage - 1) * postsPerPage;
  const pageEntries = entries.slice(startIndex, startIndex + postsPerPage);
  container.replaceChildren(...pageEntries.map(entry => groupByAuthor
    ? createAuthorGroup(entry, currentViewMode)
    : createPostCard(entry, currentViewMode)));
  queueReputationFetch([...new Set(pageEntries.map(entry => groupByAuthor ? entry[0].author : entry.author))]);
}

function createAuthorGroup(posts, viewMode) {
  const firstCard = createPostCard(posts[0], viewMode);
  if (posts.length === 1) return firstCard;

  const group = document.createElement("div");
  group.className = "post-author-group";
  const details = document.createElement("details");
  details.className = "post-author-details";
  const summary = document.createElement("summary");
  const count = document.createElement("strong");
  count.textContent = `${posts.length.toLocaleString()} matching entries`;
  const action = document.createElement("span");
  const expandLabel = `Show ${(posts.length - 1).toLocaleString()} more`;
  action.textContent = expandLabel;
  summary.append(count, action);

  const cards = document.createElement("div");
  cards.className = "post-author-entries";
  const more = document.createElement("button");
  more.type = "button";
  more.className = "btn-action hidden";
  const batchSize = 10;
  let shown = 1;

  function appendBatch() {
    const batch = posts.slice(shown, shown + batchSize).map(post => createPostCard(post, viewMode));
    cards.append(...batch);
    shown += batch.length;
    more.classList.toggle("hidden", shown >= posts.length);
    more.textContent = `Show ${Math.min(batchSize, posts.length - shown)} more`;
  }

  more.addEventListener("click", () => {
    const firstNew = cards.children.length;
    appendBatch();
    cards.children[firstNew]?.querySelector(".view-post")?.focus();
  });
  details.addEventListener("toggle", () => {
    action.textContent = details.open ? "Collapse" : expandLabel;
    if (details.open && shown === 1) appendBatch();
  });
  details.append(summary, cards, more);
  group.append(firstCard, details);
  return group;
}

export function createPostCard(post, viewMode = "grid") {
    const div = document.createElement("div");
    const isBlacklisted = isAccountOnchainBlacklisted(post.author);
    const blacklistClass = isBlacklisted ? "is-blacklisted-card" : "";
    div.className = `post-card ${blacklistClass} ${viewMode === "list" ? "post-card-list" : "post-card-grid"}`;
    div.dataset.id = post.id;
    div.dataset.author = post.author;

    const isFlagged = Object.hasOwn(flaggedPosts, post.id);
    const isMuted = isUserMuted(post.author);
    const riskLevel = calculateRiskLevel(post);
    const payoutLabel = formatPendingPayout(post.pending_payout_value);
    const authorPendingPayout = formatPendingPayout(getAuthorPendingPayout7d(post.author));

    const title = String(post.title ?? "").trim();
    const titleHtml = title ? escapeHTML(title) : '<span class="post-untitled">Untitled</span>';
    const content = typeof post.body === "string" && post.body.trim() ? post.body.trim() : "No content";
    const contentLimit = viewMode === "list" ? 300 : 150;
    const shortContent = content.length > contentLimit
      ? escapeHTML(content.slice(0, contentLimit).replace(/\s+\S*$/, "")) + "…"
      : escapeHTML(content);

    const rawTags = Array.isArray(post.tags) ? post.tags : String(post.tags ?? "").split(/[,\s]+/);
    const tagsHtml = rawTags
      .filter(tag => typeof tag === "string" && tag.trim())
      .slice(0, viewMode === "list" ? 2 : 3)
      .map(tag => `<span class="post-tag" title="${escapeHTML(tag.trim())}">${escapeHTML(tag.trim())}</span>`)
      .join("");

    const rawApp = extractPostApp(post);
    const normApp = normalizeAppName(rawApp);
    const hasKnownApp = normApp && normApp !== "desconhecido";
    const appTooltip = hasKnownApp ? `Filter posts by ${normApp}` : "Unknown app";

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
        const titleText = `Blacklist by @${blDetails.sourceOwner}${blDetails.description ? ': ' + blDetails.description : ''}`;
        blacklistFlairHtml = `<span class="badge-blacklisted-flair" style="background:#4338ca;border-color:#6366f1;" title="${escapeHTML(titleText)}"><i class="fas fa-ban"></i> LISTA @${escapeHTML(blDetails.sourceOwner.toUpperCase())}</span>`;
      } else {
        const desc = blDetails?.description ? `: ${blDetails.description}` : '';
        const titleText = `Personal On-Chain Blacklist${desc}`;
        blacklistFlairHtml = `<span class="badge-blacklisted-flair" title="${escapeHTML(titleText)}"><i class="fas fa-ban"></i> BLACKLISTED</span>`;
      }
    }

    // Domínios externos detectados no post para atalho rápido
    const postDomains = extractPostDomains(post, true).slice(0, 2);
    let domainChipsHtml = '';
    if (postDomains.length > 0) {
      domainChipsHtml = `<div class="post-domains-row">${postDomains.map(d => `<span class="post-domain-chip" data-domain="${escapeHTML(d)}" title="Filter posts by domain: ${escapeHTML(d)}"><i class="fas fa-link"></i> ${escapeHTML(d)}</span>`).join('')}</div>`;
    }

    const typeHtml = post.parent_author ? '<span class="post-type">Comment</span>' : '<span class="post-type">Post</span>';
    const riskHtml = `<span class="risk-badge risk-${riskLevel}">${riskLevel.toUpperCase()}</span>`;
    const appHtml = `<span class="post-app" data-app="${escapeHTML(normApp)}" title="${escapeHTML(appTooltip)}">
      <i class="fas fa-cube" aria-hidden="true"></i> ${escapeHTML(hasKnownApp ? rawApp : "Unknown app")}
    </span>`;

    if (viewMode === "list") {
      div.innerHTML = `
        <div class="list-card-left">
          ${imageHtml || '<div class="list-thumb-placeholder"><i class="fas fa-file-alt" aria-hidden="true"></i></div>'}
        </div>
        <div class="list-card-center">
          <div class="list-card-heading">
            <div class="list-author-line">
              ${accountLinkHtml(post.author, 'post-author')}
              ${authorRepHtml}
            </div>
            <div class="list-status-pills">
              ${typeHtml}
              ${riskHtml}
              ${blacklistFlairHtml}
            </div>
          </div>
          <h3 class="post-title">${titleHtml}</h3>
          <p class="post-excerpt">${shortContent}</p>
          <div class="list-card-details">
            ${appHtml}
            <div class="post-tags">${tagsHtml}</div>
          </div>
          ${domainChipsHtml}
        </div>
      `;
    } else {
      div.innerHTML = `
        ${imageHtml}
        <div class="post-card-header ${post.parent_author ? "parented" : ""}">
          <div class="post-author-wrapper">
            ${accountLinkHtml(post.author, 'post-author')}
            ${authorRepHtml}
            ${blacklistFlairHtml}
          </div>
          ${typeHtml}
        </div>
        <div class="post-card-body">
          <h3 class="post-title">${titleHtml}</h3>
          <p class="post-excerpt">${shortContent}</p>
          <div class="post-tags">${tagsHtml}</div>
          ${domainChipsHtml}
          ${riskHtml}
          ${appHtml}
        </div>
      `;
    }

    div.insertAdjacentHTML("beforeend", `
      <div class="post-card-footer">
        <div class="post-card-meta">
          <span class="post-date">
            <i class="far fa-clock" aria-hidden="true"></i>
            <span>Published</span> ${renderPublicationTime(post.created)}
          </span>
          <span class="post-payout-info">Pending payout <strong class="post-payout">${payoutLabel}</strong></span>
          <span class="post-payout-info" title="Sum of pending payouts from this author's posts and comments available in the local cache for the last 7 days.">
            Author pending (7d cache) <strong class="post-author-pending">${authorPendingPayout}</strong>
          </span>
        </div>
        <div class="post-actions" role="group" aria-label="Post actions">
          <button type="button" class="btn-icon post-action-primary view-post">
            <i class="fas fa-eye" aria-hidden="true"></i> Details
          </button>
          <button type="button" class="btn-icon copy-body-btn">
            <i class="fas fa-copy" aria-hidden="true"></i> Copy text
          </button>
          <button type="button" class="btn-icon flag-post ${isFlagged ? "flagged" : ""}" data-id="${escapeHTML(post.id)}">
            <i class="fas fa-flag" aria-hidden="true"></i>
            <span class="flag-action-label">${isFlagged ? "Remove flag" : "Flag"}</span>
          </button>
          <button type="button" class="btn-icon mute-user-btn ${isMuted ? "muted" : ""}">
            <i class="fas ${isMuted ? "fa-eye" : "fa-eye-slash"}" aria-hidden="true"></i>
            <span class="mute-action-label">${isMuted ? "Show user" : "Hide user"}</span>
          </button>
          <button type="button" class="btn-icon downvote-post-btn">
            <i class="fas fa-arrow-down" aria-hidden="true"></i> Downvote
          </button>
          <button type="button" class="btn-icon onchain-blacklist-btn">
            <i class="fas fa-shield-virus" aria-hidden="true"></i> On-chain blacklist
          </button>
        </div>
      </div>
    `);

    const appBadge = div.querySelector(".post-app");
    if (appBadge && hasKnownApp) {
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
        const textToCopy = typeof post.body === "string" ? post.body : "";
        const success = await copyTextToClipboard(textToCopy);
        const icon = copyBtn.querySelector("i");
        if (success && icon) {
          icon.className = "fas fa-check";
          icon.style.color = "#10b981";
          setTimeout(() => {
            icon.className = "fas fa-copy";
            icon.style.color = "";
          }, 2000);
        }
        if (success) {
          showNotification("Post content (body) copied to clipboard!", "success");
        } else {
          showNotification("Could not copy content automatically", "error");
        }
      });
    }

    const viewBtn = div.querySelector(".view-post");
    const flagBtn = div.querySelector(".flag-post");
    const onchainBtn = div.querySelector(".onchain-blacklist-btn");
    const downvoteBtn = div.querySelector(".downvote-post-btn");
    const refreshRepBtn = div.querySelector(".btn-refresh-rep");

    if (viewBtn) viewBtn.addEventListener("click", () => showPostDetail(post));
    if (flagBtn) flagBtn.addEventListener("click", () => toggleFlagPost(post.id));
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
          reason: riskLevel === "high" ? "Detected Spam / Abuse" : "Rules Violation",
          severity: riskLevel === "high" ? "high" : "medium",
          notes: `Post: "${post.title || post.id}" (${riskLevel.toUpperCase()} risk)`,
        });
      });
    }

    const muteBtn = div.querySelector(".mute-user-btn");
    muteBtn.addEventListener("click", () => {
      if (isUserMuted(post.author)) unmuteUser(post.author);
      else muteUser(post.author);

      const muted = isUserMuted(post.author);
      muteBtn.classList.toggle("muted", muted);
      muteBtn.querySelector("i").className = muted ? "fas fa-eye" : "fas fa-eye-slash";
      muteBtn.querySelector(".mute-action-label").textContent = muted ? "Show user" : "Hide user";
    });

    return div;
}

// Mova updateFlaggedCount para cá
export function updateFlaggedCount() {
  const count = Object.keys(flaggedPosts).length;
  document.getElementById("flaggedCount").textContent = count;
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
      console.warn("Chart.js could not be loaded; charts are disabled.");
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
    appName === "all" ? "Showing all apps" : `Filtering posts by app: ${appName}`,
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
  allOption.textContent = `All Apps (${allPosts.length.toLocaleString('en-US')})`;
  appSelect.appendChild(allOption);

  sortedApps.forEach(([appName, count]) => {
    const opt = document.createElement("option");
    opt.value = appName;
    opt.textContent = `${appName} (${count.toLocaleString('en-US')})`;
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
      ? "Showing posts with all links"
      : domainName === "has-links"
      ? "Showing posts that contain links"
      : domainName === "no-links"
      ? "Showing posts without external links"
      : `Filtering posts by domain: ${domainName}`,
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
  allOption.textContent = `All Links / Domains (${allPosts.length.toLocaleString('en-US')})`;
  domainSelect.appendChild(allOption);

  const hasLinksOpt = document.createElement("option");
  hasLinksOpt.value = "has-links";
  hasLinksOpt.textContent = `🔗 With Links (${postsWithLinksCount.toLocaleString('en-US')})`;
  domainSelect.appendChild(hasLinksOpt);

  const noLinksOpt = document.createElement("option");
  noLinksOpt.value = "no-links";
  noLinksOpt.textContent = `📄 No Links (${postsWithoutLinksCount.toLocaleString('en-US')})`;
  domainSelect.appendChild(noLinksOpt);

  if (grouped.length > 0) {
    const optGroup = document.createElement("optgroup");
    optGroup.label = "Grouped Domains";

    // Mostra os 120 domínios mais frequentes
    grouped.slice(0, 120).forEach(({ domain, count, isImageCdn }) => {
      const opt = document.createElement("option");
      opt.value = domain;
      const cdnTag = isImageCdn ? " [CDN]" : "";
      opt.textContent = `${domain}${cdnTag} (${count.toLocaleString('en-US')})`;
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

