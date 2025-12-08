// src/utils/statsCalculators.js

import { allPosts, flaggedPosts, setPostsPerPage } from '../config.js';
import { formatDate } from './helpers.js';
import { showNotification } from '../ui/notifications.js';
import { updateSystemStatus } from '../ui/domHelpers.js';
import { viewAuthorPosts, moderateAuthor } from '../ui/modals.js'; // Importar funções de ação


let chartInstances = {};
export let authorStatsMap = new Map();

// Mova loadRankingByPosts para cá
export function loadRankingByPosts() {
  const timeFilter = parseInt(
    document.getElementById("rankingTimeFilter").value
  );
  const cutoffDate = new Date(Date.now() - timeFilter * 60 * 60 * 1000);

  const authorStats = {};

  allPosts.forEach((post) => {
    // ... corpo da função ...
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
    .sort((a, b) => b.posts - a.posts)
    .slice(0, 100);

  displayRanking(ranking, "posts", "rankingPostsContainer");
}

// Mova loadRankingByPayout para cá
export function loadRankingByPayout() {
  const timeFilter = parseInt(
    document.getElementById("payoutTimeFilter").value
  );
  const cutoffDate = new Date(Date.now() - timeFilter * 60 * 60 * 1000);

  const authorStats = {};

  allPosts.forEach((post) => {
    // ... corpo da função ...
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

// Mova displayRanking para cá
function displayRanking(ranking, type, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  ranking.forEach((item, index) => {
    // ... corpo da função ...
    const div = document.createElement("div");
    div.className = "ranking-item";

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

// Mova loadStatistics para cá
export function loadStatistics() {
  updateStatsSummary();

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

// Mova createCharts para cá
export function createCharts() {
  try {
    // Gráfico de posts por hora (exemplo)
    const ctx1 = document.getElementById("postsPerHourChart");
    if (ctx1) {

        if (chartInstances.postsPerHour) {
        chartInstances.postsPerHour.destroy();
      }
      // Dados de exemplo
      const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
      const postCounts = hours.map(() => Math.floor(Math.random() * 50) + 10);

      chartInstances.postsPerHour = new Chart(ctx1, {
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
        if (chartInstances.categoryDistribution) {
        chartInstances.categoryDistribution.destroy();
      }
      // Agrupar por categoria
      const categories = {};
      allPosts.forEach((post) => {
        const cat = post.category || "outros";
        categories[cat] = (categories[cat] || 0) + 1;
      });

      const topCategories = Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

      chartInstances.categoryDistribution = new Chart(ctx2, {
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
        if (chartInstances.topApp) {
        chartInstances.topApp.destroy();
      }
      const appCounts = countApps(allPosts); // função que já criamos

      const sortedApps = Object.entries(appCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10); // top 10 apps

      chartInstances.topApp = new Chart(ctx3, {
        type: "doughnut",
        data: {
          labels: sortedApps.map((a) => a[0]),
          datasets: [
            {
              data: sortedApps.map((a) => a[1]),
              backgroundColor: [
                "#FF6384",
                "#36A2EB",
                "#FFCE56",
                "#4BC0C0",
                "#9966FF",
                "#FF9F40",
                "#FF6384",
                "#C9CBCF",
                "#8AC926",
                "#FF595E",
              ],
              borderColor: "#ffffff",
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: "right",
              labels: {
                boxWidth: 20,
                padding: 15,
              },
            },
            tooltip: {
              callbacks: {
                label: function (context) {
                  const label = context.label || "";
                  const value = context.raw || 0;
                  return `${label}: ${value} Users`;
                },
              },
            },
          },
        },
      });
    }
  } catch (error) {
    console.warn("Erro ao criar gráficos:", error);
  }
}

// Mova updateStatsSummary para cá
export function updateStatsSummary() {
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

  const flaggedCount = Object.keys(flaggedPosts).length;
  document.getElementById("flagRate").textContent =
    allPosts.length > 0
      ? ((flaggedCount / allPosts.length) * 100).toFixed(1) + "%"
      : "0%";

  const highPayoutPosts = allPosts.filter(
    (p) => parseFloat(p.pending_payout_value || 0) > 100
  ).length;
  document.getElementById("highPayoutPosts").textContent = highPayoutPosts;

  const authorPostCounts = {};
  allPosts.forEach((post) => {
    authorPostCounts[post.author] = (authorPostCounts[post.author] || 0) + 1;
  });
  const multiPostAuthors = Object.values(authorPostCounts).filter(
    (count) => count > 3
  ).length;
  document.getElementById("multiPostAuthors").textContent = multiPostAuthors;
}

// countApps
export function countApps(posts) {
  const appCounts = {};
  const userAppMap = {};

  posts.forEach((post) => {
    const user = post.author;
    let rawApp = post.json_metadata?.app || "desconhecido";
    
    // 1. Normalização do nome do app
    let app;
    const match = rawApp.match(/^([a-zA-Z0-9\-]+)\//);
    if (match) {
      app = match[1].toLowerCase();
    } else {
      app = rawApp.toLowerCase();
    }
    
    // 2. Inicialização do Set (se necessário)
    if (!userAppMap[user]) {
      userAppMap[user] = new Set();
    }

    // 3. Contagem única por usuário
    if (!userAppMap[user].has(app)) {
      userAppMap[user].add(app);
      appCounts[app] = (appCounts[app] || 0) + 1;
    }
  });

  return appCounts;
}

// Mova calculateAveragePayout para cá
export function calculateAveragePayout() {
  if (allPosts.length === 0) return 0;
  const total = allPosts.reduce(
    (sum, post) => sum + parseFloat(post.pending_payout_value || 0),
    0
  );
  return total / allPosts.length;
}

export function precalculateAuthorStats() {
  const stats = new Map();

  allPosts.forEach(post => {
    const author = post.author;
    
    // Inicializar o objeto de estatísticas se o autor for novo
    if (!stats.has(author)) {
      stats.set(author, {
        postCount: 0,
        shortPostCount: 0,
        // Você pode adicionar outras estatísticas aqui, como totalPayout
      });
    }

    const currentStats = stats.get(author);
    currentStats.postCount++;

    // Verificar posts curtos (usando a função de escape que está no helpers.js)
    if ( (post.body || "").length < 50 ) {
      currentStats.shortPostCount++;
    }
  });

  authorStatsMap = stats;
  // console.log("Estatísticas de Autor pré-calculadas.");
}