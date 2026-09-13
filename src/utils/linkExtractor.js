// Domínios conhecidos de CDN/hospedagem de imagens da Hive
const HIVE_IMAGE_CDNS = new Set([
  'images.hive.blog',
  'files.peakd.com',
  'images.ecency.com',
  'cdn.steemitimages.com',
  'ipfs.io',
  'cloudflare-ipfs.com',
]);

/**
 * Normaliza e limpa um domínio (ex: https://www.youtube.com/watch?v=123 -> youtube.com)
 * @param {string} rawUrl 
 * @returns {string|null}
 */
export function extractDomainFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    let clean = rawUrl.trim().replace(/[),.;:!?]+$/, '');
    if (!/^https?:\/\//i.test(clean)) {
      clean = 'https://' + clean;
    }
    const parsed = new URL(clean);
    let host = parsed.hostname.toLowerCase();
    host = host.replace(/^www\./, '');
    if (!host || !host.includes('.') || host.length < 3) return null;
    return host;
  } catch (e) {
    return null;
  }
}

/**
 * Extrai todos os URLs únicos de um post (analisa post.body e post.json_metadata.links)
 * @param {object} post 
 * @returns {string[]}
 */
export function extractPostUrls(post) {
  if (!post) return [];
  const urls = new Set();

  // 1. Extrair de json_metadata.links se disponível
  if (post.json_metadata) {
    try {
      const meta = typeof post.json_metadata === 'string'
        ? JSON.parse(post.json_metadata)
        : post.json_metadata;

      if (Array.isArray(meta?.links)) {
        meta.links.forEach((l) => {
          if (typeof l === 'string' && l.startsWith('http')) {
            urls.add(l.trim());
          }
        });
      }
    } catch (e) {}
  }

  // 2. Extrair do body usando regex resiliente
  if (typeof post.body === 'string' && post.body.length > 0) {
    // Regex para URLs http e https
    const urlPattern = /https?:\/\/[^\s"'<>\)\]]+/gi;
    let match;
    while ((match = urlPattern.exec(post.body)) !== null) {
      const u = match[0].replace(/[),.;:!?]+$/, '').trim();
      if (u) urls.add(u);
    }
  }

  return Array.from(urls);
}

/**
 * Extrai todos os domínios únicos de um post
 * @param {object} post 
 * @param {boolean} excludeImageCdns - Se true, ignora CDNs de imagem da Hive para focar em links reais de conteúdo/spam
 * @returns {string[]}
 */
export function extractPostDomains(post, excludeImageCdns = false) {
  const urls = extractPostUrls(post);
  const domains = new Set();

  urls.forEach((u) => {
    const domain = extractDomainFromUrl(u);
    if (domain) {
      if (excludeImageCdns && HIVE_IMAGE_CDNS.has(domain)) {
        return;
      }
      domains.add(domain);
    }
  });

  return Array.from(domains);
}

/**
 * Agrupa contagem de posts por domínio
 * @param {object[]} posts 
 * @returns {{ domain: string, count: number, isImageCdn: boolean }[]}
 */
export function groupPostsByDomain(posts, excludeImageCdns = false) {
  if (!Array.isArray(posts) || posts.length === 0) return [];
  const domainCounts = new Map();

  posts.forEach((post) => {
    const domains = extractPostDomains(post, excludeImageCdns);
    domains.forEach((d) => {
      domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
    });
  });

  return Array.from(domainCounts.entries())
    .map(([domain, count]) => ({
      domain,
      count,
      isImageCdn: HIVE_IMAGE_CDNS.has(domain),
    }))
    .sort((a, b) => b.count - a.count);
}
