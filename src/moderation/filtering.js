// src/moderation/filtering.js

import { allPosts, setCurrentPage, flaggedPosts, flaggedCurrentPage, flaggedPostsPerPage, setFlaggedCurrentPage, setPostsPerPage, moderationSettings } from '../config.js';
import { updatePostsDisplay, refreshPostsDisplay, createPostCard, updateFlaggedCount } from '../ui/domHelpers.js';
import { escapeHTML, normalizeTags, formatDate, parseHiveDate, extractPostApp, normalizeAppName } from '../utils/helpers.js';
import { showNotification } from '../ui/notifications.js';
import { accountLinkHtml } from '../ui/accountInvestigation.js';
import { showPostDetail } from '../ui/modals.js';
import { toggleFlagPost } from './flagging.js';

let quickFilter = "all";

export function searchPosts() {
  setCurrentPage(1);
  updatePostsDisplay();
}

export function applyFilter(filterType) {
  quickFilter = filterType;
  searchPosts();
}

export function getRecentPostMatches() {
  const now = Date.now();
  const searchTerm = document.getElementById("searchInput").value.toLowerCase().trim();
  const searchField = document.getElementById("searchFilter").value;
  let posts = allPosts;

  switch (quickFilter) {
    case "last-hour":
    case "last-6h": {
      const hours = quickFilter === "last-hour" ? 1 : 6;
      const cutoff = now - hours * 3600000;
      posts = posts.filter(post => parseHiveDate(post.created).getTime() > cutoff);
      break;
    }
    case "high-payout":
      posts = posts.filter(post => parseFloat(post.pending_payout_value || 0) > 100);
      break;
    case "flagged":
      posts = posts.filter(post => Object.hasOwn(flaggedPosts, post.id));
      break;
    case "deleted":
      posts = posts.filter(post => post.deleted === true);
      break;
  }

  if (!searchTerm) return posts;
  const contains = value => String(value ?? "").toLowerCase().includes(searchTerm);

  return posts.filter(post => {
    switch (searchField) {
      case "author": return contains(post.author);
      case "title": return contains(post.title);
      case "content": return contains(post.body);
      case "tags": return contains(normalizeTags(post.tags));
      case "app": return contains(extractPostApp(post));
      default:
        return contains(post.author) || contains(post.title) || contains(post.body) ||
          contains(normalizeTags(post.tags)) || contains(extractPostApp(post));
    }
  });
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
    container.innerHTML = '<div class="no-posts">No flagged posts</div>';
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
        <strong>Author:</strong> ${accountLinkHtml(author)}
        <span class="badge"><strong>posts:</strong> ${stats.postCount} </span>
      </p>
      <p><strong>Flagged by:</strong> ${escapeHTML(String(flagInfo.flaggedBy || "unknown"))}</p>
      <p><strong>Data:</strong> ${formatDate(flagInfo.timestamp)}</p>
      ${flagInfo.reason ? `<p><strong>Reason:</strong> ${escapeHTML(String(flagInfo.reason))}</p>` : ""}
      <button class="btn-primary clear-flag-btn" data-id="${escapeHTML(String(post.id ?? ""))}">
        <i class="fas fa-check"></i> Clear Flag
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
    prevBtn.textContent = "Previous";
    prevBtn.disabled = flaggedCurrentPage === 1;
    prevBtn.addEventListener("click", () => {
      setFlaggedCurrentPage(flaggedCurrentPage - 1);
      loadFlaggedPosts();
    });

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Next";
    nextBtn.disabled = flaggedCurrentPage === totalPages;
    nextBtn.addEventListener("click", () => {
      setFlaggedCurrentPage(flaggedCurrentPage + 1);
      loadFlaggedPosts();
    });

    const pageInfo = document.createElement("span");
    pageInfo.textContent = `Page ${flaggedCurrentPage} of ${totalPages}`;

    paginationContainer.appendChild(prevBtn);
    paginationContainer.appendChild(pageInfo);
    paginationContainer.appendChild(nextBtn);
  }

  renderPagination(paginationTop);
  renderPagination(paginationBottom);
}

// Mova performAdvancedSearch e displaySearchResults para cá
export function performAdvancedSearch() {
  const author = document.getElementById("searchAuthor").value.toLowerCase().trim();
  const title = document.getElementById("searchTitle").value.toLowerCase().trim();
  const tags = document.getElementById("searchTags").value.toLowerCase().trim();
  const appInput = document.getElementById("searchApp");
  const app = appInput ? appInput.value.toLowerCase().trim() : "";
  const content = document.getElementById("searchContent").value.toLowerCase().trim();
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

  if (app) {
    results = results.filter((post) => {
      const rawApp = extractPostApp(post);
      const normApp = normalizeAppName(rawApp);
      return normApp.includes(app) || rawApp.toLowerCase().includes(app);
    });
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
    results = results.filter((post) => parseHiveDate(post.created) >= fromDate);
  }

  if (dateTo) {
    const toDate = new Date(dateTo);
    results = results.filter((post) => parseHiveDate(post.created) <= toDate);
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
      '<div class="no-results">No results found</div>';
    return;
  }

  const summary = document.createElement("div");
  summary.className = "search-summary";
  summary.innerHTML = `<h4>${results.length} results found</h4>`;
  container.appendChild(summary);

  results.slice(0, 50).forEach((post) => {
    // ... lógica de display de resultado ...
    const div = document.createElement("div");
    div.className = "search-result-item";
    div.innerHTML = `
            <h5>${escapeHTML(post.title) || "Untitled"}</h5>
            <p><strong>Author:</strong> ${accountLinkHtml(post.author)}</p>
            <p><strong>Payout:</strong> $${parseFloat(post.pending_payout_value || 0).toFixed(2)}</p>
            <p><strong>Data:</strong> ${formatDate(post.created)}</p>
            <p><strong>Tags:</strong> ${escapeHTML(Array.isArray(post.tags) ? post.tags.join(", ") : String(post.tags || "None"))}</p>
            <p class="excerpt">${escapeHTML(post.body) ? escapeHTML(post.body).substring(0, 200) + "..." : ""}</p>
            <button class="btn-primary view-result-btn" data-id="${escapeHTML(String(post.id ?? ""))}">
                <i class="fas fa-eye"></i> View Details
            </button>
        `;

    div
      .querySelector(".view-result-btn")
      .addEventListener("click", () => showPostDetail(post));
    container.appendChild(div);
  });
}
