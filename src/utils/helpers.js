// src/utils/helpers.js

import { allPosts, flaggedPosts } from '../config.js';

// Mova a função escapeHTML para cá
export function escapeHTML(body) {
  if (!body || typeof body !== "string") return "";
  const sanitized = DOMPurify.sanitize(body, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
  return sanitized;
}

// Mova a função formatDate para cá
export function formatDate(dateString) {
  if (!dateString) return "N/A";
  try {
    const date = new Date(dateString);
    // ... corpo da função formatDate ...
    if (isNaN(date.getTime())) return "Data inválida";

    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
      return `Há ${diffMins} min${diffMins !== 1 ? "s" : ""}`;
    } else if (diffHours < 24) {
      return `Há ${diffHours} h${diffHours !== 1 ? "s" : ""}`;
    } else if (diffDays < 7) {
      return `Há ${diffDays} dia${diffDays !== 1 ? "s" : ""}`;
    } else {
      return date.toLocaleDateString("pt-BR");
    }
  } catch (e) {
    return "Data inválida";
  }
}

// Mova a função debounce para cá
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Mova a função calculateRiskLevel para cá
export function calculateRiskLevel(post) {
  let riskScore = 0;
  // ... corpo da função calculateRiskLevel ...

  const commandRegex =
    /\!(bbh|lady|vote|gif|pizza|beer|pepe|meme|cpt|summarize)\b/i;

  if (commandRegex.test(post.body || "")) {
    riskScore += 2;
  }

  // Payout alto
  const payout = parseFloat(post.pending_payout_value || 0);
  if (payout > 500) riskScore += 3;
  else if (payout > 100) riskScore += 1;

  // Conteúdo curto
  const authorPosts = allPosts.filter((p) => p.author === post.author);
  if (authorPosts.length > 15) {
    if ((escapeHTML(post.body) || "").length < 50) riskScore += 2;
  }

  if (authorPosts.length > 100) riskScore += 4;

  if (authorPosts.length > 200) riskScore += 4;

  // Tags suspeitas
  const suspiciousTags = [
    "make-money",
    "earn-fast",
    "crypto-scam",
    "get-rich",
    "instant-cash",
  ];
  if (post.tags) {
    const tagsString = Array.isArray(post.tags)
      ? post.tags.join(" ").toLowerCase()
      : String(post.tags).toLowerCase();

    if (suspiciousTags.some((tag) => tagsString.includes(tag))) {
      riskScore += 3;
    }
  }

  // Já sinalizado
  if (flaggedPosts[post.id]) riskScore += 4;

  // Categoria suspeita
  if (
    post.category &&
    ["nsfw", "adult", "gambling"].includes(post.category.toLowerCase())
  ) {
    riskScore += 2;
  }

  if (riskScore >= 7) return "high";
  if (riskScore >= 4) return "medium";
  return "low";
}

export function normalizeTags(tags) {
  if (!tags) return "";
  if (Array.isArray(tags)) return tags.join(" ").toLowerCase();
  if (typeof tags === "string") return tags.toLowerCase();
  return "";
}