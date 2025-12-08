// src/config.js

// Variáveis de Estado
export let currentUser = null;
export let allPosts = [];
export let filteredPosts = [];
export let currentPage = 1;
export let postsPerPage = 25;
export let flaggedPosts = JSON.parse(localStorage.getItem("flaggedPosts") || "{}");
let postTypeFilter = 'all'; 
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

// NOVO SETTER
export function setSortCriteria(newCriteria) {
    sortCriteria = newCriteria;
}

// NOVO GETTER
export function getSortCriteria() {
    return sortCriteria;
}