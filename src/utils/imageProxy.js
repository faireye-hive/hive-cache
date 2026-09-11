// src/utils/imageProxy.js

/**
 * Utilitário para extração segura de imagens de posts Hive e roteamento via Proxy Oficial
 * Protegendo os moderadores contra XSS, vazamento de IP e rastreadores externos.
 */

const DEFAULT_PROXY_HOST = 'https://images.hive.blog';

/**
 * Valida se uma URL é estritamente HTTP ou HTTPS (evita javascript:, data:, etc.)
 * @param {string} url
 * @returns {boolean}
 */
export function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  // Apenas esquemas http e https seguros
  if (!/^https?:\/\//i.test(trimmed)) return false;
  // Bloqueia tentativas de injeção comuns
  if (/[<>"'`]/.test(trimmed)) return false;
  return true;
}

/**
 * Extrai a URL da imagem principal de um post Hive a partir de json_metadata ou do corpo
 * @param {Object} post
 * @returns {string|null}
 */
export function extractPostImage(post) {
  if (!post) return null;

  // 1. Tenta extrair de json_metadata
  let metadata = post.json_metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch (e) {
      // Ignora erro de parse
    }
  }

  if (metadata && typeof metadata === 'object') {
    // Array de imagens
    if (Array.isArray(metadata.image) && metadata.image.length > 0) {
      const first = metadata.image[0];
      if (isValidImageUrl(first)) return first.trim();
    }
    if (Array.isArray(metadata.images) && metadata.images.length > 0) {
      const first = metadata.images[0];
      if (isValidImageUrl(first)) return first.trim();
    }
    // Imagem única ou thumbnail
    if (typeof metadata.image === 'string' && isValidImageUrl(metadata.image)) {
      return metadata.image.trim();
    }
    if (typeof metadata.thumbnail === 'string' && isValidImageUrl(metadata.thumbnail)) {
      return metadata.thumbnail.trim();
    }
  }

  // 2. Fallback: extrai do corpo do post (Markdown ou Tag img)
  const body = post.body || '';
  if (typeof body === 'string' && body.length > 0) {
    // Markdown: ![alt](url)
    const mdMatch = body.match(/!\[.*?\]\((https?:\/\/[^\s"')]+(?:\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg)?.*?)\)/i);
    if (mdMatch && isValidImageUrl(mdMatch[1])) {
      return mdMatch[1].trim();
    }

    // HTML tag: <img src="url">
    const htmlMatch = body.match(/<img\s+[^>]*src=["'](https?:\/\/[^"'>\s]+)["']/i);
    if (htmlMatch && isValidImageUrl(htmlMatch[1])) {
      return htmlMatch[1].trim();
    }

    // Link direto para extensão de imagem
    const directMatch = body.match(/(https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s"'<>]*)?)/i);
    if (directMatch && isValidImageUrl(directMatch[1])) {
      return directMatch[1].trim();
    }
  }

  return null;
}

/**
 * Converte qualquer URL de imagem em uma URL segura através do Proxy Oficial da Hive
 * @param {string} rawUrl - URL bruta da imagem
 * @param {number} width - Largura desejada (ex: 320, 480, 640)
 * @param {number} height - Altura desejada (0 para manter proporção)
 * @returns {string|null}
 */
export function getProxiedImageUrl(rawUrl, width = 480, height = 0) {
  if (!rawUrl || !isValidImageUrl(rawUrl)) return null;

  const clean = rawUrl.trim();

  // Se já for uma URL do proxy images.hive.blog com dimensões, pode reutilizar ou redimensionar
  if (clean.startsWith('https://images.hive.blog/')) {
    // Substitui a dimensão se necessário
    const match = clean.match(/^https:\/\/images\.hive\.blog\/\d+x\d+\/(.*)/);
    if (match && match[1]) {
      return `${DEFAULT_PROXY_HOST}/${width}x${height}/${match[1]}`;
    }
    return clean;
  }

  if (clean.startsWith('https://images.ecency.com/')) {
    return clean;
  }

  // Roteia através do proxy de imagens seguro da Hive
  return `${DEFAULT_PROXY_HOST}/${width}x${height}/${encodeURI(clean)}`;
}

/**
 * Retorna o HTML sanitizado para preview de imagem de um post
 * @param {Object} post
 * @param {Object} options { width, height, className }
 * @returns {string}
 */
export function createSafeImagePreviewHtml(post, options = {}) {
  const width = options.width || 480;
  const height = options.height || 0;
  const className = options.className || 'post-preview-image';

  const rawUrl = extractPostImage(post);
  if (!rawUrl) {
    return '';
  }

  const proxiedUrl = getProxiedImageUrl(rawUrl, width, height);
  if (!proxiedUrl) {
    return '';
  }

  // Atributos de segurança reforçados contra XSS e rastreamento
  return `
    <div class="${className}-wrapper">
      <img
        src="${proxiedUrl}"
        alt="Preview do post"
        class="${className}"
        loading="lazy"
        referrerpolicy="no-referrer"
        crossorigin="anonymous"
        onerror="this.parentElement.style.display='none'"
      />
    </div>
  `;
}
