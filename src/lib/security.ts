import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import sanitizeHtml from 'sanitize-html';
import { AppError } from './errors';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'opportunity';
export function publicUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(400, 'Invalid URL');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    isIP(host) ||
    !host.includes('.') ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
  )
    throw new AppError(400, 'A public HTTPS URL is required');
  url.hash = '';
  return url.toString();
}
export function sanitizeDescription(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'ul',
      'ol',
      'li',
      'strong',
      'b',
      'em',
      'i',
      'h2',
      'h3',
      'h4',
      'blockquote',
    ],
    allowedAttributes: {},
  });
}
export const plainText = (html: string) =>
  sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function validHmac(body: string, signature: string, secret: string, algorithm = 'sha512') {
  if (!/^[0-9a-f]+$/i.test(signature)) return false;
  const expected = createHmac(algorithm, secret).update(body).digest();
  const actual = Buffer.from(signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
