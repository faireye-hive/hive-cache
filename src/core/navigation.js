// src/core/navigation.js

import { loadRankingByPosts, loadRankingByPayout, loadStatistics } from '../utils/statsCalculators.js';
import { loadFlaggedPosts } from '../moderation/filtering.js';
import { renderBlacklistRanking } from '../moderation/blacklistRanking.js';

// Mova initNavigation para cá
export function initNavigation() {
  const navItems = document.querySelectorAll(".nav-menu li");
  const sections = document.querySelectorAll(".content-section");

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      navItems.forEach((nav) => nav.classList.remove("active"));
      sections.forEach((section) => section.classList.remove("active"));

      item.classList.add("active");

      const sectionId = item.getAttribute("data-section");
      document.getElementById(`${sectionId}-section`).classList.add("active");

      switch (sectionId) {
        case "ranking-posts":
          loadRankingByPosts();
          break;
        case "ranking-payout":
          loadRankingByPayout();
          break;
        case "moderation":
          renderBlacklistRanking();
          break;
        case "flagged":
          loadFlaggedPosts();
          break;
        case "stats":
          loadStatistics();
          break;
      }
    });
  });
}
