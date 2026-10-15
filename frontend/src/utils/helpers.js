import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export function truncate(str, len = 100) {
  if (!str || str.length <= len) return str || '';
  return str.slice(0, len) + '...';
}

export function getFileLanguage(path) {
  const ext = path?.split('.').pop()?.toLowerCase();
  const map = { jsx: 'javascript', js: 'javascript', css: 'css', json: 'json', html: 'html', md: 'markdown', txt: 'plaintext' };
  return map[ext] || 'plaintext';
}

export function getFileIcon(path) {
  const ext = path?.split('.').pop()?.toLowerCase();
  const map = { jsx: 'FileCode', js: 'FileCode', css: 'Palette', json: 'FileJson', html: 'Globe', md: 'FileText' };
  return map[ext] || 'File';
}

export function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function formatTokens(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}
