// src/moderation/muting.js

import { moderationSettings } from '../config.js';
import { saveSettings, saveMutedUsers } from '../core/settings.js';
import { showNotification } from '../ui/notifications.js';
import { refreshPostsDisplay } from '../ui/domHelpers.js';

// Mova muteUser para cá
export function muteUser(username) {
  if (!moderationSettings.mutedUsers.includes(username)) {
    moderationSettings.mutedUsers.push(username);
    saveSettings();
    showNotification(`Usuário ${username} mutado com sucesso!`, "warning");
    refreshPostsDisplay();
  }
}

// Mova unmuteUser para cá
export function unmuteUser(username) {
  const index = moderationSettings.mutedUsers.indexOf(username);
  if (index !== -1) {
    moderationSettings.mutedUsers.splice(index, 1);
    saveSettings();
    showNotification(`Usuário ${username} desmutado!`, "info");
    refreshPostsDisplay();
  }
}

// Mova isUserMuted para cá
export function isUserMuted(username) {
  return (
    Array.isArray(moderationSettings.mutedUsers) &&
    moderationSettings.mutedUsers.includes(username)
  );
}