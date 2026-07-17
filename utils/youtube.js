const { execFile } = require('child_process');
const axios = require('axios');

const YT_MUSICE_URL = 'https://music.youtube.com/youtubei/v1';
const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const YT_DLP = '/tmp/yt-dlp';

function createHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Goog-Api-Format-Version': '1',
    'X-YouTube-Client-Name': '67',
    'X-YouTube-Client-Version': '1.20250101.00.00',
    'Origin': 'https://music.youtube.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };
}

function extractFromRenderer(renderer) {
  if (!renderer) return null;

  const columns = renderer.flexColumns || [];
  const titleColumn = columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const title = titleColumn.map(r => r.text).join('').trim();
  if (!title) return null;

  const thumbnail = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url ||
    renderer.thumbnail?.thumbnails?.[0]?.url || '';

  let videoId = null;
  const endpoint =
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint ||
    renderer.navigationEndpoint;

  if (endpoint?.watchEndpoint?.videoId) {
    videoId = endpoint.watchEndpoint.videoId;
  } else if (endpoint?.browseEndpoint) {
    return null;
  }

  if (!videoId) return null;

  const subtitleColumns = columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const artist = subtitleColumns.map(r => r.text).join('').replace(/•.*$/, '').trim();

  return { videoId, title, artist, thumbnail };
}

function parseSearchResults(data) {
  const results = [];

  try {
    const sections = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

    for (const section of sections) {
      const shelf = section.musicCardShelfRenderer;
      if (shelf?.contents) {
        for (const item of shelf.contents) {
          const r = extractFromRenderer(item.musicResponsiveListItemRenderer);
          if (r) results.push(r);
        }
      }

      const itemSection = section.itemSectionRenderer;
      if (itemSection?.contents) {
        for (const item of itemSection.contents) {
          if (item.musicResponsiveListItemRenderer) {
            const r = extractFromRenderer(item.musicResponsiveListItemRenderer);
            if (r && !results.find(x => x.videoId === r.videoId)) {
              results.push(r);
            }
          }
        }
      }

      const musicShelf = section.musicShelfRenderer;
      if (musicShelf?.contents) {
        for (const item of musicShelf.contents) {
          const r = extractFromRenderer(item.musicResponsiveListItemRenderer);
          if (r && !results.find(x => x.videoId === r.videoId)) {
            results.push(r);
          }
        }
      }
    }
  } catch (e) {
    console.error('Failed to parse search results:', e.message);
  }

  return results;
}

async function searchSongs(query) {
  const body = {
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20250101.00.00',
        hl: 'en',
        gl: 'US'
      }
    },
    query
  };

  try {
    const res = await axios.post(
      `${YT_MUSICE_URL}/search?key=${API_KEY}`,
      body,
      { headers: createHeaders(), timeout: 10000 }
    );
    return parseSearchResults(res.data);
  } catch (e) {
    console.error('YouTube search failed:', e.message);
    return [];
  }
}

const YT_DLP_ARGS = [
  '--no-warnings',
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  '--extractor-args', 'youtube:player_client=android_embedded',
];

function execYtDlp(args) {
  return new Promise((resolve, reject) => {
    execFile(YT_DLP, [...YT_DLP_ARGS, ...args], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function getStreamUrl(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const [json, streamUrl] = await Promise.all([
      execYtDlp(['--dump-json', '--no-playlist', url]),
      execYtDlp(['-f', 'bestaudio', '--get-url', '--no-playlist', url])
    ]);
    if (!streamUrl) return null;

    const info = JSON.parse(json);
    const isAudio = streamUrl.includes('mime=audio%2F');

    return {
      url: streamUrl,
      mimeType: isAudio ? 'audio/webm' : 'audio/mp4',
      title: info.title || 'Unknown',
      author: info.uploader || info.channel || 'Unknown',
      videoId: info.id || videoId,
      thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    };
  } catch (e) {
    console.error('yt-dlp stream failed:', e.message);
    return null;
  }
}

async function getTrending() {
  const body = {
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20250101.00.00',
        hl: 'en',
        gl: 'US'
      }
    }
  };

  try {
    const res = await axios.post(
      `${YT_MUSICE_URL}/browse?key=${API_KEY}`,
      body,
      { headers: createHeaders(), timeout: 10000 }
    );

    const sections = res.data.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    const results = [];

    for (const section of sections) {
      const shelf = section.musicCarouselShelfRenderer;
      if (!shelf) continue;

      const title = shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text || '';
      if (!title) continue;

      const items = [];
      for (const item of (shelf.contents || [])) {
        const twoRow = item.musicTwoRowItemRenderer;
        if (!twoRow) continue;

        const itemTitle = twoRow.title?.runs?.[0]?.text || '';
        const subtitle = twoRow.subtitle?.runs?.map(r => r.text).join('') || '';
        const thumbnail = twoRow.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url ||
          twoRow.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url || '';

        let videoId = '';
        let browseId = '';
        const nav = twoRow.navigationEndpoint;
        if (nav?.watchEndpoint?.videoId) {
          videoId = nav.watchEndpoint.videoId;
        } else if (nav?.browseEndpoint?.browseId) {
          browseId = nav.browseEndpoint.browseId;
        }

        if (itemTitle) {
          items.push({ title: itemTitle, subtitle, thumbnail, videoId, browseId });
        }
      }

      if (items.length > 0) {
        results.push({ title, items });
      }
    }

    return results;
  } catch (e) {
    console.error('Failed to get trending:', e.message);
    return [];
  }
}

module.exports = { searchSongs, getStreamUrl, getTrending };
