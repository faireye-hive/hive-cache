// src/utils/helpers.js

import { allPosts, flaggedPosts } from "../config.js";
import { authorStatsMap } from "./statsCalculators.js";
import { AUTHOR_BLACKLIST } from '../api/dataLoader.js';





const SUSPICIOUS_TAGS = new Set([
  "make-money",
  "earn-fast",
  "crypto-scam",
  "get-rich",
  "instant-cash",
]);

// escapeHTML para sanitize
export function escapeHTML(body) {
  if (!body || typeof body !== "string") return "";
  const sanitized = DOMPurify.sanitize(body, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
  return sanitized;
}

// formatDate
export function formatDate(dateString) {
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
      // Melhoria de legibilidade
      return date.toLocaleDateString("pt-BR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
  } catch (e) {
    return "Data inválida";
  }
}
// Mova a função debounce para cá
export function debounce(func, wait) {
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


// calculateRiskLevel
export function calculateRiskLevel(post) {
  const body = escapeHTML(post.body || "");
  const payout = parseFloat(post.pending_payout_value || 0);
  const author = post.author;
  let rawApp = post.json_metadata?.app || "desconhecido";
  let lastedit = post.last_edited || "";

  const SUSPICIOUS_APP_PREFIXES = ["inleo", "desconhecido"];
  
  // Normalização de tags: garante que sejam words
  const tags = Array.isArray(post.tags)
    ? post.tags.map(t => t.toLowerCase())
    : String(post.tags || "").toLowerCase().split(/\s+/).filter(t => t); // Adiciona .filter(t => t) para remover strings vazias


  const category = (post.category || "").toLowerCase();

  // Estatísticas do autor (O(1) lookup)
  const { postCount = 0 } = authorStatsMap.get(author) || {};

  // --- REGRAS ----

  const MITIGATION_KEYWORDS = [
    "strava2hive"
];

  const rules = [
    // 1. Comandos suspeitos
    () => /\!(bbh|lady|vote|gif|pizza|beer|pepe|meme|cpt|summarize)\b/i.test(body) ? 2 : 0,

    // 2. Payout elevado
    () => payout > 500 ? 3 : payout > 100 ? 1 : 0,

    // 3. Conteúdo curto em autores que postam muito
    () => postCount > 15 && body.length < 50 ? 2 : 0,

    () => AUTHOR_BLACKLIST.has(post.author) ? 8 : 0,

    // 4. Muitos posts (farm)
    // Note que 8 pontos para > 200 é o valor aditivo de 4 + 4 do código anterior
    () => postCount > 200 ? 8 : postCount > 100 ? 4 : 0,

    // 5. Tags suspeitas
    () => tags.some(tag => SUSPICIOUS_TAGS.has(tag)) ? 3 : 0,

    // 6. Já sinalizado
    () => flaggedPosts[post.id] ? 4 : 0,

    // 7. Categoria suspeita
    () => ["nsfw", "adult", "gambling"].includes(category) ? 2 : 0,

    () => {
        const appLower = rawApp.toLowerCase();
        const appss = "UniversalTipBot".toLowerCase();
        
        // 1. Caso "inleo": Risco 7 direto.
        if (appLower.includes("inleo")) {
            return 7; 
        }
        if (appLower.includes(appss)) {
            return 7; 
        }

        // 2. Caso "desconhecido":
        if (appLower.includes("desconhecido")) {
            
            // **NOVO TESTE DE MITIGAÇÃO:**
            // Verifica se o body contém alguma das palavras-chave de mitigação.
            const isMitigatedByBody = MITIGATION_KEYWORDS.some(keyword => 
                body.toLowerCase().includes(keyword.toLowerCase())
            );

            // Se o body tiver uma palavra de mitigação, o risco é 0.
            if (isMitigatedByBody) {
                return 0;
            }

            // Se NÃO foi mitigado pelo body, verifica a edição (como você queria):
            // Só é risco 7 se NÃO foi editado.
            if (lastedit === "") { 
                return 7;
            }
            
            // Se foi editado E NÃO foi mitigado, o risco é 0.
            return 0; 
        }
        
        // 3. Outros Apps: Risco 0.
        return 0;
    },
  ];

  // Somar todas regras (Versão Funcional com reduce)
  const risk = rules.reduce((total, rule) => total + rule(), 0);

  // Níveis
  if (risk >= 7) return "high";
  if (risk >= 4) return "medium";
  return "low";
}

export function normalizeTags(tags) {
  if (!tags) return "";
  if (Array.isArray(tags)) return tags.join(" ").toLowerCase();
  if (typeof tags === "string") return tags.toLowerCase();
  return "";
}
