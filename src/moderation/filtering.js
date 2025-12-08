// src/moderation/filtering.js

import { allPosts, filteredPosts, currentPage, postsPerPage, setFilteredPosts, setCurrentPage, flaggedPosts, flaggedCurrentPage, flaggedPostsPerPage, setFlaggedCurrentPage, setPostsPerPage, moderationSettings } from '../config.js';
import { updatePostsDisplay, refreshPostsDisplay, createPostCard, updateFlaggedCount } from '../ui/domHelpers.js';
import { escapeHTML, normalizeTags, formatDate,calculateRiskLevel } from '../utils/helpers.js';
import { showNotification } from '../ui/notifications.js';
import { toggleFlagPost } from './flagging.js';

// Mova searchPosts para cá
export function searchPosts() {
  const searchTerm = document.getElementById("searchInput").value.toLowerCase();
  const filterType = document.getElementById("searchFilter").value;

  if (!searchTerm) {
    setFilteredPosts([...allPosts]);
  } else {
    const results = allPosts.filter((post) => {
      switch (filterType) {
        case "author":
          return post.author.toLowerCase().includes(searchTerm);

        case "title":
          return (escapeHTML(post.title) || "")
            .toLowerCase()
            .includes(searchTerm);

        case "content":
          return (escapeHTML(post.body) || "")
            .toLowerCase()
            .includes(searchTerm);

        case "tags":
          return normalizeTags(post.tags).includes(searchTerm);

        default:
          return (
            post.author.toLowerCase().includes(searchTerm) ||
            (escapeHTML(post.title) || "").toLowerCase().includes(searchTerm) ||
            (escapeHTML(post.body) || "").toLowerCase().includes(searchTerm) ||
            normalizeTags(post.tags).includes(searchTerm)
          );
      }
    });
    setFilteredPosts(results);
  }

  setCurrentPage(1);
  updatePostsDisplay();
}

// Mova applyFilter para cá
export function applyFilter(filterType) {
  const now = new Date();
  let results;

  switch (filterType) {
    case "last-hour":
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      results = allPosts.filter(
        (post) => new Date(post.created) > oneHourAgo
      );
      break;

    case "last-6h":
      const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      results = allPosts.filter(
        (post) => new Date(post.created) > sixHoursAgo
      );
      break;

    case "high-payout":
      results = allPosts.filter(
        (post) => parseFloat(post.pending_payout_value || 0) > 100
      );
      break;

    case "flagged":
      results = allPosts.filter((post) => flaggedPosts[post.id]);
      break;

    case "deleted":
      results = allPosts.filter((post) => post.deleted === true);
      break;

    default:
      results = [...allPosts];
  }

  setFilteredPosts(results);
  setCurrentPage(1);
  updatePostsDisplay();
}

// Mova loadModerationPanel para cá
export function loadModerationPanel() {
  const tableBody = document.getElementById("moderationTableBody");
  tableBody.innerHTML = "";

  let highRisk = 0,
    mediumRisk = 0,
    lowRisk = 0,
    totalFlagged = 0;

  const moderationPosts = allPosts.slice(0, 100);

  moderationPosts.forEach((post) => {
    const riskLevel = calculateRiskLevel(post);
    const isFlagged = flaggedPosts[post.id];

    switch (riskLevel) {
      case "high":
        highRisk++;
        break;
      case "medium":
        mediumRisk++;
        break;
      case "low":
        lowRisk++;
        break;
    }

    if (isFlagged) totalFlagged++;

    // ... restante da lógica de criação de linha da tabela ...
    const row = document.createElement("tr");
    row.innerHTML = `
            <td><input type="checkbox" class="post-checkbox" data-id="${post.id}"></td>
            <td>${post.author}</td>
            <td>${(escapeHTML(post.title) || "Sem título").substring(0, 50)}${(escapeHTML(post.title) || "").length > 50 ? "..." : ""}</td>
            <td>$${parseFloat(post.pending_payout_value || 0).toFixed(2)}</td>
            <td><span class="risk-badge risk-${riskLevel}">${riskLevel.toUpperCase()}</span></td>
            <td>${isFlagged ? '<i class="fas fa-flag text-danger"></i>' : ""}</td>
            <td>
                <button class="btn-icon view-post-sm" data-id="${post.id}">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn-icon flag-post-sm ${isFlagged ? "flagged" : ""}" data-id="${post.id}">
                    <i class="fas fa-flag"></i>
                </button>
                <button class="btn-icon delete-post-sm" data-id="${post.id}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;

    row
      .querySelector(".view-post-sm")
      .addEventListener("click", () => showPostDetail(post));
    row
      .querySelector(".flag-post-sm")
      .addEventListener("click", () => toggleFlagPost(post.id, true));
    row
      .querySelector(".delete-post-sm")
      .addEventListener("click", () => deletePost(post.id));


    tableBody.appendChild(row);
  });

  document.getElementById("highRiskCount").textContent = highRisk;
  document.getElementById("mediumRiskCount").textContent = mediumRisk;
  document.getElementById("lowRiskCount").textContent = lowRisk;
  document.getElementById("totalFlaggedCount").textContent = totalFlagged;
}

// Mova loadFlaggedPosts para cá
export function loadFlaggedPosts() {
  const container = document.getElementById("flaggedContainer");
  const paginationTop = document.getElementById("flaggedPaginationTop");
  const paginationBottom = document.getElementById("flaggedPagination");

  container.innerHTML = "";
  if (paginationTop) paginationTop.innerHTML = "";
  if (paginationBottom) paginationBottom.innerHTML = "";

  const flaggedPostIds = Object.keys(flaggedPosts);
  if (flaggedPostIds.length === 0) {
    container.innerHTML = '<div class="no-posts">Nenhum post sinalizado</div>';
    return;
  }

  const authorStats = {};
  allPosts.forEach((post) => {
    // ... lógica de authorStats ...
    const author = post.author.trim();
    if (!authorStats[author]) {
      authorStats[author] = { postCount: 0, totalPayout: 0 };
    }
    authorStats[author].postCount++;
    authorStats[author].totalPayout += post.pending_payout_value
      ? parseFloat(post.pending_payout_value)
      : 0;
  });

  const flaggedPostsList = allPosts.filter((post) =>
    flaggedPostIds.includes(post.id.toString())
  );

  const seenAuthors = new Set();
  const uniqueAuthorPosts = [];
  flaggedPostsList.forEach((post) => {
    const author = post.author.trim();
    if (!seenAuthors.has(author)) {
      seenAuthors.add(author);
      uniqueAuthorPosts.push(post);
    }
  });

  const totalPages = Math.ceil(uniqueAuthorPosts.length / flaggedPostsPerPage);
  if (flaggedCurrentPage > totalPages) setFlaggedCurrentPage(totalPages);

  const startIndex = (flaggedCurrentPage - 1) * flaggedPostsPerPage;
  const endIndex = startIndex + flaggedPostsPerPage;
  const pagePosts = uniqueAuthorPosts.slice(startIndex, endIndex);

  pagePosts.forEach((post) => {
    // ... lógica de display de flagged post ...
    const flagInfo = flaggedPosts[post.id];
    const postElement = createPostCard(post);

    const author = post.author.trim();
    const stats = authorStats[author] || { postCount: 1, totalPayout: 0 };

    const payoutElem = postElement.querySelector(".post-payout");
    if (payoutElem) {
      payoutElem.textContent = `T: ${stats.totalPayout.toFixed(3)}`;
    }

    const flagDetails = document.createElement("div");
    flagDetails.className = "flag-details";
    flagDetails.innerHTML = `
      <p>
        <strong>Autor:</strong> ${author} 
        <span class="badge"><strong>posts:</strong> ${stats.postCount} </span>
      </p>
      <p><strong>Sinalizado por:</strong> ${flagInfo.flaggedBy}</p>
      <p><strong>Data:</strong> ${formatDate(flagInfo.timestamp)}</p>
      ${flagInfo.reason ? `<p><strong>Motivo:</strong> ${flagInfo.reason}</p>` : ""}
      <button class="btn-primary clear-flag-btn" data-id="${post.id}">
        <i class="fas fa-check"></i> Limpar Flag
      </button>
    `;

    flagDetails
      .querySelector(".clear-flag-btn")
      .addEventListener("click", () => {
        toggleFlagPost(post.id);
        loadFlaggedPosts();
        updateFlaggedCount();
      });

    postElement.appendChild(flagDetails);
    container.appendChild(postElement);
  });

  function renderPagination(paginationContainer) {
    if (!paginationContainer || totalPages <= 1) return;
    // ... lógica de paginação ...
    const prevBtn = document.createElement("button");
    prevBtn.textContent = "Anterior";
    prevBtn.disabled = flaggedCurrentPage === 1;
    prevBtn.addEventListener("click", () => {
      setFlaggedCurrentPage(flaggedCurrentPage - 1);
      loadFlaggedPosts();
    });

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Próxima";
    nextBtn.disabled = flaggedCurrentPage === totalPages;
    nextBtn.addEventListener("click", () => {
      setFlaggedCurrentPage(flaggedCurrentPage + 1);
      loadFlaggedPosts();
    });

    const pageInfo = document.createElement("span");
    pageInfo.textContent = `Página ${flaggedCurrentPage} de ${totalPages}`;

    paginationContainer.appendChild(prevBtn);
    paginationContainer.appendChild(pageInfo);
    paginationContainer.appendChild(nextBtn);
  }

  renderPagination(paginationTop);
  renderPagination(paginationBottom);
}

// Mova performAdvancedSearch e displaySearchResults para cá
export function performAdvancedSearch() {
  const author = document.getElementById("searchAuthor").value.toLowerCase();
  const title = document.getElementById("searchTitle").value.toLowerCase();
  const tags = document.getElementById("searchTags").value.toLowerCase();
  const content = document.getElementById("searchContent").value.toLowerCase();
  const dateFrom = document.getElementById("searchDateFrom").value;
  const dateTo = document.getElementById("searchDateTo").value;
  const minPayout =
    parseFloat(document.getElementById("searchMinPayout").value) || 0;

  let results = [...allPosts];

  // ... lógica de filtragem ...
  if (author) {
    results = results.filter((post) =>
      post.author.toLowerCase().includes(author)
    );
  }

  if (title) {
    results = results.filter((post) =>
      (escapeHTML(post.title) || "").toLowerCase().includes(title)
    );
  }

  if (tags) {
    const tagList = tags.split(",").map((t) => t.trim());
    results = results.filter((post) => {
      if (!post.tags) return false;
      const postTags = post.tags.toLowerCase();
      return tagList.some((tag) => postTags.includes(tag));
    });
  }

  if (content) {
    try {
      if (
        content.includes("*") ||
        content.includes("[") ||
        content.includes("(")
      ) {
        const regex = new RegExp(content, "i");
        results = results.filter((post) =>
          regex.test(escapeHTML(post.body) || "")
        );
      } else {
        results = results.filter((post) =>
          (escapeHTML(post.body) || "").toLowerCase().includes(content)
        );
      }
    } catch {
      results = results.filter((post) =>
        (escapeHTML(post.body) || "").toLowerCase().includes(content)
      );
    }
  }

  if (dateFrom) {
    const fromDate = new Date(dateFrom);
    results = results.filter((post) => new Date(post.created) >= fromDate);
  }

  if (dateTo) {
    const toDate = new Date(dateTo);
    results = results.filter((post) => new Date(post.created) <= toDate);
  }

  if (minPayout > 0) {
    results = results.filter(
      (post) => parseFloat(post.pending_payout_value || 0) >= minPayout
    );
  }

  displaySearchResults(results);
}

export function displaySearchResults(results) {
  const container = document.getElementById("advancedSearchResults");
  container.innerHTML = "";

  if (results.length === 0) {
    container.innerHTML =
      '<div class="no-results">Nenhum resultado encontrado</div>';
    return;
  }

  const summary = document.createElement("div");
  summary.className = "search-summary";
  summary.innerHTML = `<h4>${results.length} resultados encontrados</h4>`;
  container.appendChild(summary);

  results.slice(0, 50).forEach((post) => {
    // ... lógica de display de resultado ...
    const div = document.createElement("div");
    div.className = "search-result-item";
    div.innerHTML = `
            <h5>${escapeHTML(post.title) || "Sem título"}</h5>
            <p><strong>Autor:</strong> ${post.author}</p>
            <p><strong>Payout:</strong> $${parseFloat(post.pending_payout_value || 0).toFixed(2)}</p>
            <p><strong>Data:</strong> ${formatDate(post.created)}</p>
            <p><strong>Tags:</strong> ${post.tags || "Nenhuma"}</p>
            <p class="excerpt">${escapeHTML(post.body) ? escapeHTML(post.body).substring(0, 200) + "..." : ""}</p>
            <button class="btn-primary view-result-btn" data-id="${post.id}">
                <i class="fas fa-eye"></i> Ver Detalhes
            </button>
        `;

    div
      .querySelector(".view-result-btn")
      .addEventListener("click", () => showPostDetail(post));
    container.appendChild(div);
  });
}