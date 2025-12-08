// src/core/auth.js

import { currentUser, setCurrentUser } from '../config.js';
import { showNotification } from '../ui/notifications.js';

// Mova initLoginSystem para cá
export function initLoginSystem() {
  const loginModal = document.getElementById("loginModal");
  const hiveKeychainLogin = document.getElementById("hiveKeychainLogin");
  const manualLogin = document.getElementById("manualLogin");
  const manualLoginForm = document.getElementById("manualLoginForm");
  const submitManualLogin = document.getElementById("submitManualLogin");
  const logoutBtn = document.getElementById("logoutBtn");

  const savedUser = localStorage.getItem("currentUser");
  if (savedUser) {
    try {
      setCurrentUser(JSON.parse(savedUser));
      loginModal.classList.add("hidden");
      updateUserInfo();
    } catch (e) {
      localStorage.removeItem("currentUser");
    }
  }

  hiveKeychainLogin.addEventListener("click", async () => {
    // ... lógica de login com Keychain ...
    if (window.hive_keychain) {
      try {
        const username = prompt("Digite seu nome de usuário Hive:");
        if (!username) return;

        window.hive_keychain.requestSignBuffer(
          username,
          "Login Hive Moderation Dashboard",
          "Posting",
          (response) => {
            if (response.success) {
              const user = {
                username: username,
                role: "moderator",
                loginMethod: "keychain",
              };
              setCurrentUser(user);
              localStorage.setItem("currentUser", JSON.stringify(currentUser));
              loginModal.classList.add("hidden");
              updateUserInfo();
              showNotification("Login realizado com sucesso!", "success");
            } else {
              showNotification("Falha no login com Keychain", "error");
            }
          }
        );
      } catch (error) {
        showNotification("Erro ao conectar com Hive Keychain", "error");
      }
    } else {
      showNotification(
        "Hive Keychain não está instalado! Por favor, instale a extensão.",
        "warning"
      );
    }
  });

  manualLogin.addEventListener("click", () => {
    manualLoginForm.classList.toggle("hidden");
  });

  submitManualLogin.addEventListener("click", () => {
    // ... lógica de login manual ...
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    if (username && password) {
      const user = {
        username: username,
        role: "moderator",
        loginMethod: "manual",
      };
      setCurrentUser(user);
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      loginModal.classList.add("hidden");
      updateUserInfo();
      showNotification("Login manual realizado!", "success");
    } else {
      showNotification("Preencha todos os campos", "warning");
    }
  });

  logoutBtn.addEventListener("click", () => {
    setCurrentUser(null);
    localStorage.removeItem("currentUser");
    document.getElementById("loginModal").classList.remove("hidden");
    document.getElementById("logoutBtn").classList.add("hidden");
    document.getElementById("currentUser").textContent = "Não logado";
    showNotification("Logout realizado", "info");
  });
}

// Mova updateUserInfo para cá
export function updateUserInfo() {
  if (currentUser) {
    document.getElementById("currentUser").textContent = currentUser.username;
    document.getElementById("logoutBtn").classList.remove("hidden");

    const settingsBtn = document.getElementById("settingsBtn");
    if (settingsBtn) {
      settingsBtn.classList.remove("hidden");
    }
  }
}