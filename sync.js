#!/usr/bin/env node

/**
 * YuStream to Jellyfin .strm Catalog Synchronizer
 *
 * Connects to YuStream API, retrieves movies and series catalog,
 * and creates a Jellyfin/TMDB-compliant directory structure with .strm files.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// Configuration & Defaults
// ==========================================
export const CONFIG = {
  apiBaseUrl: process.env.YUSTREAM_API_URL || 'https://yustream.org',
  bridgeUrl: process.env.BRIDGE_URL || 'http://localhost:3849',
  defaultOutputDir: path.resolve(__dirname, 'media'),
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://yustream.org/',
    'Origin': 'https://yustream.org',
    'Accept': 'application/json, text/plain, */*'
  },
  timeoutMs: 20000,
  directStreamUrls: false
};

// ==========================================
// CLI Argument Parsing
// ==========================================
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    outputDir: CONFIG.defaultOutputDir,
    moviesDir: null,
    showsDir: null,
    force: false,
    dryRun: false,
    help: false,
    apiUrl: CONFIG.apiBaseUrl,
    bridgeUrl: CONFIG.bridgeUrl,
    directStreamUrls: false,
    limit: null,
    mediaTypeFilter: 'all', // 'all', 'movies', 'shows'
    selectedGenres: [],
    minYear: null,
    minRating: null,
    authToken: process.env.YUSTREAM_TOKEN || null,
    username: process.env.YUSTREAM_USERNAME || '',
    password: process.env.YUSTREAM_PASSWORD || '',
    languagePreference: 'original'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true;
    } else if (arg === '--output' || arg === '-o') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.outputDir = path.resolve(process.cwd(), args[++i]);
      }
    } else if (arg.startsWith('--output=')) {
      options.outputDir = path.resolve(process.cwd(), arg.split('=')[1]);
    } else if (arg === '--api-url') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.apiUrl = args[++i];
      }
    } else if (arg.startsWith('--api-url=')) {
      options.apiUrl = arg.split('=')[1];
    } else if (arg === '--limit') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.limit = parseInt(args[++i], 10);
      }
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--token') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.authToken = args[++i];
      }
    } else if (arg.startsWith('--token=')) {
      options.authToken = arg.split('=')[1];
    } else if (arg === '--username' || arg === '-u') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.username = args[++i];
      }
    } else if (arg === '--password' || arg === '-p') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.password = args[++i];
      }
    } else if (arg === '--direct-stream-urls' || arg === '--direct') {
      options.directStreamUrls = true;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
YuStream to Jellyfin .strm Catalog Synchronizer

Usage:
  node sync.js [options]

Options:
  -o, --output <dir>       Set base output directory (default: ./media)
  -f, --force              Overwrite existing .strm files
  -d, --dry-run            Simulate sync process without writing to disk
      --limit <number>     Limit total items processed per category (useful for testing)
      --token <jwt>        Provide YuStream JWT token
  -u, --username <user>    YuStream username / email
  -p, --password <pass>    YuStream password
      --api-url <url>      Custom YuStream API base URL (default: https://yustream.org)
  -h, --help               Show this help message

Examples:
  node sync.js
  node sync.js --dry-run --limit 10
  node sync.js --username myuser --password mypass
`);
}

// ==========================================
// Utilities
// ==========================================

export function sanitizeName(name) {
  if (!name) return '';
  return name
    .toString()
    // Decode HTML entities like &#8211;, &amp;, etc.
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Strip zero-width and control characters
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u0000-\u001F]/g, '')
    .replace(/[\\/:*?"<>|]/g, '') // remove forbidden characters
    .replace(/\s+/g, ' ')         // normalize multiple spaces
    .trim();
}

export function padZero(num) {
  return String(num).padStart(2, '0');
}

export function extractYear(releaseDate, defaultYear = '') {
  if (!releaseDate) return defaultYear;
  const match = String(releaseDate).match(/\b(19\d\d|20\d\d)\b/);
  return match ? match[1] : defaultYear;
}

export function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function vttToSrt(vttContent) {
  if (!vttContent || typeof vttContent !== 'string') return '';

  let clean = vttContent.replace(/^\uFEFF?WEBVTT[^\r\n]*(\r\n|\n|\r)/, '');
  clean = clean.replace(/NOTE(\s+[\s\S]*?)?(\r\n\r\n|\n\n|\r\r|$)/g, '');
  clean = clean.replace(/STYLE(\s+[\s\S]*?)?(\r\n\r\n|\n\n|\r\r|$)/g, '');
  clean = clean.replace(/REGION(\s+[\s\S]*?)?(\r\n\r\n|\n\n|\r\r|$)/g, '');
  clean = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rawBlocks = clean.split(/\n{2,}/);
  const srtBlocks = [];
  let counter = 1;

  const timestampRegex = /(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})/;

  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n');
    let timestampLineIndex = -1;
    let match = null;

    for (let i = 0; i < lines.length; i++) {
      match = lines[i].match(timestampRegex);
      if (match) {
        timestampLineIndex = i;
        break;
      }
    }

    if (timestampLineIndex === -1 || !match) continue;

    const formatTime = (h, m, s, ms) => {
      const hours = padZero(parseInt(h || '0', 10));
      const minutes = padZero(parseInt(m, 10));
      const seconds = padZero(parseInt(s, 10));
      const milliseconds = String(ms).padEnd(3, '0').slice(0, 3);
      return `${hours}:${minutes}:${seconds},${milliseconds}`;
    };

    const startTime = formatTime(match[1], match[2], match[3], match[4]);
    const endTime = formatTime(match[5], match[6], match[7], match[8]);
    const srtTimestamp = `${startTime} --> ${endTime}`;

    const textLines = lines.slice(timestampLineIndex + 1).map(line => {
      return line.replace(/<\/?[^>]+(>|$)/g, '').trim();
    }).filter(line => line.length > 0);

    if (textLines.length === 0) continue;

    srtBlocks.push(`${counter}\n${srtTimestamp}\n${textLines.join('\n')}`);
    counter++;
  }

  return srtBlocks.join('\n\n') + '\n';
}

export function convertAllVttInDirectory(dirPath, force = false, onProgress = null) {
  const stats = { found: 0, converted: 0, skipped: 0, errors: 0 };
  if (!fs.existsSync(dirPath)) return stats;

  const scan = (currentDir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      const fullPath = path.join(currentDir, ent.name);
      if (ent.isDirectory()) {
        scan(fullPath);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.vtt')) {
        stats.found++;
        const srtPath = fullPath.slice(0, -4) + '.srt';

        if (fs.existsSync(srtPath) && !force) {
          stats.skipped++;
          continue;
        }

        try {
          const vttContent = fs.readFileSync(fullPath, 'utf8');
          const srtContent = vttToSrt(vttContent);
          if (srtContent && srtContent.trim().length > 0) {
            fs.writeFileSync(srtPath, srtContent, 'utf8');
            stats.converted++;
            if (onProgress) onProgress(`Converted: ${path.basename(fullPath)} -> ${path.basename(srtPath)}`);
          } else {
            stats.skipped++;
          }
        } catch (err) {
          stats.errors++;
          if (onProgress) onProgress(`Error converting ${ent.name}: ${err.message}`);
        }
      }
    }
  };

  scan(dirPath);
  return stats;
}

// Clean HTML tags and entities for NFO
function cleanHtmlText(html) {
  if (!html) return '';
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Generate Kodi/Jellyfin compatible movie.nfo
 */
export function generateMovieNfo(movie, resolvedTitle) {
  const title = escapeXml(resolvedTitle || movie.title?.rendered || movie.title || 'Unknown');
  const rawYear = movie.year || movie.release_date || (movie.title?.rendered ? extractYear(movie.title.rendered) : '');
  const year = extractYear(rawYear, '');
  const plot = escapeXml(cleanHtmlText(movie.description || movie.content?.rendered || movie.excerpt?.rendered || ''));
  const rating = movie.imdb_rating || movie.avg_rating || '';
  const runtime = movie.run_time ? String(movie.run_time).replace(/[^0-9]/g, '') : '';
  const dateadded = movie.date ? movie.date.replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' ');

  let genresXml = '';
  if (Array.isArray(movie.genre)) {
    for (const g of movie.genre) {
      const gName = typeof g === 'string' ? g : g.name;
      if (gName) genresXml += `  <genre>${escapeXml(gName)}</genre>\n`;
    }
  }

  let actorsXml = '';
  if (Array.isArray(movie.casts)) {
    for (const cast of movie.casts) {
      const name = typeof cast === 'string' ? cast : (cast.name || cast.character);
      if (name) {
        actorsXml += `  <actor>\n    <name>${escapeXml(name)}</name>\n    <role>${escapeXml(cast.character || '')}</role>\n  </actor>\n`;
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<movie>
  <title>${title}</title>
  <originaltitle>${title}</originaltitle>
  <sorttitle>${title}</sorttitle>
  <year>${year}</year>
  <plot>${plot}</plot>
  <outline>${plot ? plot.slice(0, 200) : ''}</outline>
  ${rating ? `<rating>${rating}</rating>` : ''}
  ${runtime ? `<runtime>${runtime}</runtime>` : ''}
  <dateadded>${dateadded}</dateadded>
${genresXml}${actorsXml}</movie>
`;
}

/**
 * Generate Kodi/Jellyfin compatible tvshow.nfo
 */
export function generateShowNfo(show, resolvedTitle) {
  const title = escapeXml(resolvedTitle || show.title?.rendered || show.title || 'Unknown');
  const rawYear = show.year || (show.title?.rendered ? extractYear(show.title.rendered) : '');
  const year = extractYear(rawYear, '');
  const plot = escapeXml(cleanHtmlText(show.description || show.content?.rendered || show.excerpt?.rendered || ''));
  const rating = show.imdb_rating || show.avg_rating || '';
  const dateadded = show.date ? show.date.replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' ');

  let genresXml = '';
  if (Array.isArray(show.genre)) {
    for (const g of show.genre) {
      const gName = typeof g === 'string' ? g : g.name;
      if (gName) genresXml += `  <genre>${escapeXml(gName)}</genre>\n`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<tvshow>
  <title>${title}</title>
  <originaltitle>${title}</originaltitle>
  <sorttitle>${title}</sorttitle>
  <year>${year}</year>
  <plot>${plot}</plot>
  <outline>${plot ? plot.slice(0, 200) : ''}</outline>
  ${rating ? `<rating>${rating}</rating>` : ''}
  <dateadded>${dateadded}</dateadded>
${genresXml}</tvshow>
`;
}

// ==========================================
// YuStream API Client
// ==========================================
export class YuStreamClient {
  constructor(baseUrl, headers = {}, token = null) {
    this.baseUrl = (baseUrl || 'https://yustream.org').replace(/\/+$/, '');
    this.headers = { ...CONFIG.headers, ...headers };
    this.token = token;
    this.cookies = '';
    this.genreMap = new Map(); // id -> name
  }

  async login(username, password) {
    try {
      // 1. Try JWT Auth
      const jwtRes = await fetch(`${this.baseUrl}/wp-json/jwt-auth/v1/token`, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      if (jwtRes.ok) {
        const data = await jwtRes.json();
        if (data && data.token) {
          this.token = data.token;
          return { success: true, token: data.token, user: data.user_display_name || username };
        }
      }

      // 2. Fallback to wp-login.php form submission
      const loginUrl = `${this.baseUrl}/wp-login.php`;
      const params = new URLSearchParams();
      params.append('log', username);
      params.append('pwd', password);
      params.append('rememberme', 'forever');
      params.append('wp-submit', 'Log In');
      params.append('redirect_to', `${this.baseUrl}/`);

      const res = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString(),
        redirect: 'manual'
      });

      const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
      if (rawCookies && rawCookies.length > 0) {
        const valid = rawCookies.filter(c => c && !c.includes('Max-Age=0')).map(c => c.split(';')[0]);
        this.cookies = valid.join('; ');
        const isLogged = this.cookies.includes('wordpress_logged_in_') || this.cookies.includes('wordpress_sec_');
        if (isLogged) {
          return { success: true, token: null, user: username };
        }
      }

      return { success: false, message: 'Invalid credentials or login failed.' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  getAuthHeaders() {
    const h = { ...this.headers };
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    if (this.cookies) {
      h['Cookie'] = this.cookies;
    }
    return h;
  }

  async loadGenreMap() {
    if (this.genreMap.size > 0) return;
    try {
      const res = await fetch(`${this.baseUrl}/wp-json/wp/v2/movie_genre?per_page=100`, {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const genres = await res.json();
        if (Array.isArray(genres)) {
          for (const g of genres) {
            this.genreMap.set(g.id, g.name);
          }
        }
      }
    } catch {}
  }

  async fetchMovies(page = 1, perPage = 100) {
    const url = `${this.baseUrl}/wp-json/wp/v2/movie?page=${page}&per_page=${perPage}&_embed=1`;
    const res = await fetch(url, { headers: this.getAuthHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to fetch movies (HTTP ${res.status}): ${res.statusText}`);
    }
    const totalCount = parseInt(res.headers.get('X-WP-Total') || '0', 10);
    const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10);
    const data = await res.json();
    return { data, totalCount, totalPages };
  }

  async fetchShows(page = 1, perPage = 100) {
    const url = `${this.baseUrl}/wp-json/wp/v2/tv_show?page=${page}&per_page=${perPage}&_embed=1`;
    const res = await fetch(url, { headers: this.getAuthHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to fetch TV shows (HTTP ${res.status}): ${res.statusText}`);
    }
    const totalCount = parseInt(res.headers.get('X-WP-Total') || '0', 10);
    const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10);
    const data = await res.json();
    return { data, totalCount, totalPages };
  }

  async getMovieDetails(movieId) {
    try {
      const res = await fetch(`${this.baseUrl}/wp-json/streamit/api/v1/movies/${movieId}`, {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const json = await res.json();
        return json.data?.details || json.data || json;
      }
    } catch {}
    return null;
  }

  async getShowDetails(showId) {
    try {
      const res = await fetch(`${this.baseUrl}/wp-json/streamit/api/v1/tv-shows/${showId}`, {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const json = await res.json();
        return json.data?.details || json.data || json;
      }
    } catch {}
    return null;
  }

  async getShowEpisodes(showId) {
    try {
      const showDetail = await this.getShowDetails(showId);
      const seasonsList = showDetail?.seasons?.data || [];
      const allEpisodes = [];

      if (seasonsList.length > 0) {
        for (const s of seasonsList) {
          try {
            const res = await fetch(`${this.baseUrl}/wp-json/streamit/api/v1/tv-shows/${showId}/seasons/${s.id}`, {
              headers: this.getAuthHeaders()
            });
            if (res.ok) {
              const json = await res.json();
              const eps = json.data?.episodes || [];
              for (const ep of eps) {
                allEpisodes.push({
                  ...ep,
                  season_name: s.name,
                  season_id: s.id
                });
              }
            }
          } catch (err) {
            console.warn(`  ⚠️ Could not fetch season ${s.id} for show ${showId}: ${err.message}`);
          }
        }
      }

      return allEpisodes;
    } catch (err) {
      console.warn(`  ⚠️ Could not fetch episodes for show ${showId}: ${err.message}`);
      return [];
    }
  }

  async getEpisodeDetails(episodeId) {
    try {
      const res = await fetch(`${this.baseUrl}/wp-json/streamit/api/v1/tv-show/season/episodes/${episodeId}`, {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const json = await res.json();
        return json.data || json;
      }
    } catch {}
    return null;
  }
}

// ==========================================
// Sync Engine
// ==========================================
export class SyncEngine {
  constructor(options) {
    this.options = options;
    this.client = new YuStreamClient(options.apiUrl, CONFIG.headers, options.authToken);
    this.onLog = options.onLog || ((msg) => console.log(msg));
    this.moviesBaseDir = options.moviesDir || path.join(options.outputDir, 'MoviesYuStream');
    this.showsBaseDir = options.showsDir || path.join(options.outputDir, 'ShowsYuStream');
    this.stats = {
      moviesFound: 0,
      moviesCreated: 0,
      moviesSkipped: 0,
      showsFound: 0,
      episodesFound: 0,
      episodesCreated: 0,
      episodesSkipped: 0,
      createdTitles: [],
      errors: 0
    };
  }

  log(msg) {
    this.onLog(msg);
  }

  resolveTitle(item) {
    const raw = item.title?.rendered || item.title || item.name || '';
    return sanitizeName(raw);
  }

  writeStrmFile(filePath, streamUrl) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      if (!this.options.dryRun) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    if (fs.existsSync(filePath) && !this.options.force) {
      return { status: 'skipped' };
    }

    if (this.options.dryRun) {
      return { status: 'created', dryRun: true };
    }

    fs.writeFileSync(filePath, streamUrl.trim() + '\n', 'utf-8');
    return { status: 'created' };
  }

  async downloadFile(url, destPath) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
    if (fs.existsSync(destPath) && !this.options.force) return false;
    if (this.options.dryRun) return true;

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': CONFIG.headers['User-Agent'],
          'Referer': 'https://yustream.org/'
        }
      });
      if (!res.ok) return false;

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(destPath, buffer);
      return true;
    } catch {
      return false;
    }
  }

  cleanItemTitleAndYear(rawTitle) {
    const sanitized = sanitizeName(rawTitle);
    const yearMatch = sanitized.match(/\b(19\d\d|20\d\d)\b/);
    const year = yearMatch ? yearMatch[1] : '';
    // Strip trailing or repeated year from title if present
    let cleanTitle = sanitized;
    if (year) {
      cleanTitle = cleanTitle.replace(new RegExp(`\\b${year}\\b.*$`), '').trim();
    }
    if (!cleanTitle) cleanTitle = sanitized;
    return { title: cleanTitle, year };
  }

  async processMovie(movie) {
    const rawTitle = movie.title?.rendered || movie.title || 'Unknown';
    const { title, year } = this.cleanItemTitleAndYear(rawTitle);
    const folderName = year ? `${title} (${year})` : title;
    const fileName = `${folderName}.strm`;

    const targetDir = path.join(this.moviesBaseDir, folderName);
    const targetFile = path.join(targetDir, fileName);

    const mediaId = movie.id;
    let streamContent = `${this.options.bridgeUrl}/play/${mediaId}`;

    let detail = null;
    if (this.options.directStreamUrls || !this.options.dryRun) {
      try {
        detail = await this.client.getMovieDetails(mediaId);
        if (this.options.directStreamUrls && detail) {
          const directUrl = detail.movie_file || detail.url_link || detail.sources?.[0]?.source_url;
          if (directUrl) {
            streamContent = directUrl;
          }
        }
      } catch (err) {
        if (this.options.directStreamUrls) {
          this.log(`     ⚠️ [Direct URL] Could not resolve direct stream URL for movie ${mediaId}: ${err.message}`);
        }
      }
    }

    const res = this.writeStrmFile(targetFile, streamContent);

    if (res.status === 'created') {
      this.stats.moviesCreated++;
      this.stats.createdTitles.push({
        type: 'movie',
        title: title,
        year: year,
        target: `${folderName}/${fileName}`
      });
      this.log(`  ➕ [Movie] [${res.dryRun ? 'DRY-RUN' : 'CREATED'}] ${folderName}/${fileName}${this.options.directStreamUrls && streamContent.startsWith('http') && !streamContent.includes('/play/') ? ' ⚡(DIRECT)' : ''}`);

      // Detailed metadata & Artwork if not dry-run
      if (!this.options.dryRun) {
        try {
          if (!detail) {
            detail = await this.client.getMovieDetails(mediaId);
          }
          const nfoContent = generateMovieNfo(detail || movie, title);
          const nfoPath = path.join(targetDir, 'movie.nfo');
          if (!fs.existsSync(nfoPath) || this.options.force) {
            fs.writeFileSync(nfoPath, nfoContent, 'utf8');
          }

          // Posters / Images
          const posterUrl = detail?.image || movie._embedded?.['wp:featuredmedia']?.[0]?.source_url;
          const fanartUrl = detail?.landscape_image || movie.landscape_image;
          if (posterUrl) await this.downloadFile(posterUrl, path.join(targetDir, 'poster.jpg'));
          if (fanartUrl) await this.downloadFile(fanartUrl, path.join(targetDir, 'fanart.jpg'));
        } catch (err) {
          this.log(`     ⚠️ [NFO/Art] Error creating metadata for ${title}: ${err.message}`);
        }
      }
    } else {
      this.stats.moviesSkipped++;
      this.log(`  ⏭️  [Movie] [SKIPPED] ${folderName}/${fileName}`);
    }
  }

  async processShow(show) {
    const rawTitle = show.title?.rendered || show.title || 'Unknown';
    const { title, year } = this.cleanItemTitleAndYear(rawTitle);
    // Remove "TV Serija" or "Serija" from folder name if present
    const cleanTitle = title.replace(/\b(tv\s*serija|serija)\b/gi, '').trim();
    const showFolderName = year ? `${cleanTitle} (${year})` : cleanTitle;
    const showDir = path.join(this.showsBaseDir, showFolderName);

    // Fetch full show details
    let showDetail = null;
    if (!this.options.dryRun) {
      try {
        if (!fs.existsSync(showDir)) fs.mkdirSync(showDir, { recursive: true });
        showDetail = await this.client.getShowDetails(show.id);
        const nfoContent = generateShowNfo(showDetail || show, cleanTitle);
        const nfoPath = path.join(showDir, 'tvshow.nfo');
        if (!fs.existsSync(nfoPath) || this.options.force) {
          fs.writeFileSync(nfoPath, nfoContent, 'utf8');
        }

        const posterUrl = showDetail?.image || show._embedded?.['wp:featuredmedia']?.[0]?.source_url;
        const fanartUrl = showDetail?.landscape_image || show.landscape_image;
        if (posterUrl) await this.downloadFile(posterUrl, path.join(showDir, 'poster.jpg'));
        if (fanartUrl) await this.downloadFile(fanartUrl, path.join(showDir, 'fanart.jpg'));
      } catch (err) {
        this.log(`     ⚠️ [NFO] Error generating tvshow.nfo: ${err.message}`);
      }
    }

    // Fetch episodes for show
    const episodes = await this.client.getShowEpisodes(show.id);
    this.log(`  📺 [Show] "${cleanTitle}": ${episodes.length} episodes found`);

    if (episodes.length > 0) {
      for (const ep of episodes) {
        this.stats.episodesFound++;
        const epTitle = ep.title?.rendered || ep.title || '';
        
        // Parse Season and Episode numbers: e.g. "Škripac S01 Ep04" or "S01E04" or "Epizoda 4"
        let seasonNum = 1;
        let epNum = 1;

        const sMatch = epTitle.match(/[Ss](\d+)/);
        if (sMatch) seasonNum = parseInt(sMatch[1], 10);

        const eMatch = epTitle.match(/[Ee](?:p|pisode)?\s*(\d+)/i) || epTitle.match(/\bepizoda\s*(\d+)/i);
        if (eMatch) {
          epNum = parseInt(eMatch[1], 10);
        } else {
          const numMatch = epTitle.match(/(\d+)$/);
          if (numMatch) epNum = parseInt(numMatch[1], 10);
        }

        const seasonFolderName = `Season ${padZero(seasonNum)}`;
        const sxxexx = `S${padZero(seasonNum)}E${padZero(epNum)}`;
        const epFileName = `${cleanTitle} - ${sxxexx}.strm`;

        const targetDir = path.join(this.showsBaseDir, showFolderName, seasonFolderName);
        const targetFile = path.join(targetDir, epFileName);

        let streamContent = `${this.options.bridgeUrl}/play/${ep.id}`;
        let isDirect = false;

        if (this.options.directStreamUrls) {
          try {
            const epDetail = await this.client.getEpisodeDetails(ep.id);
            const directUrl = epDetail?.data?.episode_file || epDetail?.episode_file || epDetail?.data?.url_link || epDetail?.url_link;
            if (directUrl) {
              streamContent = directUrl;
              isDirect = true;
            }
          } catch (err) {
            this.log(`     ⚠️ [Direct URL] Could not resolve direct stream URL for episode ${ep.id}: ${err.message}`);
          }
        }

        const res = this.writeStrmFile(targetFile, streamContent);

        if (res.status === 'created') {
          this.stats.episodesCreated++;
          this.stats.createdTitles.push({
            type: 'episode',
            title: `${cleanTitle} - ${sxxexx}`,
            year: year,
            target: `${showFolderName}/${seasonFolderName}/${epFileName}`
          });
          this.log(`  ➕ [Episode] [${res.dryRun ? 'DRY-RUN' : 'CREATED'}] ${showFolderName}/${seasonFolderName}/${epFileName}${isDirect ? ' ⚡(DIRECT)' : ''}`);
        } else {
          this.stats.episodesSkipped++;
          this.log(`  ⏭️  [Episode] [SKIPPED] ${showFolderName}/${seasonFolderName}/${epFileName}`);
        }
      }
    } else {
      // Fallback placeholder if no episodes list returned
      this.stats.episodesFound++;
      const seasonFolderName = 'Season 01';
      const epFileName = `${cleanTitle} - S01E01.strm`;
      const targetDir = path.join(this.showsBaseDir, showFolderName, seasonFolderName);
      const targetFile = path.join(targetDir, epFileName);
      const streamContent = `${this.options.bridgeUrl}/play/${show.id}`;
      const res = this.writeStrmFile(targetFile, streamContent);
      if (res.status === 'created') {
        this.stats.episodesCreated++;
        this.log(`  ➕ [Placeholder] [${res.dryRun ? 'DRY-RUN' : 'CREATED'}] ${showFolderName}/${seasonFolderName}/${epFileName}`);
      }
    }
  }

  filterItem(item) {
    // Genre filter
    if (this.options.selectedGenres && this.options.selectedGenres.length > 0) {
      const itemGenreIds = item.movie_genre || item.tv_show_genre || [];
      const itemGenreNames = itemGenreIds.map(id => this.client.genreMap.get(id)).filter(Boolean);
      const matches = this.options.selectedGenres.some(g => itemGenreNames.includes(g));
      if (!matches) return false;
    }

    // Min Year filter
    if (this.options.minYear) {
      const rawTitle = item.title?.rendered || '';
      const year = parseInt(extractYear(rawTitle, '0'), 10);
      if (year < this.options.minYear) return false;
    }

    return true;
  }

  async run(targetItemIds = null) {
    this.log(`🚀 Starting JellyYuStream Sync Engine`);
    this.log(`   API: ${this.options.apiUrl}`);
    this.log(`   Bridge: ${this.options.bridgeUrl}`);
    this.log(`   Filter: ${this.options.mediaTypeFilter || 'all'}`);
    if (this.options.dryRun) this.log(`   Mode: DRY-RUN (no files will be written)`);

    // Authenticate
    if (this.options.username && this.options.password) {
      this.log(`🔐 Authenticating with YuStream (${this.options.username})...`);
      const auth = await this.client.login(this.options.username, this.options.password);
      if (auth.success) {
        this.log(`✅ Authentication successful!`);
      } else {
        this.log(`⚠️ Authentication notice: ${auth.message} (proceeding with public session)`);
      }
    }

    await this.client.loadGenreMap();

    const doMovies = this.options.mediaTypeFilter !== 'shows';
    const doShows = this.options.mediaTypeFilter !== 'movies';

    // 1. Process Movies
    if (doMovies) {
      this.log(`\n🎬 --- Syncing Movies ---`);
      let page = 1;
      let processed = 0;
      const limit = this.options.limit || Infinity;

      while (processed < limit) {
        const perPage = Math.min(limit - processed, 100);
        try {
          const res = await this.client.fetchMovies(page, perPage);
          if (!res.data || res.data.length === 0) break;

          for (const movie of res.data) {
            if (targetItemIds && !targetItemIds.includes(String(movie.id))) continue;
            if (!this.filterItem(movie)) continue;

            this.stats.moviesFound++;
            await this.processMovie(movie);
            processed++;
            if (processed >= limit) break;
          }

          if (page >= res.totalPages) break;
          page++;
        } catch (err) {
          this.log(`❌ Error fetching movies page ${page}: ${err.message}`);
          break;
        }
      }
    }

    // 2. Process TV Shows
    if (doShows) {
      this.log(`\n📺 --- Syncing TV Shows ---`);
      let page = 1;
      let processed = 0;
      const limit = this.options.limit || Infinity;

      while (processed < limit) {
        const perPage = Math.min(limit - processed, 100);
        try {
          const res = await this.client.fetchShows(page, perPage);
          if (!res.data || res.data.length === 0) break;

          for (const show of res.data) {
            if (targetItemIds && !targetItemIds.includes(String(show.id))) continue;
            if (!this.filterItem(show)) continue;

            this.stats.showsFound++;
            await this.processShow(show);
            processed++;
            if (processed >= limit) break;
          }

          if (page >= res.totalPages) break;
          page++;
        } catch (err) {
          this.log(`❌ Error fetching TV shows page ${page}: ${err.message}`);
          break;
        }
      }
    }

    this.log(`\n🏁 Sync finished!`);
    this.log(`   Movies created: ${this.stats.moviesCreated} (Skipped: ${this.stats.moviesSkipped})`);
    this.log(`   Episodes created: ${this.stats.episodesCreated} (Skipped: ${this.stats.episodesSkipped})`);

    return this.stats;
  }

  async preview() {
    await this.client.loadGenreMap();

    const doMovies = this.options.mediaTypeFilter !== 'shows';
    const doShows = this.options.mediaTypeFilter !== 'movies';
    const limit = (this.options.limit && this.options.limit > 0) ? this.options.limit : 5000;

    let movies = [];
    let shows = [];

    if (doMovies) {
      let page = 1;
      while (movies.length < limit) {
        const perPage = Math.min(limit - movies.length, 100);
        try {
          const res = await this.client.fetchMovies(page, perPage);
          if (!res.data || res.data.length === 0) break;
          const filtered = res.data.filter(m => this.filterItem(m)).map(m => {
            const { title, year } = this.cleanItemTitleAndYear(m.title?.rendered || '');
            const genres = (m.movie_genre || []).map(id => this.client.genreMap.get(id)).filter(Boolean);
            return {
              id: m.id,
              title,
              year,
              genres,
              type: 'movie',
              targetFile: `${year ? `${title} (${year})` : title}/${year ? `${title} (${year})` : title}.strm`
            };
          });
          movies.push(...filtered);
          if (page >= res.totalPages || movies.length >= limit) break;
          page++;
        } catch (err) {
          console.warn('Preview movies error:', err.message);
          break;
        }
      }
    }

    if (doShows) {
      let page = 1;
      while (shows.length < limit) {
        const perPage = Math.min(limit - shows.length, 100);
        try {
          const res = await this.client.fetchShows(page, perPage);
          if (!res.data || res.data.length === 0) break;
          const filtered = res.data.filter(s => this.filterItem(s)).map(s => {
            const { title, year } = this.cleanItemTitleAndYear(s.title?.rendered || '');
            const cleanTitle = title.replace(/\b(tv\s*serija|serija)\b/gi, '').trim();
            const genres = (s.tv_show_genre || []).map(id => this.client.genreMap.get(id)).filter(Boolean);
            return {
              id: s.id,
              title: cleanTitle,
              year,
              genres,
              type: 'show',
              targetFile: `${year ? `${cleanTitle} (${year})` : cleanTitle}/...`
            };
          });
          shows.push(...filtered);
          if (page >= res.totalPages || shows.length >= limit) break;
          page++;
        } catch (err) {
          console.warn('Preview shows error:', err.message);
          break;
        }
      }
    }

    return {
      moviesFound: movies.length,
      showsFound: shows.length,
      sampleItems: [...movies, ...shows]
    };
  }
}

// ==========================================
// Main CLI Runner
// ==========================================
async function main() {
  const options = parseArgs();
  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const engine = new SyncEngine(options);
  try {
    await engine.run();
  } catch (err) {
    console.error('Fatal sync error:', err);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
