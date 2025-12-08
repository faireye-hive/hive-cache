// src/ui/modals.js

import { moderationSettings, flaggedPosts, allPosts } from '../config.js';
import { saveSettings } from '../core/settings.js';
import { muteUser, unmuteUser, isUserMuted } from '../moderation/muting.js';
import { toggleFlagPost } from '../moderation/flagging.js';
import { loadFlaggedPosts, searchPosts } from '../moderation/filtering.js';
import { updateFlaggedCount, updatePostsDisplay, refreshPostsDisplay } from './domHelpers.js';
import { formatDate, escapeHTML } from '../utils/helpers.js';
import { showNotification } from './notifications.js';

// closeModal
export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("hidden");
  }
}

// openSettingsModal
export function openSettingsModal() {
  const modal = document.getElementById("settingsModal");
  if (!modal) return;

  document.getElementById("autoFlagSpam").checked =
    !!moderationSettings?.autoFlagSpam;

  document.getElementById("autoFlagPlagiarism").checked =
    !!moderationSettings?.autoFlagPlagiarism;

  document.getElementById("notifyHighPayout").checked =
    !!moderationSettings?.notifyHighPayout;

  document.getElementById("payoutAlertThreshold").value =
    moderationSettings?.payoutAlertThreshold ?? "";

  document.getElementById("themeSelect").value =
    moderationSettings?.theme ?? "light";

  document.getElementById("postsPerPageSetting").value =
    moderationSettings?.postsPerPage ?? 25;

  modal.classList.remove("hidden");
}

// Mova showPostDetail para cá
export function showPostDetail(post) {
  const modal = document.getElementById("postDetailModal");
  const title = document.getElementById("postDetailTitle");
  const body = document.getElementById("postDetailBody");

  // ... corpo da função showPostDetail ...
  title.textContent = escapeHTML(post.title) || "Detalhes do Post";

  const formattedContent = (escapeHTML(post.body) || "Sem conteúdo")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  body.innerHTML = `
        <div class="post-detail-header">
            <div class="detail-item">
                <strong>Autor:</strong> ${post.author}
            </div>
            <div class="detail-item">
                <strong>Payout Pendente:</strong> $${parseFloat(post.pending_payout_value || 0).toFixed(2)}
            </div>
            <div class="detail-item">
                <strong>Data:</strong> ${new Date(post.created).toLocaleString("pt-BR")}
            </div>
            <div class="detail-item">
                <strong>Categoria:</strong> ${post.category || "N/A"}
            </div>
        </div>
        
        <div class="post-detail-tags">
            <strong>Tags:</strong> ${post.tags || "Nenhuma"}
        </div>
        
        <div class="post-detail-content">
            <h4>Conteúdo:</h4>
            <div class="content-box">${formattedContent}</div>
        </div>
        
        <div class="post-detail-stats">
            <div class="stat-item">
                <strong>Total Payout:</strong> $${parseFloat(post.total_payout_value || 0).toFixed(2)}
            </div>
            <div class="stat-item">
                <strong>Curator Payout:</strong> $${parseFloat(post.curator_payout_value || 0).toFixed(2)}
            </div>
            <div class="stat-item">
                <strong>Beneficiary Payout:</strong> $${parseFloat(post.beneficiary_payout_value || 0).toFixed(2)}
            </div>
            <div class="stat-item">
                <strong>Author Rewards:</strong> ${post.author_rewards || "0"} HIVE
            </div>
        </div>
        
        <div class="post-detail-actions">
            <button class="btn-primary toggle-flag-btn" data-id="${post.id}">
                ${flaggedPosts[post.id] ? "Remover Flag" : "Sinalizar Post"}
            </button>
            <button class="btn-action view-author-btn" data-author="${post.author}">
                Ver Posts do Autor
            </button>
            <button class="btn-danger delete-post-btn" data-id="${post.id}">
                Marcar como Deletado
            </button>
        </div>
    `;

    body.querySelector(".toggle-flag-btn").addEventListener("click", function () {
        toggleFlagPost(post.id);
        closeModal("postDetailModal");
    });

    body.querySelector(".view-author-btn").addEventListener("click", function () {
        viewAuthorPosts(post.author);
        closeModal("postDetailModal");
    });

    body.querySelector(".delete-post-btn").addEventListener("click", function () {
        if (confirm("Marcar como deletado?")) {
            deletePost(post.id);
            closeModal("postDetailModal");
        }
    });

    modal.classList.remove("hidden");

    modal.querySelector(".close-modal").addEventListener("click", () => {
        modal.classList.add("hidden");
    });

    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("hidden");
    });
}

// Mova openMutedUsersManager para cá
export function openMutedUsersManager() {
  const modal = document.getElementById("mutedUsersModal");
  const container = document.getElementById("mutedUsersList");

  if (!modal || !container) return;

  container.innerHTML = "";

  if (moderationSettings?.mutedUsers?.length === 0) {
    container.innerHTML =
      '<div class="no-muted-users">Nenhum usuário mutado</div>';
  } else {
    moderationSettings.mutedUsers.forEach((username) => {
      const userElement = document.createElement("div");
      userElement.className = "muted-user-item";
      userElement.innerHTML = `
        <span class="muted-username">${username}</span>
        <button class="btn-small btn-danger unmute-btn" data-username="${username}">
          <i class="fas fa-volume-up"></i> Desmutar
        </button>
      `;
      container.appendChild(userElement);
    });

    container.querySelectorAll(".unmute-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        const username = this.getAttribute("data-username");
        unmuteUser(username);
        openMutedUsersManager(); // recarrega a lista
      });
    });
  }

  modal.classList.remove("hidden");
}

// Mova initModalListeners para cá
export function initModalListeners() {
  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", openSettingsModal);
  }

  const settingsToolbarBtn = document.getElementById("settingsToolbarBtn");
  if (settingsToolbarBtn) {
    settingsToolbarBtn.addEventListener("click", openSettingsModal);
  }

  const saveSettingsBtn = document.getElementById("saveSettings");
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
      const newSettings = {
        autoFlagSpam: document.getElementById("autoFlagSpam").checked,
        autoFlagPlagiarism: document.getElementById("autoFlagPlagiarism").checked,
        notifyHighPayout: document.getElementById("notifyHighPayout").checked,
        payoutAlertThreshold: parseFloat(document.getElementById("payoutAlertThreshold").value) || 100,
        theme: document.getElementById("themeSelect").value,
        postsPerPage: parseInt(document.getElementById("postsPerPageSetting").value) || 25,
      };
      // Atualiza o objeto em memória antes de salvar
      moderationSettings.autoFlagSpam = newSettings.autoFlagSpam;
      moderationSettings.autoFlagPlagiarism = newSettings.autoFlagPlagiarism;
      moderationSettings.notifyHighPayout = newSettings.notifyHighPayout;
      moderationSettings.payoutAlertThreshold = newSettings.payoutAlertThreshold;
      moderationSettings.theme = newSettings.theme;
      moderationSettings.postsPerPage = newSettings.postsPerPage;

      saveSettings();
      closeModal("settingsModal");
    });
  }

  document.querySelectorAll(".close-modal").forEach((closeBtn) => {
    closeBtn.addEventListener("click", function () {
      const modal = this.closest(".modal");
      if (modal) {
        modal.classList.add("hidden");
      }
    });
  });

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", function (e) {
      if (e.target === this) {
        this.classList.add("hidden");
      }
    });
  });
}

// Funções adicionais que interagem com o modal (mantidas no módulo)
export function viewAuthorPosts(author) {
  document.getElementById("searchInput").value = author;
  document.getElementById("searchFilter").value = "author";
  searchPosts(); // Note que searchPosts precisa ser importada ou definida
  document.querySelector('[data-section="posts"]').click();
}

export function moderateAuthor(author) {
  showNotification(`Moderação para autor: ${author}`, "info");
  viewAuthorPosts(author);
}

export function openModerationPanel(post) {
  showPostDetail(post);
}

export function deletePost(postId) {
  showNotification("Funcionalidade de deleção seria implementada aqui", "info");
  // Em produção: enviar para API marcar como deletado
}