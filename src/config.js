// src/config.js

// Variáveis de Estado
export let currentUser = null;
export let allPosts = [];
export let filteredPosts = [];
export let currentPage = 1;
export let postsPerPage = 25;
export let flaggedPosts = JSON.parse(localStorage.getItem("flaggedPosts") || "{}");
let postTypeFilter = 'all'; 
let appFilter = 'all';
let domainFilter = 'all';
export let sortCriteria = 'created-desc';

export let flaggedCurrentPage = 1;
export const flaggedPostsPerPage = 25;

// Configurações Padrão
export let moderationSettings = {
  autoFlagSpam: true,
  autoFlagPlagiarism: true,
  notifyHighPayout: true,
  payoutAlertThreshold: 100,
  theme: "light",
  postsPerPage: 25,
  mutedUsers: JSON.parse(localStorage.getItem("mutedUsers") || "[]"),
};

// Funções para alterar o estado (necessárias para reatribuir `let` exportadas)
export function setAllPosts(posts) {
  allPosts = posts;
}

export function setFilteredPosts(posts) {
  filteredPosts = posts;
}

export function setPostsPerPage(perPage) {
  postsPerPage = perPage;
}

export function setCurrentPage(page) {
  currentPage = page;
}

export function setModerationSettings(settings) {
  moderationSettings = settings;
}

export function setCurrentUser(user) {
    currentUser = user;
}

export function setFlaggedCurrentPage(page) {
    flaggedCurrentPage = page;
}



export function setPostTypeFilter(newFilter) {
    postTypeFilter = newFilter;
}

export function getPostTypeFilter() {
    return postTypeFilter;
}

export function setAppFilter(newFilter) {
    appFilter = newFilter;
}

export function getAppFilter() {
    return appFilter;
}

export function setDomainFilter(newFilter) {
    domainFilter = newFilter || 'all';
}

export function getDomainFilter() {
    return domainFilter;
}

// NOVO SETTER
export function setSortCriteria(newCriteria) {
    sortCriteria = newCriteria;
}

// NOVO GETTER
export function getSortCriteria() {
    return sortCriteria;
}

// Modo de Visualização (Grid vs List)
export let viewMode = localStorage.getItem('hive_posts_view_mode') || 'grid';

export function setViewMode(newMode) {
    viewMode = newMode === 'list' ? 'list' : 'grid';
    localStorage.setItem('hive_posts_view_mode', viewMode);
}

export function getViewMode() {
    return viewMode;
}

// Filtro de Blacklist On-Chain ('hide-blacklisted' | 'all' | 'only-blacklisted')
export let blacklistFilter = localStorage.getItem('hive_mod_blacklist_filter') || 'hide-blacklisted';

export function setBlacklistFilter(newFilter) {
    blacklistFilter = newFilter;
    localStorage.setItem('hive_mod_blacklist_filter', newFilter);
}

export function getBlacklistFilter() {
    return blacklistFilter;
}

// Filtro de Reputação Máxima (para ocultar autores com reputação acima de X e filtrar abusadores novos)
const storedMaxRep = localStorage.getItem('hive_mod_max_rep_filter');
export let maxReputationFilter = storedMaxRep !== null && storedMaxRep !== '' && !isNaN(parseInt(storedMaxRep, 10))
    ? parseInt(storedMaxRep, 10)
    : null;

export function setMaxReputationFilter(newVal) {
    if (newVal === null || newVal === undefined || newVal === '' || newVal === 'all') {
        maxReputationFilter = null;
        localStorage.removeItem('hive_mod_max_rep_filter');
    } else {
        const parsed = parseInt(newVal, 10);
        maxReputationFilter = isNaN(parsed) ? null : parsed;
        if (maxReputationFilter !== null) {
            localStorage.setItem('hive_mod_max_rep_filter', String(maxReputationFilter));
        } else {
            localStorage.removeItem('hive_mod_max_rep_filter');
        }
    }
}

export function getMaxReputationFilter() {
    return maxReputationFilter;
}

// Modo de Sincronização de Reputação ('hybrid_rpc' | 'hafsql')
export let reputationSyncMode = localStorage.getItem('hive_mod_rep_sync_mode') || 'hybrid_rpc';

export function setReputationSyncMode(newMode) {
    reputationSyncMode = newMode === 'hafsql' ? 'hafsql' : 'hybrid_rpc';
    localStorage.setItem('hive_mod_rep_sync_mode', reputationSyncMode);
}

export function getReputationSyncMode() {
    return reputationSyncMode;
}
