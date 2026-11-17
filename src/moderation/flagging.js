// src/moderation/flagging.js

import { flaggedPosts, allPosts, moderationSettings, currentUser } from '../config.js';
import { updateFlaggedCount, updatePostsDisplay } from '../ui/domHelpers.js';
import { showNotification } from '../ui/notifications.js';

// Mova toggleFlagPost para cá
export function toggleFlagPost(postId, refresh = false) {
  if (Object.hasOwn(flaggedPosts, postId)) {
    delete flaggedPosts[postId];
    showNotification("Flag removed from post", "info");
  } else {
    flaggedPosts[postId] = {
      timestamp: new Date().toISOString(),
      flaggedBy: currentUser?.username || "system",
      reason: "Manual moderation",
    };
    showNotification("Post flagged for review", "warning");

    const post = allPosts.find((p) => p.id == postId);
    if (post && moderationSettings?.notifyHighPayout) {
      const payout = parseFloat(post.pending_payout_value || 0);
      if (payout > moderationSettings?.payoutAlertThreshold) {
        showNotification(
          `⚠️ High-payout post ($${payout.toFixed(2)}) flagged!`,
          "warning"
        );
      }
    }
  }

  localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
  updateFlaggedCount();

  if (refresh) {
    updatePostsDisplay();
  } else if (document.querySelector('.filter-btn.active[data-filter="flagged"]')) {
    updatePostsDisplay();
  } else {
    const isFlagged = Object.hasOwn(flaggedPosts, postId);
    const buttons = document.querySelectorAll(`.flag-post[data-id="${CSS.escape(String(postId))}"]`);
    buttons.forEach(button => {
      button.classList.toggle("flagged", isFlagged);
      button.querySelector(".flag-action-label").textContent = isFlagged ? "Remove flag" : "Flag";
    });
  }
}
