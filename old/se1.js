// ==================== CONFIGURAÇÃO E ESTADO ====================
const AppState = {
    currentUser: JSON.parse(localStorage.getItem("currentUser") || "null"),
    allPosts: [],
    filteredPosts: [],
    flaggedPosts: JSON.parse(localStorage.getItem("flaggedPosts") || "{}"),
    currentPage: 1,
    flaggedCurrentPage: 1,
    postsPerPage: 25,
    flaggedPostsPerPage: 25,
    
    // Cache para otimização
    _cache: {
        authorStats: null,
        riskLevels: new Map(),
        appCounts: null,
        flaggedPostIds: null
    }
};

// Configurações com getter/setter
const ModerationSettings = (() => {
    const DEFAULT_SETTINGS = {
        autoFlagSpam: true,
        autoFlagPlagiarism: true,
        notifyHighPayout: true,
        payoutAlertThreshold: 100,
        theme: "light",
        postsPerPage: 25,
        mutedUsers: []
    };

    let settings = { ...DEFAULT_SETTINGS };

    return {
        load() {
            try {
                const saved = JSON.parse(localStorage.getItem("moderationSettings") || "{}");
                settings = {
                    ...DEFAULT_SETTINGS,
                    ...saved,
                    mutedUsers: JSON.parse(localStorage.getItem("mutedUsers") || "[]")
                };
                return settings;
            } catch (e) {
                console.error("Erro ao carregar configurações:", e);
                return settings;
            }
        },

        save() {
            try {
                localStorage.setItem("moderationSettings", JSON.stringify(settings));
                localStorage.setItem("mutedUsers", JSON.stringify(settings.mutedUsers));
                return true;
            } catch (e) {
                console.error("Erro ao salvar configurações:", e);
                return false;
            }
        },

        get(key) {
            return settings[key];
        },

        set(key, value) {
            settings[key] = value;
            return this.save();
        },

        getAll() {
            return { ...settings };
        },

        isUserMuted(username) {
            return Array.isArray(settings.mutedUsers) && 
                   settings.mutedUsers.includes(username);
        },

        muteUser(username) {
            if (!settings.mutedUsers.includes(username)) {
                settings.mutedUsers.push(username);
                this.save();
                return true;
            }
            return false;
        },

        unmuteUser(username) {
            const index = settings.mutedUsers.indexOf(username);
            if (index !== -1) {
                settings.mutedUsers.splice(index, 1);
                this.save();
                return true;
            }
            return false;
        }
    };
})();

// ==================== UTILITÁRIOS ====================
const Utils = {
    escapeHTML(text) {
        if (!text || typeof text !== "string") return "";
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    formatDate(dateString) {
        if (!dateString) return "N/A";
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return "Data inválida";

            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 60) return `Há ${diffMins} min${diffMins !== 1 ? 's' : ''}`;
            if (diffHours < 24) return `Há ${diffHours} h${diffHours !== 1 ? 's' : ''}`;
            if (diffDays < 7) return `Há ${diffDays} dia${diffDays !== 1 ? 's' : ''}`;
            
            return date.toLocaleDateString("pt-BR");
        } catch (e) {
            return "Data inválida";
        }
    },

    debounce(func, wait, immediate = false) {
        let timeout;
        return function executedFunction(...args) {
            const context = this;
            const later = () => {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(context, args);
        };
    },

    throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    normalizeTags(tags) {
        if (!tags) return "";
        if (Array.isArray(tags)) return tags.join(" ").toLowerCase();
        return String(tags).toLowerCase();
    },

    calculatePayout(post) {
        return parseFloat(post.pending_payout_value || 0);
    }
};

// ==================== SISTEMA DE NOTIFICAÇÕES ====================
const NotificationSystem = {
    queue: [],
    isShowing: false,

    show(message, type = "info", duration = 5000) {
        this.queue.push({ message, type, duration });
        if (!this.isShowing) this._showNext();
    },

    _showNext() {
        if (this.queue.length === 0) {
            this.isShowing = false;
            return;
        }

        this.isShowing = true;
        const { message, type, duration } = this.queue.shift();

        // Remover notificações antigas
        document.querySelectorAll('.notification').forEach(n => n.remove());

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };

        notification.innerHTML = `
            <i class="fas fa-${icons[type] || 'info-circle'}"></i>
            <span>${message}</span>
        `;

        Object.assign(notification.style, {
            position: 'fixed',
            top: '100px',
            right: '20px',
            padding: '15px 20px',
            background: this._getColor(type),
            color: 'white',
            borderRadius: '5px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            zIndex: '10000',
            animation: 'slideIn 0.3s ease-out',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            maxWidth: '400px'
        });

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => {
                notification.remove();
                this._showNext();
            }, 300);
        }, duration);
    },

    _getColor(type) {
        const colors = {
            success: '#27ae60',
            error: '#e74c3c',
            warning: '#f39c12',
            info: '#3498db'
        };
        return colors[type] || colors.info;
    }
};

// ==================== SISTEMA DE CACHE ====================
const CacheManager = {
    authorStats: null,
    appCounts: null,
    riskCache: new Map(),

    clear() {
        this.authorStats = null;
        this.appCounts = null;
        this.riskCache.clear();
        AppState._cache.authorStats = null;
        AppState._cache.appCounts = null;
        AppState._cache.riskLevels.clear();
    },

    updateAuthorStats(posts) {
        const stats = {};
        posts.forEach(post => {
            const author = post.author;
            if (!stats[author]) {
                stats[author] = {
                    posts: 0,
                    totalPayout: 0,
                    shortPosts: 0,
                    lastPost: post.created
                };
            }
            stats[author].posts++;
            stats[author].totalPayout += Utils.calculatePayout(post);
            if ((Utils.escapeHTML(post.body) || "").length < 50) {
                stats[author].shortPosts++;
            }
            if (new Date(post.created) > new Date(stats[author].lastPost)) {
                stats[author].lastPost = post.created;
            }
        });
        this.authorStats = stats;
        AppState._cache.authorStats = stats;
        return stats;
    },

    getAuthorStats(author) {
        if (!this.authorStats) this.updateAuthorStats(AppState.allPosts);
        return this.authorStats[author] || { posts: 0, totalPayout: 0, shortPosts: 0 };
    },

    calculateRiskLevel(post) {
        const cacheKey = `${post.id}_${post.author}`;
        if (this.riskCache.has(cacheKey)) {
            return this.riskCache.get(cacheKey);
        }

        let riskScore = 0;
        const authorStats = this.getAuthorStats(post.author);
        const payout = Utils.calculatePayout(post);
        const body = Utils.escapeHTML(post.body) || "";

        // Critérios de risco
        if (authorStats.posts > 200) riskScore += 4;
        else if (authorStats.posts > 100) riskScore += 3;
        else if (authorStats.posts > 50) riskScore += 2;
        else if (authorStats.posts > 15 && body.length < 50) riskScore += 2;

        if (payout > 500) riskScore += 3;
        else if (payout > 100) riskScore += 1;

        // Detecção de comandos
        const commandRegex = /\!(bbh|lady|vote|gif|pizza|beer|pepe|meme|cpt|summarize)\b/i;
        if (commandRegex.test(body)) riskScore += 2;

        // Tags suspeitas
        const suspiciousTags = ["make-money", "earn-fast", "crypto-scam", "get-rich", "instant-cash"];
        if (post.tags) {
            const tagsString = Utils.normalizeTags(post.tags);
            if (suspiciousTags.some(tag => tagsString.includes(tag))) {
                riskScore += 3;
            }
        }

        // Já sinalizado
        if (AppState.flaggedPosts[post.id]) riskScore += 4;

        const riskLevel = riskScore >= 7 ? "high" : riskScore >= 4 ? "medium" : "low";
        this.riskCache.set(cacheKey, riskLevel);
        AppState._cache.riskLevels.set(cacheKey, riskLevel);
        
        return riskLevel;
    }
};

// ==================== SISTEMA DE POSTS ====================
const PostManager = {
    async loadPosts() {
        const loadingElement = document.getElementById("loadingPosts");
        if (loadingElement) loadingElement.classList.remove("hidden");

        try {
            const response = await fetch("./data.json");
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const text = await response.text();
            const cleanedText = text.replace(/\\\\/g, "\\");
            const lines = cleanedText.split("\n").filter(line => line.trim() !== "");
            
            const data = lines.map((line, index) => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    console.error(`Erro no parsing da linha ${index + 1}:`, e);
                    return null;
                }
            }).filter(item => item !== null);

            AppState.allPosts = data;
            AppState.filteredPosts = [...data];
            AppState.currentPage = 1;

            CacheManager.clear();
            CacheManager.updateAuthorStats(data);

            this.updateDisplay();
            NotificationSystem.show(`Carregados ${data.length} posts`, "success");

            // Atualizar cache UI
            if (document.getElementById("cacheCount")) {
                document.getElementById("cacheCount").textContent = data.length;
                document.getElementById("lastUpdate").textContent = "Agora";
            }

            return data;
        } catch (error) {
            console.error("Erro ao carregar posts:", error);
            NotificationSystem.show("Erro ao carregar posts. Verifique o arquivo 'data.json'.", "error");
            
            const container = document.getElementById("postsContainer");
            if (container) {
                container.innerHTML = `
                    <div class="error-message">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h3>Falha ao Processar Dados</h3>
                        <p>Verifique se o arquivo data.json existe e está acessível.</p>
                        <button onclick="PostManager.loadPosts()" class="btn-primary">
                            <i class="fas fa-sync-alt"></i> Tentar novamente
                        </button>
                    </div>
                `;
            }
            return [];
        } finally {
            if (loadingElement) loadingElement.classList.add("hidden");
        }
    },

    updateDisplay() {
        const container = document.getElementById("postsContainer");
        const pageInfo = document.getElementById("pageInfo");
        if (!container || !pageInfo) return;

        // Filtrar posts de usuários mutados
        const postsToShow = AppState.filteredPosts.filter(post => 
            !ModerationSettings.isUserMuted(post.author)
        );

        if (postsToShow.length === 0) {
            container.innerHTML = '<div class="no-posts">Nenhum post encontrado</div>';
            pageInfo.textContent = "Página 1 de 1";
            return;
        }

        const startIndex = (AppState.currentPage - 1) * AppState.postsPerPage;
        const endIndex = startIndex + AppState.postsPerPage;
        const pagePosts = postsToShow.slice(startIndex, endIndex);

        const totalPages = Math.ceil(postsToShow.length / AppState.postsPerPage);
        pageInfo.textContent = `Página ${AppState.currentPage} de ${totalPages}`;

        // Usar DocumentFragment para melhor performance
        const fragment = document.createDocumentFragment();
        pagePosts.forEach(post => {
            fragment.appendChild(this.createPostCard(post));
        });

        container.innerHTML = "";
        container.appendChild(fragment);

        // Atualizar paginação
        const prevBtn = document.getElementById("prevPage");
        const nextBtn = document.getElementById("nextPage");
        if (prevBtn) prevBtn.disabled = AppState.currentPage === 1;
        if (nextBtn) nextBtn.disabled = AppState.currentPage === totalPages;
    },

    createPostCard(post) {
        const div = document.createElement("div");
        div.className = "post-card";
        div.dataset.id = post.id;

        const isFlagged = AppState.flaggedPosts[post.id];
        const riskLevel = CacheManager.calculateRiskLevel(post);
        const payout = Utils.calculatePayout(post);
        const title = Utils.escapeHTML(post.title) || "";
        const shortTitle = title.length > 50 ? title.substring(0, 50) + "..." : title;
        const content = Utils.escapeHTML(post.body) || "Sem conteúdo";
        const shortContent = content.length > 150 ? content.substring(0, 150) + "..." : content;

        let tagsHtml = "";
        if (post.tags) {
            const tagArray = Array.isArray(post.tags) ? post.tags.slice(0, 3) : 
                           post.tags.split(",").slice(0, 3);
            tagsHtml = tagArray.map(tag => 
                `<span class="post-tag">${tag.trim()}</span>`
            ).join("");
        }

        const isMuted = ModerationSettings.isUserMuted(post.author);

        div.innerHTML = `
            <div class="post-card-header ${post.parent_author ? "parented" : ""}">
                <span class="post-author">@${post.author}</span>
                ${post.parent_author ? '<span class="post-type">Comentário</span>' : '<span class="post-type">Post</span>'}
                <span class="post-payout">$${payout.toFixed(2)}</span>
            </div>
            <div class="post-card-body">
                <h3 class="post-title">${shortTitle}</h3>
                <p class="post-excerpt">${shortContent}</p>
                ${tagsHtml ? `<div class="post-tags">${tagsHtml}</div>` : ''}
                <div class="risk-badge risk-${riskLevel}">${riskLevel.toUpperCase()}</div>
                <div class="post-app">App: ${post.json_metadata?.app || "Desconhecido"}</div>
            </div>
            <div class="post-card-footer">
                <span class="post-date">${Utils.formatDate(post.created)}</span>
                <div class="post-actions">
                    <button class="btn-icon view-post" title="Ver detalhes">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn-icon flag-post ${isFlagged ? "flagged" : ""}" 
                            title="${isFlagged ? "Remover flag" : "Sinalizar"}">
                        <i class="fas fa-flag"></i>
                    </button>
                    <button class="btn-icon moderate-post" title="Moderar">
                        <i class="fas fa-user-shield"></i>
                    </button>
                    <button class="btn-icon mute-user-btn ${isMuted ? "muted" : ""}" 
                            title="${isMuted ? "Desmutar usuário" : "Mutuar usuário"}">
                        <i class="fas ${isMuted ? "fa-volume-up" : "fa-volume-mute"}"></i>
                    </button>
                </div>
            </div>
        `;

        // Event listeners
        const addClickListener = (selector, handler) => {
            const btn = div.querySelector(selector);
            if (btn) btn.addEventListener("click", handler);
        };

        addClickListener(".view-post", () => this.showPostDetail(post));
        addClickListener(".flag-post", () => this.toggleFlag(post.id));
        addClickListener(".moderate-post", () => this.openModerationPanel(post));
        addClickListener(".mute-user-btn", (e) => {
            e.stopPropagation();
            this.toggleMuteUser(post.author, div.querySelector(".mute-user-btn"));
        });

        return div;
    },

    toggleFlag(postId) {
        if (AppState.flaggedPosts[postId]) {
            delete AppState.flaggedPosts[postId];
            NotificationSystem.show("Flag removida do post", "info");
        } else {
            const post = AppState.allPosts.find(p => p.id == postId);
            AppState.flaggedPosts[postId] = {
                timestamp: new Date().toISOString(),
                flaggedBy: AppState.currentUser?.username || "system",
                reason: "Moderação manual"
            };
            NotificationSystem.show("Post sinalizado para revisão", "warning");

            // Notificar payout alto
            if (post && ModerationSettings.get("notifyHighPayout")) {
                const payout = Utils.calculatePayout(post);
                const threshold = ModerationSettings.get("payoutAlertThreshold");
                if (payout > threshold) {
                    NotificationSystem.show(
                        `⚠️ Post com alto payout ($${payout.toFixed(2)}) sinalizado!`,
                        "warning"
                    );
                }
            }
        }

        localStorage.setItem("flaggedPosts", JSON.stringify(AppState.flaggedPosts));
        this.updateFlaggedCount();
        this.updateDisplay();
    },

    toggleMuteUser(username, buttonElement) {
        if (ModerationSettings.isUserMuted(username)) {
            if (ModerationSettings.unmuteUser(username)) {
                NotificationSystem.show(`Usuário ${username} desmutado!`, "info");
                if (buttonElement) {
                    buttonElement.classList.remove("muted");
                    buttonElement.title = "Mutuar usuário";
                    buttonElement.innerHTML = '<i class="fas fa-volume-mute"></i>';
                }
            }
        } else {
            if (ModerationSettings.muteUser(username)) {
                NotificationSystem.show(`Usuário ${username} mutado com sucesso!`, "warning");
                if (buttonElement) {
                    buttonElement.classList.add("muted");
                    buttonElement.title = "Desmutar usuário";
                    buttonElement.innerHTML = '<i class="fas fa-volume-up"></i>';
                }
            }
        }
        this.updateDisplay();
    },

    updateFlaggedCount() {
        const count = Object.keys(AppState.flaggedPosts).length;
        const element = document.getElementById("flaggedCount");
        if (element) element.textContent = count;
    },

    showPostDetail(post) {
        // Implementação similar à original, mas otimizada
        console.log("Detalhes do post:", post);
        // ... (mantenha sua implementação, mas use Utils.escapeHTML)
    }
};

// ==================== SISTEMA DE LOGIN ====================
const AuthManager = {
    async loginWithKeychain(username) {
        if (!window.hive_keychain) {
            NotificationSystem.show("Hive Keychain não está instalado!", "error");
            return false;
        }

        return new Promise((resolve) => {
            window.hive_keychain.requestSignBuffer(
                username,
                "Login Hive Moderation Dashboard",
                "Posting",
                (response) => {
                    if (response.success) {
                        AppState.currentUser = {
                            username: username,
                            role: "moderator",
                            loginMethod: "keychain"
                        };
                        localStorage.setItem("currentUser", JSON.stringify(AppState.currentUser));
                        this.updateUI();
                        NotificationSystem.show("Login realizado com sucesso!", "success");
                        resolve(true);
                    } else {
                        NotificationSystem.show("Falha no login com Keychain", "error");
                        resolve(false);
                    }
                }
            );
        });
    },

    loginManual(username, password) {
        if (username && password) {
            AppState.currentUser = {
                username: username,
                role: "moderator",
                loginMethod: "manual"
            };
            localStorage.setItem("currentUser", JSON.stringify(AppState.currentUser));
            this.updateUI();
            NotificationSystem.show("Login manual realizado!", "success");
            return true;
        }
        NotificationSystem.show("Preencha todos os campos", "warning");
        return false;
    },

    logout() {
        AppState.currentUser = null;
        localStorage.removeItem("currentUser");
        document.getElementById("loginModal")?.classList.remove("hidden");
        document.getElementById("logoutBtn")?.classList.add("hidden");
        document.getElementById("currentUser").textContent = "Não logado";
        NotificationSystem.show("Logout realizado", "info");
    },

    updateUI() {
        if (AppState.currentUser) {
            document.getElementById("currentUser").textContent = AppState.currentUser.username;
            document.getElementById("logoutBtn")?.classList.remove("hidden");
            document.getElementById("settingsBtn")?.classList.remove("hidden");
            document.getElementById("loginModal")?.classList.add("hidden");
        }
    }
};

// ==================== SISTEMA DE BUSCA ====================
const SearchManager = {
    searchPosts() {
        const searchTerm = document.getElementById("searchInput")?.value.toLowerCase() || "";
        const filterType = document.getElementById("searchFilter")?.value || "all";

        if (!searchTerm) {
            AppState.filteredPosts = [...AppState.allPosts];
        } else {
            AppState.filteredPosts = AppState.allPosts.filter(post => {
                switch (filterType) {
                    case "author":
                        return post.author.toLowerCase().includes(searchTerm);
                    case "title":
                        return (Utils.escapeHTML(post.title) || "").toLowerCase().includes(searchTerm);
                    case "content":
                        return (Utils.escapeHTML(post.body) || "").toLowerCase().includes(searchTerm);
                    case "tags":
                        return Utils.normalizeTags(post.tags).includes(searchTerm);
                    default:
                        return (
                            post.author.toLowerCase().includes(searchTerm) ||
                            (Utils.escapeHTML(post.title) || "").toLowerCase().includes(searchTerm) ||
                            (Utils.escapeHTML(post.body) || "").toLowerCase().includes(searchTerm) ||
                            Utils.normalizeTags(post.tags).includes(searchTerm)
                        );
                }
            });
        }

        AppState.currentPage = 1;
        PostManager.updateDisplay();
    },

    applyFilter(filterType) {
        const now = new Date();
        let filterFn;

        switch (filterType) {
            case "last-hour":
                const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
                filterFn = post => new Date(post.created) > oneHourAgo;
                break;
            case "last-6h":
                const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
                filterFn = post => new Date(post.created) > sixHoursAgo;
                break;
            case "high-payout":
                filterFn = post => Utils.calculatePayout(post) > 100;
                break;
            case "flagged":
                filterFn = post => AppState.flaggedPosts[post.id];
                break;
            case "deleted":
                filterFn = post => post.deleted === true;
                break;
            default:
                AppState.filteredPosts = [...AppState.allPosts];
                PostManager.updateDisplay();
                return;
        }

        AppState.filteredPosts = AppState.allPosts.filter(filterFn);
        AppState.currentPage = 1;
        PostManager.updateDisplay();
    }
};



// ==================== SETUP DE EVENT LISTENERS ====================
function setupEventListeners() {
    // Busca
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("input", 
            Utils.debounce(() => SearchManager.searchPosts(), 300)
        );
    }

    // Paginação
    document.getElementById("prevPage")?.addEventListener("click", () => {
        if (AppState.currentPage > 1) {
            AppState.currentPage--;
            PostManager.updateDisplay();
        }
    });

    document.getElementById("nextPage")?.addEventListener("click", () => {
        const totalPages = Math.ceil(AppState.filteredPosts.length / AppState.postsPerPage);
        if (AppState.currentPage < totalPages) {
            AppState.currentPage++;
            PostManager.updateDisplay();
        }
    });

    // Filtros rápidos
    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", function() {
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            this.classList.add("active");
            SearchManager.applyFilter(this.getAttribute("data-filter"));
        });
    });

    // Login
    document.getElementById("hiveKeychainLogin")?.addEventListener("click", () => {
        const username = prompt("Digite seu nome de usuário Hive:");
        if (username) AuthManager.loginWithKeychain(username);
    });

    document.getElementById("submitManualLogin")?.addEventListener("click", () => {
        const username = document.getElementById("username")?.value;
        const password = document.getElementById("password")?.value;
        if (username && password) AuthManager.loginManual(username, password);
    });

    document.getElementById("logoutBtn")?.addEventListener("click", () => AuthManager.logout());

    // Refresh
    document.getElementById("refreshBtn")?.addEventListener("click", () => PostManager.loadPosts());

    // Configurações
    document.getElementById("settingsBtn")?.addEventListener("click", () => this.openSettingsModal());
}

// ==================== FUNÇÕES AUXILIARES ====================
function startPeriodicUpdates() {
    // Atualizar status a cada 30 segundos
    setInterval(() => {
        const onlineUsers = Math.floor(Math.random() * 10) + 1;
        const element = document.getElementById("onlineUsers");
        if (element) element.textContent = onlineUsers;
    }, 30000);
}

function openSettingsModal() {
    const modal = document.getElementById("settingsModal");
    if (!modal) return;

    const settings = ModerationSettings.getAll();
    
    document.getElementById("autoFlagSpam").checked = settings.autoFlagSpam;
    document.getElementById("autoFlagPlagiarism").checked = settings.autoFlagPlagiarism;
    document.getElementById("notifyHighPayout").checked = settings.notifyHighPayout;
    document.getElementById("payoutAlertThreshold").value = settings.payoutAlertThreshold;
    document.getElementById("themeSelect").value = settings.theme;
    document.getElementById("postsPerPageSetting").value = settings.postsPerPage;

    modal.classList.remove("hidden");
}

// ==================== EXPORT PARA HTML ====================
// Expõe funções necessárias para o HTML
window.App = {
    PostManager,
    AuthManager,
    SearchManager,
    ModerationSettings,
    Utils,
    NotificationSystem,
    
    // Funções específicas para eventos HTML
    toggleFlag: (postId) => PostManager.toggleFlag(postId),
    loadPosts: () => PostManager.loadPosts(),
    loginWithKeychain: () => {
        const username = prompt("Digite seu nome de usuário Hive:");
        if (username) AuthManager.loginWithKeychain(username);
    }
};

// ==================== INICIALIZAÇÃO ====================
document.addEventListener("DOMContentLoaded", async function() {
    // Carregar configurações
    ModerationSettings.load();
    
    // Inicializar sistemas
    await PostManager.loadPosts();
    
    // Configurar event listeners
    setupEventListeners();
    
    // Atualizar UI inicial
    if (AppState.currentUser) AuthManager.updateUI();
    
    // Iniciar atualizações periódicas
    startPeriodicUpdates();
});