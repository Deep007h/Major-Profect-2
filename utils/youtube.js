const { execFile } = require('child_process');
const axios = require('axios');

const YT_MUSICE_URL = 'https://music.youtube.com/youtubei/v1';
const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const YT_DLP = '/tmp/yt-dlp';

function upgradeThumbnailResolution(url) {
  if (!url) return '';
  let upgraded = url;
  upgraded = upgraded.replace(/-w\d+-h\d+/, '-w500-h500');
  upgraded = upgraded.replace(/=w\d+-h\d+/, '=w500-h500');
  upgraded = upgraded.replace(/=s\d+/, '=s500');
  if (upgraded.includes('i.ytimg.com') && upgraded.includes('default.jpg')) {
    upgraded = upgraded.replace('default.jpg', 'hqdefault.jpg');
  }
  return upgraded;
}

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

  const thumbnail = upgradeThumbnailResolution(
    renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url ||
    renderer.thumbnail?.thumbnails?.[0]?.url || ''
  );

  let videoId = null;
  let browseId = null;
  const endpoint =
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint ||
    renderer.navigationEndpoint;

  if (endpoint?.watchEndpoint?.videoId) {
    videoId = endpoint.watchEndpoint.videoId;
  } else if (endpoint?.browseEndpoint?.browseId) {
    browseId = endpoint.browseEndpoint.browseId;
  }

  if (!videoId && !browseId) return null;

  const subtitleColumns = columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const artist = subtitleColumns.map(r => r.text).join('').replace(/•.*$/, '').trim();

  // Determine type based on browseId or watchEndpoint
  let type = 'song';
  if (browseId) {
    if (browseId.startsWith('UC')) {
      type = 'artist';
    } else if (browseId.startsWith('MPRE') || browseId.startsWith('OLAK')) {
      type = 'album';
    }
  }

  return { videoId, browseId, title, artist: type === 'artist' ? 'Artist' : artist, thumbnail, type };
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
            if (r) {
              const duplicate = results.find(x => 
                (r.videoId && x.videoId === r.videoId) || 
                (r.browseId && x.browseId === r.browseId)
              );
              if (!duplicate) {
                results.push(r);
              }
            }
          }
        }
      }

      const musicShelf = section.musicShelfRenderer;
      if (musicShelf?.contents) {
        for (const item of musicShelf.contents) {
          const r = extractFromRenderer(item.musicResponsiveListItemRenderer);
          if (r) {
            const duplicate = results.find(x => 
              (r.videoId && x.videoId === r.videoId) || 
              (r.browseId && x.browseId === r.browseId)
            );
            if (!duplicate) {
              results.push(r);
            }
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

const streamCache = new Map();

async function getStreamUrl(videoId) {
  if (streamCache.has(videoId)) {
    const cached = streamCache.get(videoId);
    if (Date.now() - cached.timestamp < 3 * 60 * 60 * 1000) { // 3 hours cache
      return cached.data;
    }
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // Only run the fast -g/--get-url option. This skips metadata fetching (dump-json) entirely.
    const streamUrl = await execYtDlp(['-f', 'bestaudio', '--get-url', '--no-playlist', url]);
    if (!streamUrl) return null;

    const isAudio = streamUrl.includes('mime=audio%2F');

    const result = {
      url: streamUrl,
      mimeType: isAudio ? 'audio/webm' : 'audio/mp4',
      title: 'Unknown',
      author: 'Unknown',
      videoId: videoId,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    };

    streamCache.set(videoId, {
      data: result,
      timestamp: Date.now()
    });

    return result;
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
        const twoCol = item.musicTwoColumnItemRenderer;
        const renderer = twoRow || twoCol;
        if (!renderer) continue;

        const itemTitle = renderer.title?.runs?.[0]?.text || '';
        const subtitle = renderer.subtitle?.runs?.map(r => r.text).join('') || '';
        const thumbnail = upgradeThumbnailResolution(
          renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url ||
          renderer.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url || ''
        );

        let videoId = '';
        let browseId = '';
        let type = 'other';
        const nav = renderer.navigationEndpoint;
        if (nav?.watchEndpoint?.videoId) {
          videoId = nav.watchEndpoint.videoId;
          type = 'song';
        } else if (nav?.browseEndpoint?.browseId) {
          browseId = nav.browseEndpoint.browseId;
          if (browseId.startsWith('UC')) {
            type = 'artist';
          } else if (browseId.startsWith('MPRE') || browseId.startsWith('OLAK')) {
            type = 'album';
          }
        }

        if (itemTitle) {
          items.push({ title: itemTitle, subtitle, thumbnail, videoId, browseId, type });
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

async function getArtistPage(browseId) {
  const body = {
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20250101.00.00',
        hl: 'en',
        gl: 'US'
      }
    },
    browseId
  };

  try {
    const res = await axios.post(
      `${YT_MUSICE_URL}/browse?key=${API_KEY}`,
      body,
      { headers: createHeaders(), timeout: 10000 }
    );

    const data = res.data;
    const header = data.header?.musicImmersiveHeaderRenderer || data.header?.musicVisualHeaderRenderer || {};

    const name = header.title?.runs?.[0]?.text || '';
    if (!name) return null;

    const thumbnails = header.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    const thumbnail = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : '';

    const bannerThumbnails = header.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
      header.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    const banner = bannerThumbnails.length > 0 ? bannerThumbnails[bannerThumbnails.length - 1].url : thumbnail;

    const descriptionRuns = header.description?.runs || [];
    const monthlyListeners = header.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText?.runs?.[0]?.text ||
      descriptionRuns.map(r => r.text).join('').trim() || '';

    const verified = !!(header.subtitleBadges?.some(b =>
      b.musicInlineBadgeRenderer?.icon?.iconType === 'OFFICIAL_ARTIST_BADGE' ||
      b.musicInlineBadgeRenderer?.icon?.iconType === 'CHECK_CIRCLE_THICK'
    ));

    // Parse popular songs from the first shelf section
    const tabs = data.contents?.singleColumnBrowseResultsRenderer?.tabs || [];
    const sections = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    const popularSongs = [];

    for (const section of sections) {
      const musicShelf = section.musicShelfRenderer;
      if (!musicShelf) continue;

      const shelfTitle = musicShelf.title?.runs?.[0]?.text || '';
      if (shelfTitle.toLowerCase().includes('song') || shelfTitle.toLowerCase().includes('popular') || sections.indexOf(section) === 0) {
        for (const item of (musicShelf.contents || [])) {
          const renderer = item.musicResponsiveListItemRenderer;
          if (!renderer) continue;

          const columns = renderer.flexColumns || [];

          // Title
          const titleRuns = columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
          const songTitle = titleRuns[0]?.text || '';

          // Artists
          const artistRuns = columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
          const artists = artistRuns.map(r => r.text).join('').replace(/\s*•.*$/, '').trim();

          // Plays count
          const fixedColumns = renderer.fixedColumns || [];
          const plays = fixedColumns[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text || '';

          // Duration
          const duration = fixedColumns[1]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text ||
            (renderer.fixedColumns?.length > 0 ? renderer.fixedColumns[renderer.fixedColumns.length - 1]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text : '') || '';

          // Video ID
          const overlay = renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
          const videoId = overlay?.watchEndpoint?.videoId || '';

          // Thumbnail
          const songThumb = upgradeThumbnailResolution(renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url || '');

          if (songTitle && videoId) {
            popularSongs.push({
              videoId,
              title: songTitle,
              thumbnail: songThumb,
              artists,
              plays,
              duration
            });
          }
        }
        break; // Only take the first matching shelf
      }
    }

    return {
      name,
      thumbnail,
      banner,
      monthlyListeners,
      verified,
      popularSongs
    };
  } catch (e) {
    console.error('Failed to get artist page:', e.message);
    return null;
  }
}

module.exports = { searchSongs, getStreamUrl, getTrending, getArtistPage };
