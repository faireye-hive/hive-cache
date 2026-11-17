// src/core/auth.js

import { currentUser, setCurrentUser } from '../config.js';
import { showNotification } from '../ui/notifications.js';
import { loginWithHiveKeychain, isKeychainInstalled, waitForKeychain } from '../blockchain/hiveKeychain.js';
import { openOnchainBlacklistModal } from '../ui/onchainBlacklistModal.js';
import { getProxiedImageUrl } from '../utils/imageProxy.js';

export function initLoginSystem() {
  const loginModal = document.getElementById("loginModal");
  const keychainUsernameInput = document.getElementById("keychainUsername");
  const btnSubmitKeychain = document.getElementById("btnSubmitKeychain");
  const keychainStatusInfo = document.getElementById("keychainStatusInfo");
  const guestLoginBtn = document.getElementById("guestLoginBtn");
  const manualLogin = document.getElementById("manualLogin");
  const manualLoginForm = document.getElementById("manualLoginForm");
  const submitManualLogin = document.getElementById("submitManualLogin");
  const logoutBtn = document.getElementById("logoutBtn");
  const openLoginNavBtn = document.getElementById("openLoginNavBtn");
  const navBlacklistBtn = document.getElementById("navBlacklistBtn");

  // Verifica se a extensão Keychain está presente ao carregar a página
  waitForKeychain(1500).then((installed) => {
    updateKeychainStatusBanner(installed);
  });

  // Carrega usuário salvo no localStorage
  const savedUser = localStorage.getItem("currentUser");
  if (savedUser) {
    try {
      const user = JSON.parse(savedUser);
      setCurrentUser(user);
      if (loginModal) loginModal.classList.add("hidden");
      updateUserInfo();
    } catch (e) {
      localStorage.removeItem("currentUser");
    }
  }

  // Login com Hive Keychain
  if (btnSubmitKeychain) {
    btnSubmitKeychain.addEventListener("click", async () => {
      const usernameVal = keychainUsernameInput?.value?.trim();

      if (!usernameVal) {
        showNotification("Enter your Hive username to authenticate.", "warning");
        keychainUsernameInput?.focus();
        return;
      }

      const originalText = btnSubmitKeychain.innerHTML;
      btnSubmitKeychain.disabled = true;
      btnSubmitKeychain.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Requesting signature...';

      try {
        const userSession = await loginWithHiveKeychain(usernameVal);
        setCurrentUser(userSession);
        localStorage.setItem("currentUser", JSON.stringify(userSession));

        if (loginModal) loginModal.classList.add("hidden");
        updateUserInfo();
        showNotification(
          `Welcome, @${userSession.username}! Signed in successfully with Hive Keychain.`,
          "success"
        );
      } catch (error) {
        console.error("Hive Keychain sign-in error:", error);
        showNotification(`Authentication failed: ${error.message || error}`, "error");
      } finally {
        btnSubmitKeychain.disabled = false;
        btnSubmitKeychain.innerHTML = originalText;
      }
    });
  }

  // Permitir pressionar Enter no input do Keychain
  if (keychainUsernameInput) {
    keychainUsernameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        btnSubmitKeychain?.click();
      }
    });
  }

  // Modo Visitante / Convidado
  if (guestLoginBtn) {
    guestLoginBtn.addEventListener("click", () => {
      const guestUser = {
        username: "guest",
        role: "viewer",
        loginMethod: "guest",
        avatar: "https://images.hive.blog/u/hive/avatar/small",
      };
      setCurrentUser(guestUser);
      localStorage.setItem("currentUser", JSON.stringify(guestUser));
      if (loginModal) loginModal.classList.add("hidden");
      updateUserInfo();
      showNotification("Guest mode enabled (read only)", "info");
    });
  }

  // Toggle formulário manual
  if (manualLogin && manualLoginForm) {
    manualLogin.addEventListener("click", () => {
      manualLoginForm.classList.toggle("hidden");
    });
  }

  // Login manual de contingência
  if (submitManualLogin) {
    submitManualLogin.addEventListener("click", () => {
      const usernameInput = document.getElementById("username");
      const username = usernameInput ? usernameInput.value.trim().toLowerCase().replace(/^@/, '') : '';

      if (username) {
        const user = {
          username: username,
          role: "moderator",
          loginMethod: "manual",
          avatar: `https://images.hive.blog/u/${username}/avatar/small`,
        };
        setCurrentUser(user);
        localStorage.setItem("currentUser", JSON.stringify(user));
        if (loginModal) loginModal.classList.add("hidden");
        updateUserInfo();
        showNotification(`Signed in as @${username} (manual mode)`, "success");
      } else {
        showNotification("Enter your Hive username", "warning");
      }
    });
  }

  // Botão de Logout
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      setCurrentUser(null);
      localStorage.removeItem("currentUser");
      updateUserInfo();
      if (loginModal) loginModal.classList.remove("hidden");
      showNotification("Signed out successfully.", "info");
    });
  }

  // Abrir modal de login pela navbar se deslogado
  if (openLoginNavBtn) {
    openLoginNavBtn.addEventListener("click", () => {
      if (loginModal) loginModal.classList.remove("hidden");
    });
  }

  // Botão de Blacklist On-Chain na navbar
  if (navBlacklistBtn) {
    navBlacklistBtn.addEventListener("click", () => {
      openOnchainBlacklistModal();
    });
  }

  // Permitir fechar o modal de login se o usuário quiser navegar primeiro
  const closeLoginBtn = document.getElementById("closeLoginModalBtn");
  if (closeLoginBtn) {
    closeLoginBtn.addEventListener("click", () => {
      if (loginModal) loginModal.classList.add("hidden");
    });
  }
}

/**
 * Atualiza o banner indicando se a extensão Hive Keychain foi detectada
 */
function updateKeychainStatusBanner(installed) {
  const statusEl = document.getElementById("keychainStatusInfo");
  if (!statusEl) return;

  if (installed) {
    statusEl.innerHTML = `
      <div class="keychain-detected">
        <i class="fas fa-check-circle"></i>
        <span>Hive Keychain extension detected and ready to use!</span>
      </div>
    `;
  } else {
    statusEl.innerHTML = `
      <div class="keychain-not-detected">
        <i class="fas fa-info-circle"></i>
        <span>Hive Keychain extension not detected. If you are using an iframe preview, open the app in a new tab to allow access to Web3 extensions.</span>
      </div>
    `;
  }
}

/**
 * Atualiza o bloco de informações do usuário na barra de navegação superior
 */
export function updateUserInfo() {
  const currentUserSpan = document.getElementById("currentUser");
  const userAvatarImg = document.getElementById("userAvatarImg");
  const logoutBtn = document.getElementById("logoutBtn");
  const openLoginNavBtn = document.getElementById("openLoginNavBtn");
  const navBlacklistBtn = document.getElementById("navBlacklistBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const keychainBadge = document.getElementById("keychainBadge");

  if (currentUser) {
    if (currentUserSpan) {
      currentUserSpan.textContent = `@${currentUser.username}`;
    }

    if (userAvatarImg) {
      const avatarUrl = currentUser.avatar || `https://images.hive.blog/u/${encodeURIComponent(currentUser.username)}/avatar/small`;
      userAvatarImg.src = getProxiedImageUrl(avatarUrl, 96, 96) || '';
      userAvatarImg.classList.remove("hidden");
    }

    if (keychainBadge) {
      if (currentUser.loginMethod === "keychain") {
        keychainBadge.classList.remove("hidden");
      } else {
        keychainBadge.classList.add("hidden");
      }
    }

    if (logoutBtn) logoutBtn.classList.remove("hidden");
    if (openLoginNavBtn) openLoginNavBtn.classList.add("hidden");
    if (navBlacklistBtn) navBlacklistBtn.classList.remove("hidden");
    if (settingsBtn) settingsBtn.classList.remove("hidden");
  } else {
    if (currentUserSpan) {
      currentUserSpan.textContent = "Not signed in";
    }

    if (userAvatarImg) {
      userAvatarImg.classList.add("hidden");
    }

    if (keychainBadge) {
      keychainBadge.classList.add("hidden");
    }

    if (logoutBtn) logoutBtn.classList.add("hidden");
    if (openLoginNavBtn) openLoginNavBtn.classList.remove("hidden");
    if (navBlacklistBtn) navBlacklistBtn.classList.remove("hidden"); // Permite abrir o gestor mesmo deslogado para ver histórico
  }
}
