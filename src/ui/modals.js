// src/ui/modals.js

import { moderationSettings, flaggedPosts, allPosts } from '../config.js';
import { saveSettings } from '../core/settings.js';
import { muteUser, unmuteUser, isUserMuted } from '../moderation/muting.js';
import { toggleFlagPost } from '../moderation/flagging.js';
import { loadFlaggedPosts, searchPosts } from '../moderation/filtering.js';
import { updateFlaggedCount, updatePostsDisplay, refreshPostsDisplay, selectDomainFilter } from './domHelpers.js';
import { formatDate, escapeHTML, copyTextToClipboard } from '../utils/helpers.js';
import { extractPostUrls, extractPostDomains } from '../utils/linkExtractor.js';
import { showNotification } from './notifications.js';
import { openOnchainBlacklistModal } from './onchainBlacklistModal.js';
import { renderAuthorReputationHtml, handleManualReputationRefresh } from '../api/reputationService.js';
import { openDownvoteModal } from './downvoteModal.js';
import { createSafeImagePreviewHtml } from '../utils/imageProxy.js';
import { isAccountOnchainBlacklisted } from '../api/onchainBlacklistService.js';

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

  const authorRepHtml = renderAuthorReputationHtml(post.author, post.author_reputation);
  const previewImgHtml = createSafeImagePreviewHtml(post, { width: 640, height: 0, className: 'detail-preview-image' });
  const isBlacklisted = isAccountOnchainBlacklisted(post.author);
  const blacklistFlairHtml = isBlacklisted
    ? `<span class="badge-blacklisted-flair" title="Autor na Blacklist On-Chain da Hive (bridge.get_follow_list)"><i class="fas fa-ban"></i> BLACKLISTED</span>`
    : '';

  const postUrls = extractPostUrls(post);
  const postDomains = extractPostDomains(post, false);

  body.innerHTML = `
        ${previewImgHtml ? `<div class="detail-image-banner" style="margin-bottom: 1rem;">${previewImgHtml}</div>` : ''}
        ${isBlacklisted ? `
          <div class="blacklist-detail-alert">
            <i class="fas fa-exclamation-triangle"></i>
            <span><strong>Atenção:</strong> Este autor (@${escapeHTML(post.author)}) está listado na <strong>Blacklist On-Chain</strong> da Hive Blockchain.</span>
          </div>
        ` : ''}
        <div class="post-detail-header">
            <div class="detail-item" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <strong>Autor:</strong> @${escapeHTML(post.author)} ${authorRepHtml} ${blacklistFlairHtml}
            </div>
            <div class="detail-item">
                <strong>Payout Pendente:</strong> $${parseFloat(post.pending_payout_value || 0).toFixed(2)}
            </div>
            <div class="detail-item">
                <strong>Data:</strong> ${new Date(post.created).toLocaleString("pt-BR")}
            </div>
            <div class="detail-item">
                <strong>Categoria:</strong> ${escapeHTML(post.category || "N/A")}
            </div>
        </div>
        
        <div class="post-detail-tags">
            <strong>Tags:</strong> ${escapeHTML(post.tags || "Nenhuma")}
        </div>
        
        <div class="post-detail-content">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <h4 style="margin: 0;"><i class="fas fa-file-alt"></i> Conteúdo (Body):</h4>
                <button type="button" class="btn-copy-body-detail" id="btnCopyDetailBody" title="Copiar apenas o texto do body">
                    <i class="fas fa-copy"></i> Copiar Body
                </button>
            </div>
            <div class="content-box">${formattedContent}</div>
        </div>

        ${postDomains.length > 0 ? `
          <div class="post-detail-domains-box" style="margin-top: 1rem; padding: 0.8rem 1rem; background: var(--bg-hover, #f8fafc); border-radius: 8px; border: 1px solid var(--border-color, #e2e8f0);">
            <div style="font-size: 0.88rem; font-weight: 600; color: #334155; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                <i class="fas fa-link" style="color: #0284c7;"></i> Links & Domínios Detectados neste Post (${postUrls.length} links / ${postDomains.length} domínios):
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                ${postDomains.map(d => `<button type="button" class="badge-domain-clickable" data-domain="${escapeHTML(d)}" title="Filtrar posts pelo domínio ${escapeHTML(d)}"><i class="fas fa-filter"></i> ${escapeHTML(d)}</button>`).join('')}
            </div>
          </div>
        ` : ''}
        
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
                <strong>Author Rewards:</strong> ${escapeHTML(String(post.author_rewards || "0"))} HIVE
            </div>
        </div>
        
        <div class="post-detail-actions">
            <button class="btn-primary toggle-flag-btn" data-id="${post.id}">
                ${flaggedPosts[post.id] ? "Remover Flag" : "Sinalizar Post"}
            </button>
            <button class="btn-action downvote-detail-btn" style="background-color: #ef4444; color: white;">
                <i class="fas fa-arrow-down"></i> Downvote (Keychain)
            </button>
            <button class="btn-action blacklist-onchain-detail-btn" style="background-color: #8b5cf6; color: white;">
                <i class="fas fa-shield-virus"></i> Blacklist On-Chain
            </button>
            <button class="btn-action view-author-btn" data-author="${post.author}">
                Ver Posts do Autor
            </button>
            <button class="btn-danger delete-post-btn" data-id="${post.id}">
                Marcar como Deletado
            </button>
        </div>
    `;

    const copyDetailBtn = body.querySelector("#btnCopyDetailBody");
    if (copyDetailBtn) {
      copyDetailBtn.addEventListener("click", async () => {
        const success = await copyTextToClipboard(post.body || "");
        const icon = copyDetailBtn.querySelector("i");
        if (icon) {
          icon.className = "fas fa-check";
          icon.style.color = "#10b981";
          setTimeout(() => {
            icon.className = "fas fa-copy";
            icon.style.color = "";
          }, 2000);
        }
        if (success) {
          showNotification("Conteúdo (body) copiado para a área de transferência!", "success");
        } else {
          showNotification("Não foi possível copiar o conteúdo automaticamente", "error");
        }
      });
    }

    body.querySelectorAll(".badge-domain-clickable").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dom = btn.getAttribute("data-domain");
        closeModal("postDetailModal");
        if (dom) {
          selectDomainFilter(dom);
        }
      });
    });

    const refreshRepBtn = body.querySelector(".btn-refresh-rep");
    if (refreshRepBtn) {
      refreshRepBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleManualReputationRefresh(post.author, refreshRepBtn);
      });
    }

    const downvoteBtn = body.querySelector(".downvote-detail-btn");
    if (downvoteBtn) {
      downvoteBtn.addEventListener("click", () => {
        closeModal("postDetailModal");
        openDownvoteModal(post);
      });
    }

    body.querySelector(".toggle-flag-btn").addEventListener("click", function () {
        toggleFlagPost(post.id);
        closeModal("postDetailModal");
    });

    body.querySelector(".blacklist-onchain-detail-btn").addEventListener("click", function () {
        closeModal("postDetailModal");
        openOnchainBlacklistModal(post.author, {
            reason: "Moderação de Post",
            notes: `Post: "${post.title || post.id}"`
        });
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
  openOnchainBlacklistModal(author, {
    reason: "Moderação Direta",
    notes: `Moderação iniciada para @${author}`
  });
}

export function openModerationPanel(post) {
  showPostDetail(post);
}

export function deletePost(postId) {
  showNotification("Funcionalidade de deleção seria implementada aqui", "info");
  // Em produção: enviar para API marcar como deletado
}