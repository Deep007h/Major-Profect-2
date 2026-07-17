const { execFile } = require('child_process');
const axios = require('axios');

const YT_MUSICE_URL = 'https://music.youtube.com/youtubei/v1';
const API_KEY = process.env.YT_INNERTUBE_KEY || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const YT_DLP = process.env.YT_DLP_PATH || '/tmp/yt-dlp';

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getHighResThumbnail(thumbnails, videoId = null) {
  if (videoId) {
    return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
  }
  if (!thumbnails || thumbnails.length === 0) return '';
  let url = thumbnails[thumbnails.length - 1].url || '';
  if (url.includes('=w') || url.includes('=s') || url.includes('=h')) {
    const baseUrl = url.split(/[=]/)[0];
    return `${baseUrl}=w544-h544-l90-rj`;
  }
  return url;
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

  // Block videos (non-ATV items)
  const overlayEndpoint = renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
  const navEndpoint = renderer.navigationEndpoint;
  const getFromEndpoint = (ep) => {
    return ep?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ||
           ep?.watchPlaylistEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
  };
  const musicVideoType = getFromEndpoint(overlayEndpoint) || getFromEndpoint(navEndpoint);
  if (musicVideoType && musicVideoType !== 'MUSIC_VIDEO_TYPE_ATV') {
    return null;
  }

  const thumbnailList = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    renderer.thumbnail?.thumbnails || [];
  const thumbnail = getHighResThumbnail(thumbnailList, videoId);

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
      // Top Result (musicCardShelfRenderer)
      const shelf = section.musicCardShelfRenderer;
      if (shelf) {
        const title = shelf.title?.runs?.[0]?.text || '';
        const endpoint = shelf.onTap || shelf.navigationEndpoint;
        let videoId = endpoint?.watchEndpoint?.videoId;
        let browseId = endpoint?.browseEndpoint?.browseId;
        
        let type = 'song';
        if (browseId) {
          if (browseId.startsWith('UC')) {
            type = 'artist';
          } else if (browseId.startsWith('MPRE') || browseId.startsWith('OLAK')) {
            type = 'album';
          }
        }
        
        const thumbnailList = shelf.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        const thumbnail = getHighResThumbnail(thumbnailList, videoId);
        
        const subtitle = shelf.subtitle?.runs?.map(r => r.text).join('') || '';
        const artist = subtitle.replace(/•.*$/, '').trim();
        
        if ((videoId || browseId) && title) {
          // Block videos (non-ATV items)
          let blockVideo = false;
          const getFromEndpoint = (ep) => {
            return ep?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ||
                   ep?.watchPlaylistEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
          };
          const musicVideoType = getFromEndpoint(endpoint);
          if (musicVideoType && musicVideoType !== 'MUSIC_VIDEO_TYPE_ATV') {
            blockVideo = true;
          }

          if (!blockVideo) {
            results.push({
              videoId,
              browseId,
              title,
              artist: type === 'artist' ? 'Artist' : artist,
              thumbnail,
              type
            });
          }
        }
      }

      // Rest of the results (itemSectionRenderer)
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

      // Rest of the results (musicShelfRenderer)
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

let cachedPunjabiArtists = [];
let cachedEnglishArtists = [];

const defaultPunjabiArtists = [
  { name: "Prem Dhillon", browseId: "UCW9eEpBfH_gWRc4ac70tj7w", thumbnail: "https://yt3.googleusercontent.com/WyNcsd5_HkKIT6KLJHjo-bIL3ayXnBKRBSYFpV2B8QWB-PjkiDg5O7peyZVKv2_ErONKtwne=w544-h544-l90-rj" },
  { name: "Sidhu Moose Wala", browseId: "UCIOXXUXQ8y5ivei97JkiBAw", thumbnail: "https://yt3.ggpht.com/ytc/AIdro_kiQJ0Hhp0O-tdaY1dy81-gSNujjccUlWstnpFr686ZlMk=w544-h544-l90-rj" },
  { name: "Karan Aujla", browseId: "UCSmK5WX5U4gdtebWjoL81og", thumbnail: "https://lh3.googleusercontent.com/k7sgqqcV5VScaMZtTmS8W_tfouLVBpgyJII0epYE2Vjw1-zzhGgUCV51aHxZn6cmZKKJgUfNlIVpZg=w544-h544-l90-rj" },
  { name: "Diljit Dosanjh", browseId: "UCJ2m-WpROlZCiZZID9r7NSQ", thumbnail: "https://yt3.googleusercontent.com/7EYXXMXY594V8y4sZT2aawmdKgDAGTu5jNm9C-HpR3jY9cZJ0NMxS__nZKBdWZ1PUpJPjc2BAA=w544-h544-l90-rj" },
  { name: "Shubh", browseId: "UCDoxhZGShhNvN4Bc3nWZptg", thumbnail: "https://lh3.googleusercontent.com/xGLCqdWB64eQARHXZdE4ut8VkNK7UnkrRKmQ4Bnx5ksOSmXctLUiEzjd4fh48EdpslwA219yNJnKU3k=w544-h544-l90-rj" },
  { name: "Arjan Dhillon", browseId: "UC4gE0O_SyPb1cuRNzT_NMqQ", thumbnail: "https://yt3.googleusercontent.com/mXv94eUP3RgCjA_HdMzJo3YWR0wLJJr58UY2ypLI1meFjGftlOOYbp-Ezw8hiUAKRipcgi4B=w544-h544-l90-rj" }
];

const defaultEnglishArtists = [
  { name: "The Weeknd", browseId: "UClYV6hHlupm_S_ObS1W-DYw", thumbnail: "https://lh3.googleusercontent.com/U-SAmNOu4TynE818gLCfKsuHZ0U5YNEtO9mrjSI9WCCKERs98LzrCal5kajBBTQNwdcisoB2Bn-pHp4=w544-h544-l90-rj" },
  { name: "Drake", browseId: "UCU6cE7pdJPc6DU2jSrKEsdQ", thumbnail: "https://yt3.googleusercontent.com/qqxv5qVDpNvVobACzp-FFrArjlSs-NayarhdG8P7XCvTpfpynDVbkOv4W7USru2NKaQbmWbWcopm6grH=w544-h544-l90-rj" },
  { name: "Taylor Swift", browseId: "UCPC0L1d253x-KuMNwa05TpA", thumbnail: "https://yt3.googleusercontent.com/RCpTA6EXJQyjVFDosWOKa2SMmqkua_lA9mHPDWWciLwgqpZLz-k8rXWRF_367trrQ7up9BUwCbk6kRk=w544-h544-l90-rj" },
  { name: "Ed Sheeran", browseId: "UClmXPfaYhXOYsNn_QUyheWQ", thumbnail: "https://lh3.googleusercontent.com/jQoBIAS6JjFGpcqQY1M_Mh3AasOvFENCdVRxkgax1a0K6qiq7AgE3MbJ6Jtt-Jndcarvoawmrg66KTny=w544-h544-l90-rj" },
  { name: "Bruno Mars", browseId: "UCZn4r7heNOPY-C43YIywnVA", thumbnail: "https://lh3.googleusercontent.com/hnefGBrazRhn4Z92bdSZBUENl40ONjRiVDsmZKZh-WZ2iCKE-2c7KKR7SNcZfzLHoRyB3E6as8L87YA=w544-h544-l90-rj" },
  { name: "Post Malone", browseId: "UCyD3XWRK9ko-izf2nBSFitw", thumbnail: "https://lh3.googleusercontent.com/48LfK4z6o-CCEWgHQnQfg0ltcT9tbZSN0qjSh0FSJsJI5GF48j2-pH219ciG1ML-PI80ZGD4Vz6sjg=w544-h544-l90-rj" },
  { name: "Travis Scott", browseId: "UCf_gP4AMRSgAfyzbkeS9k4g", thumbnail: "https://yt3.googleusercontent.com/r9k_FpAswxhQnl_cudiaT2ocWFccR6SzEFXgZ9a12iR5eDPSILlIL2EQewyQ-yYSt1JFyH1pqnoBXxs=w544-h544-l90-rj" }
];

async function getCuratedArtistList(artists) {
  const promises = artists.map(async (a) => {
    try {
      const searchRes = await searchSongs(a.name);
      const matched = searchRes.find(item => item.type === 'artist' && (item.browseId === a.browseId || item.title.toLowerCase() === a.name.toLowerCase()));
      if (matched) {
        return {
          title: matched.title,
          subtitle: "Artist",
          thumbnail: matched.thumbnail,
          browseId: matched.browseId,
          type: 'artist'
        };
      }
    } catch (err) {
      console.error(`Error resolving artist ${a.name}:`, err.message);
    }
    return {
      title: a.name,
      subtitle: "Artist",
      thumbnail: a.thumbnail,
      browseId: a.browseId,
      type: 'artist'
    };
  });
  return Promise.all(promises);
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
          } else {
            type = 'album';
          }
        }

        if (!videoId && !browseId) continue;

        // Block videos (non-ATV items)
        const getFromEndpoint = (ep) => {
          return ep?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ||
                 ep?.watchPlaylistEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
        };
        const musicVideoType = getFromEndpoint(nav);
        if (musicVideoType && musicVideoType !== 'MUSIC_VIDEO_TYPE_ATV') {
          continue;
        }

        const thumbnailList = renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
          renderer.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail?.thumbnails || [];
        const thumbnail = getHighResThumbnail(thumbnailList, videoId);

        if (itemTitle) {
          items.push({ title: itemTitle, subtitle, thumbnail, videoId, browseId, type });
        }
      }

      if (items.length > 0) {
        results.push({ title, items: shuffleArray(items) });
      }
    }

    // Curated Punjabi Artists Row
    try {
      if (cachedPunjabiArtists.length === 0) {
        cachedPunjabiArtists = await getCuratedArtistList(defaultPunjabiArtists);
      }
      if (cachedPunjabiArtists.length > 0) {
        results.push({
          title: "Popular Punjabi Artists",
          items: cachedPunjabiArtists
        });
      }
    } catch (err) {
      console.error("Failed to load curated Punjabi artists:", err.message);
    }

    // Curated English Artists Row
    try {
      if (cachedEnglishArtists.length === 0) {
        cachedEnglishArtists = await getCuratedArtistList(defaultEnglishArtists);
      }
      if (cachedEnglishArtists.length > 0) {
        results.push({
          title: "Popular English Artists",
          items: cachedEnglishArtists
        });
      }
    } catch (err) {
      console.error("Failed to load curated English artists:", err.message);
    }

    // Also fetch Punjabi Hits to enrich the feed
    try {
      const punjabiSongs = await searchSongs("Punjabi Songs");
      if (punjabiSongs && punjabiSongs.length > 0) {
        const punjabiItems = punjabiSongs.filter(item => item.type === 'song' || item.type === 'album');
        if (punjabiItems.length > 0) {
          results.push({
            title: "Trending Punjabi Hits",
            items: shuffleArray(punjabiItems).slice(0, 10)
          });
        }
      }
    } catch (err) {
      console.error("Failed to append Punjabi hits:", err.message);
    }

    return results;
  } catch (e) {
    console.error('Failed to get trending:', e.message);
    return [];
  }
}

function parseCarouselItem(item) {
  const renderer = item.musicTwoRowItemRenderer;
  if (!renderer) return null;

  const title = renderer.title?.runs?.[0]?.text || '';
  const subtitle = renderer.subtitle?.runs?.map(r => r.text).join('') || '';
  
  const thumbnails = renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
  const thumbnail = getHighResThumbnail(thumbnails);
  
  const endpoint = renderer.navigationEndpoint || renderer.title?.runs?.[0]?.navigationEndpoint;
  const browseId = endpoint?.browseId || endpoint?.browseEndpoint?.browseId || endpoint?.watchPlaylistEndpoint?.playlistId || '';
  const videoId = endpoint?.watchEndpoint?.videoId || '';
  
  const pageType = endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
  let type = 'album';
  if (pageType === 'MUSIC_PAGE_TYPE_ARTIST') {
    type = 'artist';
  } else if (pageType === 'MUSIC_PAGE_TYPE_PLAYLIST') {
    type = 'playlist';
  }
  
  return {
    title,
    subtitle,
    thumbnail,
    browseId,
    videoId,
    type
  };
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

    const tabs = data.contents?.singleColumnBrowseResultsRenderer?.tabs || [];
    const sections = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    
    const popularSongs = [];
    const albums = [];
    const singles = [];
    const featuredOn = [];
    const playlists = [];
    const fansAlsoLike = [];
    let aboutDescription = '';
    let aboutMonthlyListeners = '';

    for (const section of sections) {
      const type = Object.keys(section)[0];
      const renderer = section[type];
      if (!renderer) continue;

      let title = renderer.title?.runs?.[0]?.text || '';
      if (!title && renderer.header) {
        const headerType = Object.keys(renderer.header)[0];
        title = renderer.header[headerType]?.title?.runs?.[0]?.text || '';
      }

      const contents = renderer.contents || [];

      if (type === 'musicShelfRenderer') {
        if (popularSongs.length === 0 && (title.toLowerCase().includes('song') || title.toLowerCase().includes('popular') || sections.indexOf(section) === 0)) {
          for (const item of (renderer.contents || [])) {
            const rowRenderer = item.musicResponsiveListItemRenderer;
            if (!rowRenderer) continue;

            const columns = rowRenderer.flexColumns || [];
            const songTitle = columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
            const artists = columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map(r => r.text).join('').replace(/\s*•.*$/, '').trim();

            const fixedColumns = rowRenderer.fixedColumns || [];
            const plays = fixedColumns[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text || '';
            const duration = fixedColumns[1]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text ||
              (rowRenderer.fixedColumns?.length > 0 ? rowRenderer.fixedColumns[rowRenderer.fixedColumns.length - 1]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text : '') || '';

            const overlay = rowRenderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
            const videoId = overlay?.watchEndpoint?.videoId || '';

            const getFromEndpoint = (ep) => {
              return ep?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ||
                     ep?.watchPlaylistEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
            };
            const musicVideoType = getFromEndpoint(overlay) || getFromEndpoint(rowRenderer.navigationEndpoint);
            if (musicVideoType && musicVideoType !== 'MUSIC_VIDEO_TYPE_ATV') {
              continue;
            }

            const songThumb = getHighResThumbnail(rowRenderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [], videoId);

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
        }
      } else if (type === 'musicCarouselShelfRenderer') {
        const items = [];
        for (const item of contents) {
          const parsed = parseCarouselItem(item);
          if (parsed) items.push(parsed);
        }

        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes('album')) {
          albums.push(...items);
        } else if (lowerTitle.includes('single') || lowerTitle.includes('ep')) {
          singles.push(...items);
        } else if (lowerTitle.includes('featured') || lowerTitle.includes('featuring')) {
          featuredOn.push(...items);
        } else if (lowerTitle.includes('playlist')) {
          playlists.push(...items);
        } else if (lowerTitle.includes('fans') || lowerTitle.includes('like') || lowerTitle.includes('similar')) {
          fansAlsoLike.push(...items);
        }
      } else if (type === 'musicDescriptionShelfRenderer') {
        const runs = renderer.runs || [];
        aboutDescription = runs.map(r => r.text).join('').trim();
        aboutMonthlyListeners = renderer.subheader?.runs?.[0]?.text || '';
      }
    }

    const artistPick = albums.length > 0 ? albums[0] : (singles.length > 0 ? singles[0] : null);
    if (artistPick) {
      artistPick.label = "Album of the year";
    }

    return {
      name,
      thumbnail,
      banner,
      monthlyListeners,
      verified,
      popularSongs,
      albums,
      singles,
      featuredOn,
      playlists,
      fansAlsoLike,
      aboutDescription,
      aboutMonthlyListeners,
      artistPick
    };
  } catch (e) {
    console.error('Failed to get artist page:', e.message);
    return null;
  }
}

function findItemRenderers(obj) {
  let renderers = [];
  if (!obj || typeof obj !== 'object') return renderers;
  
  if (obj.musicResponsiveListItemRenderer || obj.musicPlaylistItemRenderer) {
    renderers.push(obj.musicResponsiveListItemRenderer || obj.musicPlaylistItemRenderer);
    return renderers;
  }
  
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === 'object') {
      renderers = renderers.concat(findItemRenderers(val));
    }
  }
  return renderers;
}

async function getAlbum(browseId) {
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
    
    // Parse tracks using the recursive scanner
    const renderers = findItemRenderers(data);
    const tracks = [];
    
    for (const r of renderers) {
      const parsed = extractFromRenderer(r);
      if (parsed && parsed.videoId) {
        tracks.push({
          videoId: parsed.videoId,
          title: parsed.title,
          artist: parsed.artist,
          thumbnail: parsed.thumbnail
        });
      }
    }

    return { title: '', artist: '', tracks };
  } catch (e) {
    console.error('Failed to get album details:', e.message);
    return null;
  }
}

module.exports = { searchSongs, getStreamUrl, getTrending, getArtistPage, getAlbum };
