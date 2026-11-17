// Image URL validation and wsrv.nl proxy URL construction.

const DEFAULT_PROXY_HOST = 'https://wsrv.nl/';

/** Accept only absolute HTTP(S) image URLs without credentials or control chars. */
export function isValidImageUrl(value) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f<>"'`]/.test(value)) return false;
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function extractPostImage(post) {
  if (!post) return null;
  let metadata = post.json_metadata;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { metadata = null; }
  }
  if (metadata && typeof metadata === 'object') {
    const candidates = [metadata.image, metadata.images, metadata.thumbnail].flat(Infinity);
    const found = candidates.find((item) => typeof item === 'string' && isValidImageUrl(item));
    if (found) return found.trim();
  }

  const body = typeof post.body === 'string' ? post.body : '';
  const patterns = [
    /!\[[^\]]*\]\((https?:\/\/[^\s"')]+)\)/i,
    /<img\b[^>]*\bsrc=["'](https?:\/\/[^"'<>\s]+)["']/i,
    /(https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s"'<>]*)?)/i,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match && isValidImageUrl(match[1])) return match[1].trim();
  }
  return null;
}

/** Build a wsrv.nl URL while keeping the source URL in a properly encoded query parameter. */
export function getProxiedImageUrl(rawUrl, width = 480, height = 0) {
  if (!isValidImageUrl(rawUrl)) return null;
  const w = Math.max(1, Math.min(2400, Math.round(Number(width) || 480)));
  const h = Math.max(0, Math.min(2400, Math.round(Number(height) || 0)));
  const proxy = new URL(DEFAULT_PROXY_HOST);
  proxy.searchParams.set('url', rawUrl.trim());
  proxy.searchParams.set('w', String(w));
  if (h > 0) {
    proxy.searchParams.set('h', String(h));
    proxy.searchParams.set('fit', 'cover');
  }
  return proxy.toString();
}

export function createSafeImagePreviewHtml(post, options = {}) {
  const className = typeof options.className === 'string' && /^[a-zA-Z0-9_-]+$/.test(options.className)
    ? options.className : 'post-preview-image';
  const rawUrl = extractPostImage(post);
  const proxiedUrl = rawUrl && getProxiedImageUrl(rawUrl, options.width ?? 480, options.height ?? 0);
  if (!proxiedUrl) return '';

  return `<div class="${className}-wrapper"><img src="${proxiedUrl}" alt="Preview do post" class="${className}" loading="lazy" referrerpolicy="no-referrer" decoding="async"></div>`;
}
