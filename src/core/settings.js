// src/core/settings.js

import { moderationSettings, setModerationSettings, postsPerPage, setPostsPerPage } from '../config.js';
import { refreshPostsDisplay } from '../ui/domHelpers.js';
import { showNotification } from '../ui/notifications.js';

// Mova loadSettings para cá
export function loadSettings() {
  const savedSettings = JSON.parse(
    localStorage.getItem("moderationSettings") || "{}"
  );

  const newSettings = {
    autoFlagSpam: true,
    autoFlagPlagiarism: true,
    notifyHighPayout: true,
    payoutAlertThreshold: 100,
    theme: "light",
    postsPerPage: 25,
    mutedUsers: JSON.parse(localStorage.getItem("mutedUsers") || "[]"),
    ...savedSettings,
  };

  if (!Array.isArray(newSettings.mutedUsers)) {
    newSettings.mutedUsers = [];
  }

  setModerationSettings(newSettings);
  return moderationSettings;
}

// Mova saveSettings para cá
export function saveSettings() {
  localStorage.setItem(
    "moderationSettings",
    JSON.stringify({
      ...moderationSettings,
      mutedUsers: moderationSettings.mutedUsers,
    })
  );
  showNotification("Configurações salvas com sucesso!", "success");
  applySettings();
}

// Mova saveMutedUsers para cá (usado em muting.js)
export function saveMutedUsers() {
  localStorage.setItem(
    "mutedUsers",
    JSON.stringify(moderationSettings.mutedUsers)
  );
}

// Mova applySettings para cá
export function applySettings() {
  document.body.classList.remove("theme-light", "theme-dark");
  if (moderationSettings?.theme === "dark") {
    document.body.classList.add("theme-dark");
  } else {
    document.body.classList.add("theme-light");
  }

  setPostsPerPage(moderationSettings?.postsPerPage);
  const postsPerPageSelect = document.getElementById("postsPerPage");
  if (postsPerPageSelect) {
    postsPerPageSelect.value = postsPerPage.toString();
  }

  const postsPerPageSetting = document.getElementById("postsPerPageSetting");
  if (postsPerPageSetting) {
    postsPerPageSetting.value = postsPerPage.toString();
  }
}