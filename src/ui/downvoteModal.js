// src/ui/downvoteModal.js

import { currentUser } from '../config.js';
import { isKeychainInstalled, broadcastDownvote } from '../blockchain/hiveKeychain.js';
import { showNotification } from './notifications.js';
import { escapeHTML } from '../utils/helpers.js';

let activeDownvotePost = null;

/**
 * Inicializa os ouvintes de evento do modal de Downvote
 */
export function initDownvoteModal() {
  const modal = document.getElementById('downvoteModal');
  if (!modal) return;

  const slider = document.getElementById('downvoteWeightSlider');
  const weightDisplay = document.getElementById('downvoteWeightDisplay');
  const submitBtn = document.getElementById('submitDownvoteBroadcast');

  // Ajuste do slider de porcentagem (-1% a -100%)
  if (slider && weightDisplay) {
    slider.addEventListener('input', () => {
      const val = parseInt(slider.value, 10);
      weightDisplay.textContent = `-${Math.abs(val)}%`;
    });
  }

  // Botões de atalho rápido (-100%, -50%, -25%, -10%, -5%)
  modal.querySelectorAll('.btn-weight-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = parseInt(btn.getAttribute('data-weight'), 10);
      if (slider && weightDisplay) {
        slider.value = Math.abs(preset);
        weightDisplay.textContent = `-${Math.abs(preset)}%`;
      }
    });
  });

  // Confirmação do Downvote
  if (submitBtn) {
    submitBtn.addEventListener('click', handleDownvoteSubmit);
  }

  // Fechamento do modal
  modal.querySelectorAll('.close-modal, .btn-close-downvote').forEach((btn) => {
    btn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });
}

/**
 * Abre o modal de Downvote para um post específico
 * @param {Object} post
 */
export function openDownvoteModal(post) {
  if (!post) return;
  activeDownvotePost = post;

  const modal = document.getElementById('downvoteModal');
  if (!modal) return;

  const titleEl = document.getElementById('downvotePostTitle');
  const authorEl = document.getElementById('downvotePostAuthor');
  const payoutEl = document.getElementById('downvotePostPayout');
  const slider = document.getElementById('downvoteWeightSlider');
  const weightDisplay = document.getElementById('downvoteWeightDisplay');
  const authWarning = document.getElementById('downvoteAuthWarning');

  if (titleEl) {
    titleEl.textContent = post.title || post.id || 'Sem título';
  }

  if (authorEl) {
    authorEl.textContent = `@${post.author}`;
  }

  if (payoutEl) {
    const payout = parseFloat(post.pending_payout_value || 0).toFixed(2);
    payoutEl.textContent = `$${payout}`;
  }

  // Redefine peso padrão para -100%
  if (slider && weightDisplay) {
    slider.value = 100;
    weightDisplay.textContent = '-100%';
  }

  // Alerta de autenticação
  if (authWarning) {
    if (!currentUser) {
      authWarning.innerHTML = `
        <div class="alert-box alert-warning">
          <i class="fas fa-exclamation-triangle"></i>
          <div>
            <strong>Não conectado:</strong> Faça login com sua conta Hive via Keychain para transmitir este downvote.
          </div>
        </div>
      `;
      authWarning.classList.remove('hidden');
    } else if (!isKeychainInstalled()) {
      authWarning.innerHTML = `
        <div class="alert-box alert-warning">
          <i class="fas fa-plug"></i>
          <div>
            <strong>Hive Keychain não detectado:</strong> Abra o app em nova aba para liberar acesso da extensão.
          </div>
        </div>
      `;
      authWarning.classList.remove('hidden');
    } else {
      authWarning.innerHTML = `
        <div class="alert-box alert-info">
          <i class="fas fa-user-shield"></i>
          <div>
            Votando como <strong>@${currentUser.username}</strong> com Hive Keychain (Posting Key).
          </div>
        </div>
      `;
      authWarning.classList.remove('hidden');
    }
  }

  modal.classList.remove('hidden');
}

/**
 * Trata o envio do Downvote
 */
async function handleDownvoteSubmit() {
  if (!activeDownvotePost) return;

  const submitBtn = document.getElementById('submitDownvoteBroadcast');
  const slider = document.getElementById('downvoteWeightSlider');
  const percent = parseInt(slider?.value || 100, 10);
  // Converte porcentagem para basis points (-100% = -10000)
  const weight = -Math.round(percent * 100);

  if (!currentUser) {
    showNotification('Você precisa estar logado com Hive Keychain para dar downvote.', 'error');
    document.getElementById('loginModal')?.classList.remove('hidden');
    return;
  }

  if (!isKeychainInstalled()) {
    showNotification('Hive Keychain não encontrado no navegador.', 'warning');
    return;
  }

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Solicitando no Keychain...';
    }

    await broadcastDownvote({
      author: activeDownvotePost.author,
      permlink: activeDownvotePost.permlink,
      weight: weight,
    });

    showNotification(
      `Downvote de -${percent}% transmitido com sucesso na blockchain para @${activeDownvotePost.author}!`,
      'success'
    );

    // Marca visualmente o post como downvotado no card
    const postCards = document.querySelectorAll(`[data-post-id="${activeDownvotePost.id}"]`);
    postCards.forEach((card) => {
      card.classList.add('post-downvoted');
      const downvoteBtn = card.querySelector('.downvote-post-btn');
      if (downvoteBtn) {
        downvoteBtn.classList.add('active-downvote');
        downvoteBtn.title = `Downvotado (-${percent}%)`;
      }
    });

    const modal = document.getElementById('downvoteModal');
    if (modal) modal.classList.add('hidden');
  } catch (err) {
    console.error('Erro ao dar downvote:', err);
    showNotification(`Falha no downvote: ${err.message || err}`, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-arrow-down"></i> Confirmar Downvote via Keychain';
    }
  }
}
