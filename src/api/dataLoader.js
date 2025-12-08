// src/api/dataLoader.js

import { setAllPosts, setFilteredPosts, allPosts } from '../config.js';
import { updatePostsDisplay, updateFlaggedCount } from '../ui/domHelpers.js';
import { showNotification } from '../ui/notifications.js';
import { loadRankingByPosts, loadRankingByPayout, precalculateAuthorStats } from '../utils/statsCalculators.js';
import { updateSystemStatus } from '../ui/domHelpers.js';

export async function loadInitialData() {
  await loadPosts();
  precalculateAuthorStats();
  loadRankingByPosts();
  loadRankingByPayout();
  updateFlaggedCount();
}

// Mova a função loadPosts para cá
export async function loadPosts() {
  const loadingElement = document.getElementById("loadingPosts");
  loadingElement.classList.remove("hidden");

  try {
    const response = await fetch("../../data.json");
    // ... restante da lógica de loadPosts, movendo todas as reatribuições de
    // allPosts e filteredPosts para setAllPosts e setFilteredPosts ...

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const text = await response.text();
    const cleanedText = text.replace(/\\\\/g, "\\");
    const lines = cleanedText.split("\n").filter((line) => line.trim() !== "");

    const data = lines
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (e) {
          console.error(`Erro no parsing da linha ${index + 1}:`, line, e);
          return null;
        }
      })
      .filter((item) => item !== null);

    console.log(`Posts carregados via NDJSON: ${data.length}`);

    if (data.length > 0) {
      setAllPosts(data);
      setFilteredPosts([...data]);
      updatePostsDisplay();
      updateSystemStatus();

      document.getElementById("cacheCount").textContent = allPosts.length;
      document.getElementById("lastUpdate").textContent = "Agora";
    }
  } catch (error) {
    // ... lógica de erro ...
    console.error("Erro ao carregar posts:", error);
    showNotification(
      "Erro ao carregar posts. Verifique o arquivo 'data.json' e a conexão.",
      "error"
    );

    const container = document.getElementById("postsContainer");
    container.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Falha ao Processar Dados (NDJSON)</h3>
                <p>Verifique se o arquivo data.json existe e se está no formato NDJSON (JSON por linha).</p>
                <button onclick="window.location.reload()" class="btn-primary">
                    <i class="fas fa-sync-alt"></i> Tentar novamente
                </button>
            </div>
        `;
  } finally {
    loadingElement.classList.add("hidden");
  }
}

// Funções showCacheStats e clearCache
export async function showCacheStats() {
  // Implementação de showCacheStats se necessário
  showNotification("Estatísticas de cache exibidas no console (simulado)", "info");
}

export async function clearCache() {
  return new Promise((resolve) => {
    const keys = ["flaggedPosts", "mutedUsers", "moderationSettings"];

    keys.forEach((k) => localStorage.removeItem(k));

    // Recarrega as configurações para limpar os objetos exportados
    // Idealmente você teria uma função `resetSettings`
    window.location.reload(); // Recarregar é a forma mais fácil de redefinir o estado global neste caso

    resolve(true);
  });
}