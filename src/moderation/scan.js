// src/moderation/scan.js

import { allPosts, flaggedPosts, moderationSettings, currentUser } from '../config.js';
import { showNotification } from '../ui/notifications.js';
import { updateFlaggedCount, updatePostsDisplay } from '../ui/domHelpers.js';
import { escapeHTML } from '../utils/helpers.js';

// Mova scanForSpam para cá
export function scanForSpam() {
  showNotification("Scanning for spam...", "info");

  setTimeout(() => {
    // ... corpo da função scanForSpam ...
    const postsByAuthor = {};
    const shortPostsByAuthor = {};

    allPosts.forEach((post) => {
      const author = post.author || "unknown";

      if (!postsByAuthor[author]) postsByAuthor[author] = 0;
      if (!shortPostsByAuthor[author]) shortPostsByAuthor[author] = 0;

      postsByAuthor[author]++;

      const cleanBody = escapeHTML(post.body) || "";
      if (cleanBody.length < 15) {
        shortPostsByAuthor[author]++;
      }
    });

    const potentialSpam = allPosts.filter((post) => {
      const body = (escapeHTML(post.body) || "").toLowerCase();
      const title = (escapeHTML(post.title) || "").toLowerCase();
      const author = post.author || "unknown";

      const spamPatterns = [
        "vote for delegating HP",
        "additional vote",
        "steemit.com",
        "blurt.blog",
        "blurt.world",
        "Delagate HP",
      ];

      const hasSpamPatterns = spamPatterns.some(
        (pattern) => body.includes(pattern) || title.includes(pattern)
      );

      const authorHasTooManyPosts = postsByAuthor[author] > 50;
      const authorPostsManyShorts = shortPostsByAuthor[author] > 20;

      return hasSpamPatterns || authorHasTooManyPosts || authorPostsManyShorts;
    });

    if (potentialSpam.length > 0) {
      const count = potentialSpam.length;
      showNotification(
        `Found ${count} posts suspected of spam`,
        "warning"
      );

      if (moderationSettings?.autoFlagSpam) {
        // ... auto-flag logic ...
        potentialSpam.forEach((post) => {
          if (!flaggedPosts[post.id]) {
            flaggedPosts[post.id] = {
              timestamp: new Date().toISOString(),
              flaggedBy: currentUser?.username || "spam-scanner",
              reason: "Potential spam",
            };
          }
        });

        localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
        updateFlaggedCount();
        updatePostsDisplay();
        showNotification(
          `${count} posts automatically flagged as spam`,
          "info"
        );
      } else {
        if (confirm(`Flag ${count} posts as spam?`)) {
          // ... manual flag logic ...
          potentialSpam.forEach((post) => {
            if (!flaggedPosts[post.id]) {
              flaggedPosts[post.id] = {
                timestamp: new Date().toISOString(),
                flaggedBy: currentUser?.username || "spam-scanner",
                reason: "Potential spam",
              };
            }
          });

          localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
          updateFlaggedCount();
          updatePostsDisplay();
        }
      }
    } else {
      showNotification("No spam detected", "success");
    }
  }, 2000);
}

// Mova scanForPlagiarism e as funções de detecção (keywordDetector, etc.) para cá
export function scanForPlagiarism() {
  showNotification("Checking for plagiarism...", "info");

  setTimeout(() => {
    // ... corpo da função scanForPlagiarism ...
    const contentMap = {};
    const potentialPlagiarism = [];

    allPosts.forEach((post) => {
      if (!post.body || post.body.length < 50) return;

      const key = escapeHTML(post.body).substring(0, 100).toLowerCase();
      if (contentMap[key]) {
        potentialPlagiarism.push(post);
      } else {
        contentMap[key] = true;
      }
    });

    if (potentialPlagiarism.length > 0) {
      const count = potentialPlagiarism.length;
      showNotification(
        `Found ${count} posts with similar content`,
        "warning"
      );

      if (moderationSettings?.autoFlagPlagiarism) {
        // ... auto-flag logic ...
        potentialPlagiarism.forEach((post) => {
          if (!flaggedPosts[post.id]) {
            flaggedPosts[post.id] = {
              timestamp: new Date().toISOString(),
              flaggedBy: currentUser?.username || "plagiarism-scanner",
              reason: "Possible plagiarism",
            };
          }
        });
        localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
        updateFlaggedCount();
        updatePostsDisplay();
        showNotification(
          `${count} posts automatically flagged for possible plagiarism`,
          "info"
        );
      } else {
        if (confirm(`Flag ${count} posts for possible plagiarism?`)) {
          // ... manual flag logic ...
          potentialPlagiarism.forEach((post) => {
            if (!flaggedPosts[post.id]) {
              flaggedPosts[post.id] = {
                timestamp: new Date().toISOString(),
                flaggedBy: currentUser?.username || "plagiarism-scanner",
                reason: "Possible plagiarism",
              };
            }
          });
          localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
          updateFlaggedCount();
          updatePostsDisplay();
        }
      }
    } else {
      showNotification("No plagiarism detected", "success");
    }
  }, 3000);
}

// Mantenha as funções de detecção auxiliares aqui
export function keywordDetector(post, keywords = [], minMatches = 1) {
  // ...
}

export function linkDetector(
  post,
  maxLinks = 2,
  blacklistDomains = ["bit.ly", "tinyurl.com", "spamdomain.com"]
) {
  // ...
}

const STOPWORDS = new Set([
  "the", "and", "a", "to", "of", "in", "is", "that", "it", "on", "for" /*...*/,
]);

export function aiHeuristicDetector(post) {
  // ...
}

export async function scanPostAdvanced(post) {
  // ...
}