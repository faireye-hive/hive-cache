// src/moderation/flagging.js

import { flaggedPosts, allPosts, moderationSettings, currentUser } from '../config.js';
import { updateFlaggedCount, updatePostsDisplay } from '../ui/domHelpers.js';
import { showNotification } from '../ui/notifications.js';
import { loadModerationPanel } from './filtering.js';

// Mova toggleFlagPost para cá
export function toggleFlagPost(postId, refresh = false) {
  if (flaggedPosts[postId]) {
    delete flaggedPosts[postId];
    showNotification("Flag removida do post", "info");
  } else {
    flaggedPosts[postId] = {
      timestamp: new Date().toISOString(),
      flaggedBy: currentUser?.username || "system",
      reason: "Moderação manual",
    };
    showNotification("Post sinalizado para revisão", "warning");

    const post = allPosts.find((p) => p.id == postId);
    if (post && moderationSettings?.notifyHighPayout) {
      const payout = parseFloat(post.pending_payout_value || 0);
      if (payout > moderationSettings?.payoutAlertThreshold) {
        showNotification(
          `⚠️ Post com alto payout ($${payout.toFixed(2)}) sinalizado!`,
          "warning"
        );
      }
    }
  }

  localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
  updateFlaggedCount();

  if (refresh) {
    loadModerationPanel();
    updatePostsDisplay();
  } else {
    // Atualizar apenas o botão específico
    const flagBtn = document.querySelector(`.flag-post[data-id="${postId}"]`);
    if (flagBtn) {
      flagBtn.classList.toggle("flagged");
      flagBtn.title = flaggedPosts[postId] ? "Remover flag" : "Sinalizar";
    }
  }
}