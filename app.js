// Configuração
const API_BASE_URL = "http://localhost:4000";
let currentUser = null;
let allPosts = [];
let filteredPosts = [];
let currentPage = 1;
let postsPerPage = 25;
let flaggedPosts = JSON.parse(localStorage.getItem("flaggedPosts") || "{}");

// Carregar configurações do localStorage
let moderationSettings = {
  autoFlagSpam: true,
  autoFlagPlagiarism: true,
  notifyHighPayout: true,
  payoutAlertThreshold: 100,
  theme: "light",
  postsPerPage: 25,
  mutedUsers: [], // será carregado do localStorage
};

function loadSettings() {
  const savedSettings = JSON.parse(localStorage.getItem("moderationSettings") || "{}");

  moderationSettings = {
    autoFlagSpam: true,
    autoFlagPlagiarism: true,
    notifyHighPayout: true,
    payoutAlertThreshold: 100,
    theme: "light",
    postsPerPage: 25,
    mutedUsers: JSON.parse(localStorage.getItem("mutedUsers") || "[]"),
    ...savedSettings, // merge com settings salvos
  };

  // Garante que mutedUsers seja sempre um array
  if (!Array.isArray(moderationSettings.mutedUsers)) {
    moderationSettings.mutedUsers = [];
  }

  return moderationSettings;
}
// Função para salvar usuários mutados
function saveMutedUsers() {
  localStorage.setItem("mutedUsers", JSON.stringify(moderationSettings.mutedUsers));
}

// Função para mutar um usuário
function muteUser(username) {
  if (!moderationSettings.mutedUsers.includes(username)) {
    moderationSettings.mutedUsers.push(username);
    saveSettings();
    showNotification(`Usuário ${username} mutado com sucesso!`, "warning");
    refreshPostsDisplay();
  }
}

// Função para desmutar um usuário
function unmuteUser(username) {
  const index = moderationSettings.mutedUsers.indexOf(username);
  if (index !== -1) {
    moderationSettings.mutedUsers.splice(index, 1);
    saveSettings();
    showNotification(`Usuário ${username} desmutado!`, "info");
    refreshPostsDisplay();
  }
}

// Função para verificar se um usuário está mutado
function isUserMuted(username) {
  return Array.isArray(moderationSettings.mutedUsers) &&
         moderationSettings.mutedUsers.includes(username);
}

// Atualizar exibição de posts com filtro de usuários mutados
function refreshPostsDisplay() {
  // Filtrar posts removendo os de usuários mutados
  const postsToShow = filteredPosts.filter(post => !isUserMuted(post.author));
  
  const container = document.getElementById("postsContainer");
  const pageInfo = document.getElementById("pageInfo");

  if (postsToShow.length === 0) {
    container.innerHTML = '<div class="no-posts">Nenhum post encontrado</div>';
    pageInfo.textContent = "Página 1 de 1";
    return;
  }

  const startIndex = (currentPage - 1) * postsPerPage;
  const endIndex = startIndex + postsPerPage;
  const pagePosts = postsToShow.slice(startIndex, endIndex);

  const totalPages = Math.ceil(postsToShow.length / postsPerPage);
  pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;

  container.innerHTML = "";
  pagePosts.forEach((post) => {
    const postElement = createPostCard(post);
    container.appendChild(postElement);
  });

  // Atualizar estado dos botões de paginação
  document.getElementById("prevPage").disabled = currentPage === 1;
  document.getElementById("nextPage").disabled = currentPage === totalPages;
}

// Salvar configurações no localStorage
function saveSettings() {
  localStorage.setItem("moderationSettings", JSON.stringify({
    ...moderationSettings,
    mutedUsers: moderationSettings.mutedUsers, // garante que mutedUsers seja salvo junto
  }));
  showNotification("Configurações salvas com sucesso!", "success");
  applySettings();
}

// Aplicar configurações carregadas
function applySettings() {
  // Aplicar tema
  document.body.classList.remove("theme-light", "theme-dark");
  if (moderationSettings?.theme === "dark") {
    document.body.classList.add("theme-dark");
  } else {
    document.body.classList.add("theme-light");
  }

  // Aplicar posts por página
  postsPerPage = moderationSettings?.postsPerPage;
  const postsPerPageSelect = document.getElementById("postsPerPage");
  if (postsPerPageSelect) {
    postsPerPageSelect.value = postsPerPage.toString();
  }

  // Aplicar nas configurações também
  const postsPerPageSetting = document.getElementById("postsPerPageSetting");
  if (postsPerPageSetting) {
    postsPerPageSetting.value = postsPerPage.toString();
  }
}

// Tentar carregar Chart.js dinamicamente com fallback
function loadChartJS() {
  return new Promise((resolve) => {
    if (typeof Chart !== "undefined") {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js";
    script.integrity =
      "sha512-ElRFoEQdI5Ht6kZvyzXhYG9NqjtkmlkfYk0wr6wHxU9JEHakS7UJZNeml5ALk+8IKlU6jDgMabC3vkumRokgJA==";
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";

    script.onload = () => resolve();
    script.onerror = () => {
      console.warn("Chart.js não pôde ser carregado, gráficos desabilitados");
      resolve();
    };

    document.head.appendChild(script);
  });
}

// Inicialização do Dashboard
document.addEventListener("DOMContentLoaded", async function () {
  // Carregar Chart.js primeiro
  await loadChartJS();

  // Carregar configurações
  loadSettings();
  applySettings();

  initLoginSystem();
  initNavigation();
  initEventListeners();
  initModalListeners();
  await loadInitialData();
  updateSystemStatus();

  // Atualizar status a cada 30 segundos
  setInterval(updateSystemStatus, 30000);
});

// Sistema de Login
function initLoginSystem() {
  const loginModal = document.getElementById("loginModal");
  const hiveKeychainLogin = document.getElementById("hiveKeychainLogin");
  const manualLogin = document.getElementById("manualLogin");
  const manualLoginForm = document.getElementById("manualLoginForm");
  const submitManualLogin = document.getElementById("submitManualLogin");
  const logoutBtn = document.getElementById("logoutBtn");

  // Verificar se já está logado
  const savedUser = localStorage.getItem("currentUser");
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      loginModal.classList.add("hidden");
      updateUserInfo();
    } catch (e) {
      localStorage.removeItem("currentUser");
    }
  }

  // Login com Hive Keychain
  hiveKeychainLogin.addEventListener("click", async () => {
    if (window.hive_keychain) {
      try {
        const username = prompt("Digite seu nome de usuário Hive:");
        if (!username) return;

        // Solicitar login com Keychain
        window.hive_keychain.requestSignBuffer(
          username,
          "Login Hive Moderation Dashboard",
          "Posting",
          (response) => {
            if (response.success) {
              currentUser = {
                username: username,
                role: "moderator",
                loginMethod: "keychain",
              };
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

  // Login manual
  manualLogin.addEventListener("click", () => {
    manualLoginForm.classList.toggle("hidden");
  });

  submitManualLogin.addEventListener("click", () => {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    if (username && password) {
      // Em produção, você validaria isso no backend
      currentUser = {
        username: username,
        role: "moderator",
        loginMethod: "manual",
      };
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      loginModal.classList.add("hidden");
      updateUserInfo();
      showNotification("Login manual realizado!", "success");
    } else {
      showNotification("Preencha todos os campos", "warning");
    }
  });

  // Logout
  logoutBtn.addEventListener("click", () => {
    currentUser = null;
    localStorage.removeItem("currentUser");
    document.getElementById("loginModal").classList.remove("hidden");
    document.getElementById("logoutBtn").classList.add("hidden");
    document.getElementById("currentUser").textContent = "Não logado";
    showNotification("Logout realizado", "info");
  });
}

function updateUserInfo() {
  if (currentUser) {
    document.getElementById("currentUser").textContent = currentUser.username;
    document.getElementById("logoutBtn").classList.remove("hidden");

    // Mostrar botão de configurações apenas para usuários logados
    const settingsBtn = document.getElementById("settingsBtn");
    if (settingsBtn) {
      settingsBtn.classList.remove("hidden");
    }
  }
}

// Sistema de Navegação
function initNavigation() {
  const navItems = document.querySelectorAll(".nav-menu li");
  const sections = document.querySelectorAll(".content-section");

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      // Remover classe active de todos
      navItems.forEach((nav) => nav.classList.remove("active"));
      sections.forEach((section) => section.classList.remove("active"));

      // Adicionar classe active ao item clicado
      item.classList.add("active");

      // Mostrar seção correspondente
      const sectionId = item.getAttribute("data-section");
      document.getElementById(`${sectionId}-section`).classList.add("active");

      // Carregar dados da seção se necessário
      switch (sectionId) {
        case "ranking-posts":
          loadRankingByPosts();
          break;
        case "ranking-payout":
          loadRankingByPayout();
          break;
        case "moderation":
          loadModerationPanel();
          break;
        case "flagged":
          loadFlaggedPosts();
          break;
        case "stats":
          loadStatistics();
          break;
      }
    });
  });
}

// Função para inicializar listeners dos modais
function initModalListeners() {
  // Botão de configurações na navbar
  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      openSettingsModal();
    });
  }

  // Botão de configurações na toolbar
  const settingsToolbarBtn = document.getElementById("settingsToolbarBtn");
  if (settingsToolbarBtn) {
    settingsToolbarBtn.addEventListener("click", () => {
      openSettingsModal();
    });
  }

  // Botão para salvar configurações
  const saveSettingsBtn = document.getElementById("saveSettings");
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
      // Coletar valores dos campos
      moderationSettings = {
        autoFlagSpam: document.getElementById("autoFlagSpam").checked,
        autoFlagPlagiarism:
          document.getElementById("autoFlagPlagiarism").checked,
        notifyHighPayout: document.getElementById("notifyHighPayout").checked,
        payoutAlertThreshold:
          parseFloat(document.getElementById("payoutAlertThreshold").value) ||
          100,
        theme: document.getElementById("themeSelect").value,
        postsPerPage:
          parseInt(document.getElementById("postsPerPageSetting").value) || 25,
      };

      saveSettings();
      closeModal("settingsModal");
    });
  }

  // Fechar modais ao clicar no X
  document.querySelectorAll(".close-modal").forEach((closeBtn) => {
    closeBtn.addEventListener("click", function () {
      const modal = this.closest(".modal");
      if (modal) {
        modal.classList.add("hidden");
      }
    });
  });

  // Fechar modais ao clicar fora do conteúdo
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", function (e) {
      if (e.target === this) {
        this.classList.add("hidden");
      }
    });
  });
}

// Função para abrir modal de configurações
function openSettingsModal() {
  const modal = document.getElementById("settingsModal");
  if (!modal) return;

  // Campo checkbox — se undefined, vira false
  document.getElementById("autoFlagSpam").checked =
    !!moderationSettings?.autoFlagSpam;

  document.getElementById("autoFlagPlagiarism").checked =
    !!moderationSettings?.autoFlagPlagiarism;

  document.getElementById("notifyHighPayout").checked =
    !!moderationSettings?.notifyHighPayout;

  // Campo numérico — se undefined, vira ""
  document.getElementById("payoutAlertThreshold").value =
    moderationSettings?.payoutAlertThreshold ?? "";

  document.getElementById("themeSelect").value =
    moderationSettings?.theme ?? "light";

  document.getElementById("postsPerPageSetting").value =
    moderationSettings?.postsPerPage ?? 25;

  modal.classList.remove("hidden");
}


// Função para fechar modais
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("hidden");
  }
}

// Event Listeners
function initEventListeners() {
  // Botões de ferramentas
  document.getElementById("refreshBtn").addEventListener("click", loadPosts);
  document
    .getElementById("cacheStatsBtn")
    .addEventListener("click", showCacheStats);
  document
    .getElementById("clearCacheBtn")
    .addEventListener("click", clearCache);

    document.getElementById('mutedUsersBtn').addEventListener('click', openMutedUsersManager);

  // Paginação
  document.getElementById("prevPage").addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      updatePostsDisplay();
    }
  });

  document.getElementById("nextPage").addEventListener("click", () => {
    const totalPages = Math.ceil(filteredPosts.length / postsPerPage);
    if (currentPage < totalPages) {
      currentPage++;
      updatePostsDisplay();
    }
  });

  document.getElementById("postsPerPage").addEventListener("change", (e) => {
    postsPerPage = parseInt(e.target.value);
    moderationSettings.postsPerPage = postsPerPage;
    saveSettings();
    currentPage = 1;
    updatePostsDisplay();
  });

  // Busca
  document
    .getElementById("searchInput")
    .addEventListener("input", debounce(searchPosts, 300));

  // Filtros rápidos
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      document
        .querySelectorAll(".filter-btn")
        .forEach((b) => b.classList.remove("active"));
      this.classList.add("active");
      applyFilter(this.getAttribute("data-filter"));
    });
  });

  // Moderação
  document.getElementById("scanSpamBtn").addEventListener("click", scanForSpam);
  document
    .getElementById("scanPlagiarismBtn")
    .addEventListener("click", scanForPlagiarism);
  document
    .getElementById("selectAll")
    .addEventListener("change", selectAllPosts);

  // Busca avançada
  document
    .getElementById("performAdvancedSearch")
    .addEventListener("click", performAdvancedSearch);
}

// Carregar dados iniciais
async function loadInitialData() {
  await loadPosts();
  loadRankingByPosts();
  loadRankingByPayout();
  updateFlaggedCount();
}

// Carregar posts
async function loadPosts() {
  const loadingElement = document.getElementById("loadingPosts");
  loadingElement.classList.remove("hidden");

  try {
    const response = await fetch("./data.json");

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // 1. LER COMO TEXTO (necessário para NDJSON)
    const text = await response.text();

    const cleanedText = text.replace(/\\\\/g, '\\');
    
    // 2. PROCESSAR O TEXTO LINHA POR LINHA
    const lines = cleanedText.split('\n').filter(line => line.trim() !== ''); // Divide em linhas e remove vazias
    
    const data = lines.map((line, index) => {
        try {
            // Tenta fazer o parsing de cada linha, que é um objeto JSON completo
            return JSON.parse(line);
        } catch (e) {
            console.error(`Erro no parsing da linha ${index + 1}:`, line, e);
            // Se houver erro de parsing em uma linha, retornamos null
            return null; 
        }
    }).filter(item => item !== null); // Remove qualquer linha que tenha falhado no parsing

    // O 'data' agora é um Array JavaScript válido, contendo todos os objetos
    
    console.log(`Posts carregados via NDJSON: ${data.length}`);

    if (data.length > 0) {
      allPosts = data;
      filteredPosts = [...allPosts];
      updatePostsDisplay();
      updateSystemStatus();

      // Atualizar contagem no cache
        document.getElementById("cacheCount").textContent = allPosts.length;

        document.getElementById("lastUpdate").textContent = "Agora";
    }
    
  } catch (error) {
    console.error("Erro ao carregar posts:", error);
    // Note que o 'error' pode ser um erro de rede ou um erro de parsing (se o arquivo estiver muito quebrado)
    showNotification(
      "Erro ao carregar posts. Verifique o arquivo 'data.json' e a conexão.",
      "error"
    );

    // Fallback: mostrar mensagem amigável
    const container = document.getElementById("postsContainer");
    // Adicionei uma menção ao formato, caso ajude no debug futuro
    container.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Falha ao Processar Dados (NDJSON)</h3>
                <p>Verifique se o arquivo data.json existe e se está no formato NDJSON (JSON por linha).</p>
                <button onclick="loadPosts()" class="btn-primary">
                    <i class="fas fa-sync-alt"></i> Tentar novamente
                </button>
            </div>
        `;
  } finally {
    loadingElement.classList.add("hidden");
  }
}

// Atualizar exibição de posts
function updatePostsDisplay() {
  refreshPostsDisplay(); // Substitua o conteúdo existente por esta chamada
}

function countApps(posts) {
  const appCounts = {};
  const userAppMap = {};

  posts.forEach(post => {
    const user = post.author;
    let app = post.json_metadata?.app || "Desconhecido";

    // Normalizar o app: extrair nome antes da barra e ignorar versão
    // Ex: "actifit/0.12.4" => "actifit"
    const match = app.match(/^([a-zA-Z0-9\-]+)\//);
    if (match) {
      app = match[1].toLowerCase();
    } else {
      app = app.toLowerCase();
    }

    if (!userAppMap[user]) userAppMap[user] = new Set();

    // Contar 1 post por usuário por app
    if (!userAppMap[user].has(app)) {
      userAppMap[user].add(app);
      appCounts[app] = (appCounts[app] || 0) + 1;
    }
  });

  return appCounts;
}



function saveAppCounts(appCounts) {
  sessionStorage.setItem("appCounts", JSON.stringify(appCounts));
}

function loadAppCounts() {
  return JSON.parse(sessionStorage.getItem("appCounts") || "{}");
}


// Criar card de post
function createPostCard(post) {
  const div = document.createElement("div");
  div.className = "post-card";
  div.dataset.id = post.id;

  // Verificar se está sinalizado
  const isFlagged = flaggedPosts[post.id];
  const flagClass = isFlagged ? "flagged" : "";

  // Calcular risco
  const riskLevel = calculateRiskLevel(post);
  const payoutValue = parseFloat(post.pending_payout_value || 0);

  // Truncar título se for muito longo
  const title = escapeHTML(post.title) || "";
  const shortTitle = title.length > 50 ? title.substring(0, 50) + "..." : title;

  // Truncar conteúdo
  const content = escapeHTML(post.body) || "Sem conteúdo";
  const shortContent =
    content.length > 150 ? content.substring(0, 150) + "..." : content;

  // Tags
  let tagsHtml = "";
  if (post.tags) {
    const tagArray = Array.isArray(post.tags)
      ? post.tags.slice(0, 3) // já é array
      : post.tags.split(",").slice(0, 3); // é string

    tagsHtml = tagArray
      .map((tag) => `<span class="post-tag">${tag.trim()}</span>`)
      .join("");
  }

  div.innerHTML = `
  <div class="post-card-header ${post.parent_author ? "parented" : ""}">
      <span class="post-author">@${post.author}</span>
      ${post.parent_author ? '<span class="post-type">Comentário</span>' : '<span class="post-type">Post</span>'}
      <span class="post-payout">$${payoutValue.toFixed(2)}</span>
  </div>
        <div class="post-card-body">
            <h3 class="post-title">${shortTitle}</h3>
            <p class="post-excerpt">${shortContent}</p>
            <div class="post-tags">${tagsHtml}</div>
            <div class="risk-badge risk-${riskLevel}">${riskLevel.toUpperCase()}</div>
            <div class="post-app">App: ${post.json_metadata.app || "Desconhecido"}</div>
        </div>
        <div class="post-card-footer">
            <span class="post-date">${formatDate(post.created)}</span>
            <div class="post-actions">
                <button class="btn-icon view-post" title="Ver detalhes">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn-icon flag-post ${flagClass}" title="${isFlagged ? "Remover flag" : "Sinalizar"}">
                    <i class="fas fa-flag"></i>
                </button>
                <button class="btn-icon moderate-post" title="Moderar">
                    <i class="fas fa-user-shield"></i>
                </button>
            </div>
        </div>
    `;

  const viewBtn = div.querySelector(".view-post");
  const flagBtn = div.querySelector(".flag-post");
  const modBtn = div.querySelector(".moderate-post");

  if (viewBtn) viewBtn.addEventListener("click", () => showPostDetail(post));
  if (flagBtn) flagBtn.addEventListener("click", () => toggleFlagPost(post.id));
  if (modBtn) modBtn.addEventListener("click", () => openModerationPanel(post));


  const muteBtn = document.createElement("button");
  const isMuted = isUserMuted(post.author);
  muteBtn.className = `btn-icon mute-user-btn ${isMuted ? 'muted' : ''}`;
  muteBtn.title = isMuted ? "Desmutar usuário" : "Mutuar usuário";
  muteBtn.innerHTML = `<i class="fas fa-volume-mute"></i>`;

    muteBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // Evitar que abra o modal de detalhes
    if (isUserMuted(post.author)) {
      unmuteUser(post.author);
      muteBtn.classList.remove('muted');
      muteBtn.title = "Mutuar usuário";
      muteBtn.innerHTML = `<i class="fas fa-volume-mute"></i>`;
    } else {
      muteUser(post.author);
      muteBtn.classList.add('muted');
      muteBtn.title = "Desmutar usuário";
      muteBtn.innerHTML = `<i class="fas fa-volume-up"></i>`;
    }
  });

    // Adicionar ao container de ações
  const actionsContainer = div.querySelector('.post-actions');
  if (actionsContainer) {
    actionsContainer.appendChild(muteBtn);
  }

  //console.log(viewBtn);
  // Adicionar event listeners aos botões
  //div.querySelector('.view-post').addEventListener('click', () => showPostDetail(post));
  //div.querySelector('.flag-post').addEventListener('click', () => toggleFlagPost(post.id));
  //div.querySelector('.moderate-post').addEventListener('click', () => openModerationPanel(post));

  return div;
}


// Adicione esta função para abrir o gerenciador de usuários mutados
function openMutedUsersManager() {
  const modal = document.getElementById("mutedUsersModal");
  const container = document.getElementById("mutedUsersList");

  if (!modal || !container) return;

  // Limpar lista
  container.innerHTML = '';

  if (moderationSettings?.mutedUsers?.length === 0) {
    container.innerHTML = '<div class="no-muted-users">Nenhum usuário mutado</div>';
  } else {
    moderationSettings.mutedUsers.forEach(username => {
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

    // Eventos de desmutar
    container.querySelectorAll('.unmute-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const username = this.getAttribute('data-username');
        unmuteUser(username);
        openMutedUsersManager(); // recarrega a lista
      });
    });
  }

  modal.classList.remove('hidden');
}

function normalizeTags(tags) {
  if (!tags) return "";
  if (Array.isArray(tags)) return tags.join(" ").toLowerCase();
  if (typeof tags === "string") return tags.toLowerCase();
  return "";
}

// Buscar posts

function searchPosts() {
  const searchTerm = document.getElementById("searchInput").value.toLowerCase();
  const filterType = document.getElementById("searchFilter").value;

  const normalizeTags = (tags) => {
    if (!tags) return "";
    if (Array.isArray(tags)) return tags.join(" ").toLowerCase();
    if (typeof tags === "string") return tags.toLowerCase();
    return "";
  };

  if (!searchTerm) {
    filteredPosts = [...allPosts];
  } else {
    filteredPosts = allPosts.filter((post) => {
      switch (filterType) {
        case "author":
          return post.author.toLowerCase().includes(searchTerm);

        case "title":
          return (escapeHTML(post.title) || "")
            .toLowerCase()
            .includes(searchTerm);

        case "content":
          return (escapeHTML(post.body) || "")
            .toLowerCase()
            .includes(searchTerm);

        case "tags":
          return normalizeTags(post.tags).includes(searchTerm);

        default:
          return (
            post.author.toLowerCase().includes(searchTerm) ||
            (escapeHTML(post.title) || "").toLowerCase().includes(searchTerm) ||
            (escapeHTML(post.body) || "").toLowerCase().includes(searchTerm) ||
            normalizeTags(post.tags).includes(searchTerm)
          );
      }
    });
  }

  currentPage = 1;
  updatePostsDisplay();
}

// Aplicar filtro rápido
function applyFilter(filterType) {
  const now = new Date();

  switch (filterType) {
    case "last-hour":
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      filteredPosts = allPosts.filter(
        (post) => new Date(post.created) > oneHourAgo
      );
      break;

    case "last-6h":
      const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      filteredPosts = allPosts.filter(
        (post) => new Date(post.created) > sixHoursAgo
      );
      break;

    case "high-payout":
      filteredPosts = allPosts.filter(
        (post) => parseFloat(post.pending_payout_value || 0) > 100
      );
      break;

    case "flagged":
      filteredPosts = allPosts.filter((post) => flaggedPosts[post.id]);
      break;

    case "deleted":
      filteredPosts = allPosts.filter((post) => post.deleted === true);
      break;

    default:
      filteredPosts = [...allPosts];
  }

  currentPage = 1;
  updatePostsDisplay();
}

// Ranking por posts
function loadRankingByPosts() {
  const timeFilter = parseInt(
    document.getElementById("rankingTimeFilter").value
  );
  const cutoffDate = new Date(Date.now() - timeFilter * 60 * 60 * 1000);

  // Agrupar posts por autor
  const authorStats = {};

  allPosts.forEach((post) => {
    if (new Date(post.created) > cutoffDate) {
      if (!authorStats[post.author]) {
        authorStats[post.author] = {
          posts: 0,
          totalPayout: 0,
          lastPost: post.created,
        };
      }
      authorStats[post.author].posts++;
      authorStats[post.author].totalPayout += parseFloat(
        post.pending_payout_value || 0
      );
    }
  });

  // Converter para array e ordenar
  const ranking = Object.entries(authorStats)
    .map(([author, stats]) => ({ author, ...stats }))
    .sort((a, b) => b.posts - a.posts)
    .slice(0, 100);

  displayRanking(ranking, "posts", "rankingPostsContainer");
}

// Ranking por payout
function loadRankingByPayout() {
  const timeFilter = parseInt(
    document.getElementById("payoutTimeFilter").value
  );
  const cutoffDate = new Date(Date.now() - timeFilter * 60 * 60 * 1000);

  const authorStats = {};

  allPosts.forEach((post) => {
    if (new Date(post.created) > cutoffDate) {
      if (!authorStats[post.author]) {
        authorStats[post.author] = {
          posts: 0,
          totalPayout: 0,
          lastPost: post.created,
        };
      }
      authorStats[post.author].posts++;
      authorStats[post.author].totalPayout += parseFloat(
        post.pending_payout_value || 0
      );
    }
  });

  const ranking = Object.entries(authorStats)
    .map(([author, stats]) => ({ author, ...stats }))
    .sort((a, b) => b.totalPayout - a.totalPayout)
    .slice(0, 100);

  displayRanking(ranking, "payout", "rankingPayoutContainer");
}

// Exibir ranking
function displayRanking(ranking, type, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  ranking.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "ranking-item";

    // Cores para os top 3
    let rankClass = "";
    if (index === 0) rankClass = "first";
    else if (index === 1) rankClass = "second";
    else if (index === 2) rankClass = "third";

    div.innerHTML = `
            <div class="ranking-rank ${rankClass}">${index + 1}</div>
            <div class="ranking-info">
                <div class="ranking-author">${item.author}</div>
                <div class="ranking-stats">
                    <span class="ranking-stat">
                        Posts: <strong>${item.posts}</strong>
                    </span>
                    <span class="ranking-stat">
                        Payout: <strong>$${item.totalPayout.toFixed(2)}</strong>
                    </span>
                    <span class="ranking-stat">
                        Último: ${formatDate(item.lastPost)}
                    </span>
                </div>
            </div>
            <div class="ranking-actions">
                <button class="btn-icon view-author" data-author="${item.author}">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn-icon moderate-author" data-author="${item.author}">
                    <i class="fas fa-user-shield"></i>
                </button>
            </div>
        `;

    div
      .querySelector(".view-author")
      .addEventListener("click", () => viewAuthorPosts(item.author));
    div
      .querySelector(".moderate-author")
      .addEventListener("click", () => moderateAuthor(item.author));

    container.appendChild(div);
  });
}

// Painel de moderação
function loadModerationPanel() {
  const tableBody = document.getElementById("moderationTableBody");
  tableBody.innerHTML = "";

  let highRisk = 0,
    mediumRisk = 0,
    lowRisk = 0,
    totalFlagged = 0;

  // Usar primeiros 100 posts para o painel de moderação
  const moderationPosts = allPosts.slice(0, 100);

  moderationPosts.forEach((post) => {
    const riskLevel = calculateRiskLevel(post);
    const isFlagged = flaggedPosts[post.id];

    switch (riskLevel) {
      case "high":
        highRisk++;
        break;
      case "medium":
        mediumRisk++;
        break;
      case "low":
        lowRisk++;
        break;
    }

    if (isFlagged) totalFlagged++;

    const row = document.createElement("tr");
    row.innerHTML = `
            <td><input type="checkbox" class="post-checkbox" data-id="${post.id}"></td>
            <td>${post.author}</td>
            <td>${(escapeHTML(post.title) || "Sem título").substring(0, 50)}${(escapeHTML(post.title) || "").length > 50 ? "..." : ""}</td>
            <td>$${parseFloat(post.pending_payout_value || 0).toFixed(2)}</td>
            <td><span class="risk-badge risk-${riskLevel}">${riskLevel.toUpperCase()}</span></td>
            <td>${isFlagged ? '<i class="fas fa-flag text-danger"></i>' : ""}</td>
            <td>
                <button class="btn-icon view-post-sm" data-id="${post.id}">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn-icon flag-post-sm ${isFlagged ? "flagged" : ""}" data-id="${post.id}">
                    <i class="fas fa-flag"></i>
                </button>
                <button class="btn-icon delete-post-sm" data-id="${post.id}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;

    row
      .querySelector(".view-post-sm")
      .addEventListener("click", () => showPostDetail(post));
    row
      .querySelector(".flag-post-sm")
      .addEventListener("click", () => toggleFlagPost(post.id, true));
    row
      .querySelector(".delete-post-sm")
      .addEventListener("click", () => deletePost(post.id));

    tableBody.appendChild(row);
  });

  // Atualizar estatísticas
  document.getElementById("highRiskCount").textContent = highRisk;
  document.getElementById("mediumRiskCount").textContent = mediumRisk;
  document.getElementById("lowRiskCount").textContent = lowRisk;
  document.getElementById("totalFlaggedCount").textContent = totalFlagged;
}

// Sinalizar/remover sinalização de post
function toggleFlagPost(postId, refresh = false) {
  if (flaggedPosts[postId]) {
    delete flaggedPosts[postId];
    showNotification("Flag removida do post", "info");
  } else {
    flaggedPosts[postId] = {
      timestamp: new Date().toISOString(),
      flaggedBy: currentUser?.username || "system",
      reason: "Moderação manual",
    };
    showNotification("Post sinalizado para revisão", "warning");

    // Notificar se o payout for alto e a opção estiver ativada
    const post = allPosts.find((p) => p.id == postId);
    if (post && moderationSettings?.notifyHighPayout) {
      const payout = parseFloat(post.pending_payout_value || 0);
      if (payout > moderationSettings?.payoutAlertThreshold) {
        showNotification(
          `⚠️ Post com alto payout ($${payout.toFixed(2)}) sinalizado!`,
          "warning"
        );
      }
    }
  }

  localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
  updateFlaggedCount();

  if (refresh) {
    loadModerationPanel();
    updatePostsDisplay();
  } else {
    // Atualizar apenas o botão específico
    const flagBtn = document.querySelector(`.flag-post[data-id="${postId}"]`);
    if (flagBtn) {
      flagBtn.classList.toggle("flagged");
      flagBtn.title = flaggedPosts[postId] ? "Remover flag" : "Sinalizar";
    }
  }
}

// Posts sinalizados
function loadFlaggedPosts() {
  const container = document.getElementById("flaggedContainer");
  container.innerHTML = "";

  const flaggedPostIds = Object.keys(flaggedPosts);
  const flaggedPostsList = allPosts.filter((post) =>
    flaggedPostIds.includes(post.id.toString())
  );

  if (flaggedPostsList.length === 0) {
    container.innerHTML = '<div class="no-posts">Nenhum post sinalizado</div>';
    return;
  }

  flaggedPostsList.forEach((post) => {
    const flagInfo = flaggedPosts[post.id];
    const postElement = createPostCard(post);

    const flagDetails = document.createElement("div");
    flagDetails.className = "flag-details";
    flagDetails.innerHTML = `
            <p><strong>Sinalizado por:</strong> ${flagInfo.flaggedBy}</p>
            <p><strong>Data:</strong> ${formatDate(flagInfo.timestamp)}</p>
            ${flagInfo.reason ? `<p><strong>Motivo:</strong> ${flagInfo.reason}</p>` : ""}
            <button class="btn-primary clear-flag-btn" data-id="${post.id}">
                <i class="fas fa-check"></i> Limpar Flag
            </button>
        `;

    flagDetails
      .querySelector(".clear-flag-btn")
      .addEventListener("click", () => {
        toggleFlagPost(post.id);
        loadFlaggedPosts();
      });

    postElement.appendChild(flagDetails);
    container.appendChild(postElement);
  });
}

// Busca avançada
function performAdvancedSearch() {
  const author = document.getElementById("searchAuthor").value.toLowerCase();
  const title = document.getElementById("searchTitle").value.toLowerCase();
  const tags = document.getElementById("searchTags").value.toLowerCase();
  const content = document.getElementById("searchContent").value.toLowerCase();
  const dateFrom = document.getElementById("searchDateFrom").value;
  const dateTo = document.getElementById("searchDateTo").value;
  const minPayout =
    parseFloat(document.getElementById("searchMinPayout").value) || 0;

  let results = [...allPosts];

  // Aplicar filtros
  if (author) {
    results = results.filter((post) =>
      post.author.toLowerCase().includes(author)
    );
  }

  if (title) {
    results = results.filter((post) =>
      (escapeHTML(post.title) || "").toLowerCase().includes(title)
    );
  }

  if (tags) {
    const tagList = tags.split(",").map((t) => t.trim());
    results = results.filter((post) => {
      if (!post.tags) return false;
      const postTags = post.tags.toLowerCase();
      return tagList.some((tag) => postTags.includes(tag));
    });
  }

  if (content) {
    try {
      // Tentar como regex
      if (
        content.includes("*") ||
        content.includes("[") ||
        content.includes("(")
      ) {
        const regex = new RegExp(content, "i");
        results = results.filter((post) =>
          regex.test(escapeHTML(post.body) || "")
        );
      } else {
        // Busca simples
        results = results.filter((post) =>
          (escapeHTML(post.body) || "").toLowerCase().includes(content)
        );
      }
    } catch {
      // Usar busca simples se regex for inválido
      results = results.filter((post) =>
        (escapeHTML(post.body) || "").toLowerCase().includes(content)
      );
    }
  }

  if (dateFrom) {
    const fromDate = new Date(dateFrom);
    results = results.filter((post) => new Date(post.created) >= fromDate);
  }

  if (dateTo) {
    const toDate = new Date(dateTo);
    results = results.filter((post) => new Date(post.created) <= toDate);
  }

  if (minPayout > 0) {
    results = results.filter(
      (post) => parseFloat(post.pending_payout_value || 0) >= minPayout
    );
  }

  displaySearchResults(results);
}

function displaySearchResults(results) {
  const container = document.getElementById("advancedSearchResults");
  container.innerHTML = "";

  if (results.length === 0) {
    container.innerHTML =
      '<div class="no-results">Nenhum resultado encontrado</div>';
    return;
  }

  const summary = document.createElement("div");
  summary.className = "search-summary";
  summary.innerHTML = `<h4>${results.length} resultados encontrados</h4>`;
  container.appendChild(summary);

  results.slice(0, 50).forEach((post) => {
    const div = document.createElement("div");
    div.className = "search-result-item";
    div.innerHTML = `
            <h5>${escapeHTML(post.title) || "Sem título"}</h5>
            <p><strong>Autor:</strong> ${post.author}</p>
            <p><strong>Payout:</strong> $${parseFloat(post.pending_payout_value || 0).toFixed(2)}</p>
            <p><strong>Data:</strong> ${formatDate(post.created)}</p>
            <p><strong>Tags:</strong> ${post.tags || "Nenhuma"}</p>
            <p class="excerpt">${escapeHTML(post.body) ? escapeHTML(post.body).substring(0, 200) + "..." : ""}</p>
            <button class="btn-primary view-result-btn" data-id="${post.id}">
                <i class="fas fa-eye"></i> Ver Detalhes
            </button>
        `;

    div
      .querySelector(".view-result-btn")
      .addEventListener("click", () => showPostDetail(post));
    container.appendChild(div);
  });
}

// Estatísticas
function loadStatistics() {
  updateStatsSummary();

  // Tentar criar gráficos se Chart.js estiver disponível
  if (typeof Chart !== "undefined") {
    createCharts();
  }

  document.getElementById("totalPostsCount").textContent = allPosts.length;
  document.getElementById("avgPayout").textContent =
    "$" + calculateAveragePayout().toFixed(2);
  document.getElementById("cacheStatsCount").textContent = allPosts.length;
  document.getElementById("cacheLastUpdate").textContent = formatDate(
    new Date()
  );
  document.getElementById("cacheStatus").textContent = "Ativo";
  document.getElementById("cacheStatus").className = "status-good";
}

function createCharts() {
  try {
    // Gráfico de posts por hora (exemplo)
    const ctx1 = document.getElementById("postsPerHourChart");
    if (ctx1) {
      // Dados de exemplo
      const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
      const postCounts = hours.map(() => Math.floor(Math.random() * 50) + 10);

      new Chart(ctx1, {
        type: "bar",
        data: {
          labels: hours,
          datasets: [
            {
              label: "Posts por Hora",
              data: postCounts,
              backgroundColor: "rgba(54, 162, 235, 0.5)",
              borderColor: "rgba(54, 162, 235, 1)",
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              display: true,
              position: "top",
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: "Número de Posts",
              },
            },
            x: {
              title: {
                display: true,
                text: "Hora do Dia",
              },
            },
          },
        },
      });
    }

    // Gráfico de distribuição por categoria
    const ctx2 = document.getElementById("categoryDistributionChart");
    if (ctx2) {
      // Agrupar por categoria
      const categories = {};
      allPosts.forEach((post) => {
        const cat = post.category || "outros";
        categories[cat] = (categories[cat] || 0) + 1;
      });

      const topCategories = Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

      new Chart(ctx2, {
        type: "pie",
        data: {
          labels: topCategories.map((c) => c[0]),
          datasets: [
            {
              data: topCategories.map((c) => c[1]),
              backgroundColor: [
                "#FF6384",
                "#36A2EB",
                "#FFCE56",
                "#4BC0C0",
                "#9966FF",
                "#FF9F40",
                "#FF6384",
                "#C9CBCF",
              ],
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: "right",
            },
          },
        },
      });
    }

// Gráfico de Top Apps
const ctx3 = document.getElementById("topAppChart");
if (ctx3) {
  const appCounts = countApps(allPosts); // função que já criamos
  const sortedApps = Object.entries(appCounts)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 10); // top 10 apps

  new Chart(ctx3, {
    type: "doughnut",
    data: {
      labels: sortedApps.map(a => a[0]),
      datasets: [{
        data: sortedApps.map(a => a[1]),
        backgroundColor: [
          "#FF6384","#36A2EB","#FFCE56","#4BC0C0","#9966FF",
          "#FF9F40","#FF6384","#C9CBCF","#8AC926","#FF595E"
        ],
        borderColor: "#ffffff",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "right",
          labels: {
            boxWidth: 20,
            padding: 15
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.raw || 0;
              return `${label}: ${value} Users`;
            }
          }
        }
      }
    }
  });
}


    
  } catch (error) {
    console.warn("Erro ao criar gráficos:", error);
  }
}

function updateStatsSummary() {
  // Calcular estatísticas básicas
  const authors = new Set(allPosts.map((p) => p.author));
  const totalPayout = allPosts.reduce(
    (sum, post) => sum + parseFloat(post.pending_payout_value || 0),
    0
  );

  document.getElementById("avgPostsPerAuthor").textContent =
    authors.size > 0 ? (allPosts.length / authors.size).toFixed(1) : "0";

  const deletedPosts = allPosts.filter((p) => p.deleted).length;
  document.getElementById("deletionRate").textContent =
    allPosts.length > 0
      ? ((deletedPosts / allPosts.length) * 100).toFixed(1) + "%"
      : "0%";

  // Estatísticas de risco
  const flaggedCount = Object.keys(flaggedPosts).length;
  document.getElementById("flagRate").textContent =
    allPosts.length > 0
      ? ((flaggedCount / allPosts.length) * 100).toFixed(1) + "%"
      : "0%";

  // Contar posts de alto payout
  const highPayoutPosts = allPosts.filter(
    (p) => parseFloat(p.pending_payout_value || 0) > 100
  ).length;
  document.getElementById("highPayoutPosts").textContent = highPayoutPosts;

  // Contar autores com múltiplos posts
  const authorPostCounts = {};
  allPosts.forEach((post) => {
    authorPostCounts[post.author] = (authorPostCounts[post.author] || 0) + 1;
  });
  const multiPostAuthors = Object.values(authorPostCounts).filter(
    (count) => count > 3
  ).length;
  document.getElementById("multiPostAuthors").textContent = multiPostAuthors;
}

// Funções de utilidade
function calculateRiskLevel(post) {
  let riskScore = 0;

  const commandRegex = /\!(bbh|lady|vote|gif|pizza|beer|pepe|meme|cpt|summarize)\b/i;

  if (commandRegex.test(post.body || "")) {
    riskScore += 2;
  }

  // Payout alto
  const payout = parseFloat(post.pending_payout_value || 0);
  if (payout > 500) riskScore += 3;
  else if (payout > 100) riskScore += 1;

  // Conteúdo curto

  // Múltiplos posts do mesmo autor
  const authorPosts = allPosts.filter((p) => p.author === post.author);
  if (authorPosts.length > 15) {
    if ((escapeHTML(post.body) || "").length < 50) riskScore += 2;
  }

  if (authorPosts.length > 100) riskScore += 4;

  if (authorPosts.length > 200) riskScore += 4;

  // Tags suspeitas
  const suspiciousTags = [
    "make-money",
    "earn-fast",
    "crypto-scam",
    "get-rich",
    "instant-cash",
  ];
  if (post.tags) {
    const tagsString = Array.isArray(post.tags)
      ? post.tags.join(" ").toLowerCase()
      : String(post.tags).toLowerCase();

    if (suspiciousTags.some((tag) => tagsString.includes(tag))) {
      riskScore += 3;
    }
  }

  // Já sinalizado
  if (flaggedPosts[post.id]) riskScore += 4;

  // Categoria suspeita
  if (
    post.category &&
    ["nsfw", "adult", "gambling"].includes(post.category.toLowerCase())
  ) {
    riskScore += 2;
  }

  if (riskScore >= 7) return "high";
  if (riskScore >= 4) return "medium";
  return "low";
}

function calculateAveragePayout() {
  if (allPosts.length === 0) return 0;
  const total = allPosts.reduce(
    (sum, post) => sum + parseFloat(post.pending_payout_value || 0),
    0
  );
  return total / allPosts.length;
}

function formatDate(dateString) {
  if (!dateString) return "N/A";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "Data inválida";

    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
      return `Há ${diffMins} min${diffMins !== 1 ? "s" : ""}`;
    } else if (diffHours < 24) {
      return `Há ${diffHours} h${diffHours !== 1 ? "s" : ""}`;
    } else if (diffDays < 7) {
      return `Há ${diffDays} dia${diffDays !== 1 ? "s" : ""}`;
    } else {
      return date.toLocaleDateString("pt-BR");
    }
  } catch (e) {
    return "Data inválida";
  }
}

function showNotification(message, type = "info") {
  // Remover notificações antigas
  const oldNotifications = document.querySelectorAll(".notification");
  oldNotifications.forEach((n) => {
    if (n.parentNode) n.parentNode.removeChild(n);
  });

  // Criar elemento de notificação
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;

  // Ícone baseado no tipo
  let icon = "info-circle";
  if (type === "success") icon = "check-circle";
  else if (type === "error") icon = "exclamation-circle";
  else if (type === "warning") icon = "exclamation-triangle";

  notification.innerHTML = `
        <i class="fas fa-${icon}"></i>
        <span>${message}</span>
    `;

  // Estilos da notificação
  notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === "success" ? "#27ae60" : type === "error" ? "#e74c3c" : type === "warning" ? "#f39c12" : "#3498db"};
        color: white;
        border-radius: 5px;
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        max-width: 400px;
    `;

  document.body.appendChild(notification);

  // Remover após 5 segundos
  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease-out";
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 5000);
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function updateSystemStatus() {
  updateFlaggedCount();

  // Atualizar online users (simulado)
  const onlineUsers = Math.floor(Math.random() * 10) + 1;
  document.getElementById("onlineUsers").textContent = onlineUsers;
}

function updateFlaggedCount() {
  const count = Object.keys(flaggedPosts).length;
  document.getElementById("flaggedCount").textContent = count;
}

// Funções para moderação avançada
/*
function scanForSpam() {
  showNotification("Verificando spam...", "info");

  // Simulação de verificação de spam
  setTimeout(() => {
    const potentialSpam = allPosts.filter((post) => {
      const body = (escapeHTML(post.body) || "").toLowerCase();
      const title = (escapeHTML(post.title) || "").toLowerCase();

      // Critérios para spam
      const spamPatterns = [
        "make money fast",
        "get rich quick",
        "click here",
        "buy now",
        "limited offer",
        "guaranteed profit",
        "work from home",
        "earn $1000 daily",
      ];

      return (
        spamPatterns.some(
          (pattern) => body.includes(pattern) || title.includes(pattern)
        ) || (escapeHTML(post.body) || "").length < 50
      );
    });

    if (potentialSpam.length > 0) {
      const count = potentialSpam.length;
      showNotification(
        `Encontrados ${count} posts suspeitos de spam`,
        "warning"
      );

      // Usar configuração de auto-flag
      if (moderationSettings.autoFlagSpam) {
        potentialSpam.forEach((post) => {
          if (!flaggedPosts[post.id]) {
            flaggedPosts[post.id] = {
              timestamp: new Date().toISOString(),
              flaggedBy: currentUser?.username || "spam-scanner",
              reason: "Potencial spam",
            };
          }
        });
        localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
        updateFlaggedCount();
        loadModerationPanel();
        updatePostsDisplay();
        showNotification(
          `${count} posts sinalizados automaticamente como spam`,
          "info"
        );
      } else {
        // Perguntar se quer sinalizar
        if (confirm(`Deseja sinalizar ${count} posts como spam?`)) {
          potentialSpam.forEach((post) => {
            if (!flaggedPosts[post.id]) {
              flaggedPosts[post.id] = {
                timestamp: new Date().toISOString(),
                flaggedBy: currentUser?.username || "spam-scanner",
                reason: "Potencial spam",
              };
            }
          });
          localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
          updateFlaggedCount();
          loadModerationPanel();
          updatePostsDisplay();
        }
      }
    } else {
      showNotification("Nenhum spam detectado", "success");
    }
  }, 2000);
}
  */

function scanForSpam() {
  showNotification("Verificando spam...", "info");

  setTimeout(() => {

    // --- 1. Agrupar posts por autor ---
    const postsByAuthor = {};
    const shortPostsByAuthor = {};

    allPosts.forEach(post => {
      const author = post.author || "unknown";

      if (!postsByAuthor[author]) postsByAuthor[author] = 0;
      if (!shortPostsByAuthor[author]) shortPostsByAuthor[author] = 0;

      postsByAuthor[author]++;

      const cleanBody = (escapeHTML(post.body) || "");
      if (cleanBody.length < 15) {
        shortPostsByAuthor[author]++;
      }
    });

    // --- 2. DETECTAR SPAM ---
    const potentialSpam = allPosts.filter((post) => {
      const body = (escapeHTML(post.body) || "").toLowerCase();
      const title = (escapeHTML(post.title) || "").toLowerCase();
      const author = post.author || "unknown";

      // Critérios existentes
      const spamPatterns = [
        "make money fast",
        "get rich quick",
        "click here",
        "buy now",
        "limited offer",
        "guaranteed profit",
        "work from home",
        "earn $1000 daily",
      ];

      const hasSpamPatterns = spamPatterns.some(
        (pattern) => body.includes(pattern) || title.includes(pattern)
      );

      //const isTooShort = (escapeHTML(post.body) || "").length < 50;

      // --- NOVOS CRITÉRIOS ----

      // 1. Autor com mais de 50 posts
      const authorHasTooManyPosts = postsByAuthor[author] > 50;

      // 2. Autor com 20+ posts muito curtos
      const authorPostsManyShorts = shortPostsByAuthor[author] > 20;

      return (
        hasSpamPatterns ||
        authorHasTooManyPosts ||
        authorPostsManyShorts
      );
    });

    // --- 3. RESULTADO ---
    if (potentialSpam.length > 0) {
      const count = potentialSpam.length;
      showNotification(
        `Encontrados ${count} posts suspeitos de spam`,
        "warning"
      );

      // Se auto-flag ativado
      if (moderationSettings?.autoFlagSpam) {
        potentialSpam.forEach((post) => {
          if (!flaggedPosts[post.id]) {
            flaggedPosts[post.id] = {
              timestamp: new Date().toISOString(),
              flaggedBy: currentUser?.username || "spam-scanner",
              reason: "Potencial spam",
            };
          }
        });

        localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
        updateFlaggedCount();
        loadModerationPanel();
        updatePostsDisplay();
        showNotification(`${count} posts sinalizados automaticamente como spam`, "info");

      } else {
        // Confirmar manualmente
        if (confirm(`Deseja sinalizar ${count} posts como spam?`)) {
          potentialSpam.forEach((post) => {
            if (!flaggedPosts[post.id]) {
              flaggedPosts[post.id] = {
                timestamp: new Date().toISOString(),
                flaggedBy: currentUser?.username || "spam-scanner",
                reason: "Potencial spam",
              };
            }
          });

          localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
          updateFlaggedCount();
          loadModerationPanel();
          updatePostsDisplay();
        }
      }

    } else {
      showNotification("Nenhum spam detectado", "success");
    }

  }, 2000);
}


// Plagio funções que ajudam

    // Detecta palavras estranhas proibidas, sinais de golpe, menções a dinheiro/transferência, pedidos de contato externo.
function keywordDetector(post, keywords = [], minMatches = 1) {
  const text = (post.title + " " + post.body).toLowerCase();
  let matches = [];
  keywords.forEach(k => {
    if (text.includes(k.toLowerCase())) matches.push(k);
  });
  const score = Math.min(1, matches.length / Math.max(1, minMatches));
  return { score, reason: matches.length ? `keywords:${matches.join(",")}` : null, matches };
}

  //Detecta muitos links, rediretores, domínios conhecidos por spam, urls curtas (bit.ly), links para fora com parâmetros longos.
function linkDetector(post, maxLinks = 2, blacklistDomains = ['bit.ly','tinyurl.com','spamdomain.com']) {
  const urlRegex = /https?:\/\/[^\s]+/g;
  const text = (post.title + " " + post.body) || "";
  const urls = text.match(urlRegex) || [];
  const domains = urls.map(u => {
    try { return (new URL(u)).hostname.replace(/^www\./,''); } catch { return null; }
  }).filter(Boolean);
  const blacklisted = domains.filter(d => blacklistDomains.includes(d));
  const score = Math.min(1, (urls.length > maxLinks ? 1 : urls.length / maxLinks) + (blacklisted.length ? 0.7 : 0));
  return { score, reason: `links:${urls.length}`, urls, blacklisted };
}
  //AI detect
  const STOPWORDS = new Set(['the','and','a','to','of','in','is','that','it','on','for' /*...*/]);

  function aiHeuristicDetector(post) {
    const text = (post.title + " " + post.body || '').toLowerCase();
    const words = text.match(/\b[\w']+\b/g) || [];
    if (words.length < 30) return { score: 0, reason: null }; // muito curto pra avaliar
    // taxa de stopwords
    const stopCount = words.filter(w => STOPWORDS.has(w)).length;
    const stopRatio = stopCount / words.length;
    // repetição de n-gramos
    const ngrams = {};
    for (let i=0;i<words.length-2;i++){
      const ng = words.slice(i,i+3).join(' ');
      ngrams[ng] = (ngrams[ng]||0)+1;
    }
    const repeatNgrams = Object.values(ngrams).filter(v=>v>1).length;
    // heurística combinada
    let score = 0;
    if (stopRatio > 0.5) score += 0.1;
    if (repeatNgrams > Math.max(1, words.length/100)) score += 0.4;
    // penaliza se muitas transições formais
    const transitions = ['however','moreover','furthermore','therefore','consequently'];
    const transCount = words.filter(w=>transitions.includes(w)).length;
    if (transCount > Math.max(1, words.length/200)) score += 0.2;

    return { score: Math.min(1, score), reason: `aiHeuristics stopRatio:${stopRatio.toFixed(2)} repeats:${repeatNgrams}` };
  }

async function scanPostAdvanced(post) {
  const detectors = [
    keywordDetector(post, ['transfer','whatsapp','contact','buy now']),
    linkDetector(post),
    aiHeuristicDetector(post)
  ];

  // soma ponderada
  const weights = [0.6, 0.5, 0.6, 0.7, 0.8, 0.6];
  let total = 0, max = 0;
  const reasons = [];
  detectors.forEach((d,i) => {
    const s = d.score || 0;
    total += s * weights[i];
    max += weights[i];
    if (d.reason) reasons.push(d.reason);
  });
  const finalScore = total / max; // 0..1
  return {score: finalScore, reasons};
}


function scanForPlagiarism() {
  showNotification("Verificando plágio...", "info");

  // Simulação de verificação de plágio
  setTimeout(() => {
    // Verificar conteúdo duplicado
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
        `Encontrados ${count} posts com conteúdo similar`,
        "warning"
      );

      // Usar configuração de auto-flag
      if (moderationSettings?.autoFlagPlagiarism) {
        potentialPlagiarism.forEach((post) => {
          if (!flaggedPosts[post.id]) {
            flaggedPosts[post.id] = {
              timestamp: new Date().toISOString(),
              flaggedBy: currentUser?.username || "plagiarism-scanner",
              reason: "Possível plágio",
            };
          }
        });
        localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
        updateFlaggedCount();
        loadModerationPanel();
        updatePostsDisplay();
        showNotification(
          `${count} posts sinalizados automaticamente por possível plágio`,
          "info"
        );
      } else {
        // Perguntar se quer sinalizar
        if (confirm(`Deseja sinalizar ${count} posts por possível plágio?`)) {
          potentialPlagiarism.forEach((post) => {
            if (!flaggedPosts[post.id]) {
              flaggedPosts[post.id] = {
                timestamp: new Date().toISOString(),
                flaggedBy: currentUser?.username || "plagiarism-scanner",
                reason: "Possível plágio",
              };
            }
          });
          localStorage.setItem("flaggedPosts", JSON.stringify(flaggedPosts));
          updateFlaggedCount();
          loadModerationPanel();
          updatePostsDisplay();
        }
      }
    } else {
      showNotification("Nenhum plágio detectado", "success");
    }
  }, 3000);
}
function escapeHTML(body) {
  // Se não existir ou não for string, retorna vazio
  if (!body || typeof body !== "string") return "";

  // Sanitiza removendo HTML perigoso
  const sanitized = DOMPurify.sanitize(body, {
    ALLOWED_TAGS: [], // remove TODAS as tags HTML
    ALLOWED_ATTR: [], // remove TODOS os atributos
  });

  return sanitized;
}

function selectAllPosts() {
  const selectAll = document.getElementById("selectAll");
  const checkboxes = document.querySelectorAll(".post-checkbox");
  checkboxes.forEach((cb) => (cb.checked = selectAll.checked));
}

// Funções para interagir com a API
async function showCacheStats() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/cache/active/stats`);
    if (!response.ok) throw new Error("Erro na resposta");

    const stats = await response.json();

    alert(`
Estatísticas do Cache:
• Posts em cache: ${stats.activeCache?.totalPosts || 0}
• Última atualização: ${stats.activeCache?.lastUpdate || "N/A"}
• Data do último post: ${stats.activeCache?.lastPostDate || "N/A"}
• Uso de memória: ${stats.activeCache?.memoryUsage || "N/A"}
• Status Redis: ${stats.redis?.connected ? "✅ Conectado" : "❌ Desconectado"}
        `);
  } catch (error) {
    showNotification("Erro ao buscar estatísticas do cache", "error");
  }
}

async function clearCache() {
  return new Promise(resolve => {
    const keys = [
      'flaggedPosts',
      'mutedUsers',
      'moderationSettings'
    ];

    // Limpa localStorage
    keys.forEach(k => localStorage.removeItem(k));

    // Resetar o objeto em memória
    moderationSettings = {
      autoFlagSpam: true,
      autoFlagPlagiarism: true,
      notifyHighPayout: true,
      payoutAlertThreshold: 100,
      theme: "light",
      postsPerPage: 25,
      mutedUsers: [], // array limpo
    };

    // Atualizar a interface de posts
    refreshPostsDisplay();

    // Se tiver modal de usuários mutados aberto, atualizar também
    if (typeof openMutedUsersManager === "function") {
      openMutedUsersManager();
    }

    resolve(true);
  });
}



// Mostrar detalhes do post
function showPostDetail(post) {
  const modal = document.getElementById("postDetailModal");
  const title = document.getElementById("postDetailTitle");
  const body = document.getElementById("postDetailBody");

  title.textContent = escapeHTML(post.title) || "Detalhes do Post";

  // Formatando o conteúdo
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

  // Adicionar event listeners aos botões dentro do modal
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

  // Adicionar listener para fechar modal
  modal.querySelector(".close-modal").addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  // Fechar ao clicar fora
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
}

// Funções adicionais
function viewAuthorPosts(author) {
  document.getElementById("searchInput").value = author;
  document.getElementById("searchFilter").value = "author";
  searchPosts();
  document.querySelector('[data-section="posts"]').click();
}

function moderateAuthor(author) {
  showNotification(`Moderação para autor: ${author}`, "info");
  viewAuthorPosts(author);
}

function openModerationPanel(post) {
  showPostDetail(post);
}

function deletePost(postId) {
  showNotification("Funcionalidade de deleção seria implementada aqui", "info");
  // Em produção: enviar para API marcar como deletado
}

// Adicionar CSS para notificações e estilos extras
const additionalStyles = document.createElement("style");
additionalStyles.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    
    .no-posts, .no-results {
        text-align: center;
        padding: 3rem;
        color: #666;
        font-size: 1.2rem;
        grid-column: 1 / -1;
    }
    
    .post-detail-header {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-bottom: 1.5rem;
        padding: 1rem;
        background: #f8f9fa;
        border-radius: 8px;
    }
    
    .post-detail-content .content-box {
        max-height: 300px;
        overflow-y: auto;
        padding: 1rem;
        background: #f8f9fa;
        border-radius: 5px;
        margin: 1rem 0;
        white-space: pre-wrap;
        font-family: monospace;
    }
    
    .post-detail-actions {
        display: flex;
        gap: 1rem;
        margin: 2rem 0;
        flex-wrap: wrap;
    }
    
    .post-detail-metadata pre {
        max-height: 200px;
        overflow-y: auto;
        background: #2c3e50;
        color: white;
        padding: 1rem;
        border-radius: 5px;
        font-size: 0.9rem;
    }
    
    .ranking-rank.first {
        background: #FFD700;
        color: #000;
    }
    
    .ranking-rank.second {
        background: #C0C0C0;
        color: #000;
    }
    
    .ranking-rank.third {
        background: #CD7F32;
        color: #000;
    }
    
    .text-danger {
        color: #e74c3c;
    }
    
    .error-message {
        text-align: center;
        padding: 3rem;
        color: #e74c3c;
        background: #ffeaea;
        border-radius: 10px;
        margin: 2rem 0;
    }
    
    .error-message i {
        font-size: 3rem;
        margin-bottom: 1rem;
    }
    
    .flag-details {
        padding: 1rem;
        background: #fff3cd;
        border-top: 1px solid #ffeaa7;
        border-radius: 0 0 10px 10px;
    }
    
    .search-result-item {
        background: white;
        padding: 1.5rem;
        margin-bottom: 1rem;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .search-result-item h5 {
        color: #2c3e50;
        margin-bottom: 0.5rem;
    }
    
    .search-result-item .excerpt {
        color: #666;
        font-size: 0.9rem;
        margin: 0.5rem 0;
    }
    
    .search-summary {
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 2px solid #3498db;
    }
    
    /* Estilos para temas */
    .theme-dark {
        --primary-color: #3498db;
        --secondary-color: #2c3e50;
        --background-color: #1a1a1a;
        --text-color: #ffffff;
        --card-background: #2d2d2d;
        --border-color: #404040;
        --light-color: #2d2d2d;
        --danger-color: #e74c3c;
        --success-color: #27ae60;
        --warning-color: #f39c12;
        --info-color: #1abc9c;
    }
    
    .theme-dark body {
        background-color: var(--background-color);
        color: var(--text-color);
    }
    
    .theme-dark .post-card,
    .theme-dark .ranking-container,
    .theme-dark .moderation-table-container,
    .theme-dark .stat-chart,
    .theme-dark .summary-card,
    .theme-dark .search-form,
    .theme-dark .search-result-item,
    .theme-dark .modal-content,
    .theme-dark .sidebar,
    .theme-dark .toolbar {
        background-color: var(--card-background);
        color: var(--text-color);
        border-color: var(--border-color);
    }
    
    .theme-dark .modal-content {
        background-color: var(--card-background);
        color: var(--text-color);
    }
    
    .theme-dark .modal-content .form-input,
    .theme-dark .modal-content select,
    .theme-dark .modal-content input[type="number"] {
        background-color: #3d3d3d;
        color: var(--text-color);
        border-color: var(--border-color);
    }
    
    .theme-dark .setting-item {
        background-color: #3d3d3d;
    }
    
    .theme-dark .btn-primary {
        background-color: var(--primary-color);
        color: white;
    }
    
    .theme-dark .post-detail-content .content-box {
        background-color: #3d3d3d;
        color: var(--text-color);
    }
    
    .theme-dark .post-detail-metadata pre {
        background-color: #2c3e50;
        color: white;
    }
    
    .theme-dark .navbar {
        background-color: var(--secondary-color);
    }
    
    .theme-dark .post-card-header {
        background-color: var(--primary-color);
    }
    
    .theme-dark .sidebar-section h3,
    .theme-dark .section-header h2,
    .theme-dark .search-summary h4 {
        color: var(--text-color);
    }
    
    .theme-dark .status-label,
    .theme-dark .post-excerpt,
    .theme-dark .ranking-stat {
        color: #cccccc;
    }
`;
document.head.appendChild(additionalStyles);
