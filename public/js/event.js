/* ===== DOM ELEMENTS ===== */
const progress = document.getElementById("progress");
const song = document.getElementById("song");
const ctrlIcn = document.getElementById("ctrlIcn");
const volumeSlider = document.getElementById("volumeSlider");
const currentSongTitle = document.getElementById("currentSongTitle");
const currentSongArtist = document.getElementById("currentSongArtist");
const currentSongImg = document.getElementById("currentSongImg");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
const songPanel = document.getElementById("songPanel");
const nowPlayingPanel = document.getElementById("nowPlayingPanel");
const queuePanel = document.getElementById("queuePanel");
const fullscreenOverlay = document.getElementById("fullscreenOverlay");

let queue = [];
let queueIndex = -1;
let currentVideoId = null;
let isNowPlayingOpen = false;
let isQueueOpen = false;
let playbackRequestId = 0;
const streamPromises = new Map();

let ytPlayer = null;
let ytPlayerReady = false;

const playerController = {
  isYt: false,
  play: function() {
    if (this.isYt) {
      if (ytPlayer && ytPlayerReady && typeof ytPlayer.playVideo === 'function') {
        ytPlayer.playVideo();
      }
      return Promise.resolve();
    } else {
      return song.play();
    }
  },
  pause: function() {
    if (this.isYt) {
      if (ytPlayer && ytPlayerReady && typeof ytPlayer.pauseVideo === 'function') {
        ytPlayer.pauseVideo();
      }
    } else {
      song.pause();
    }
  },
  setVolume: function(v) {
    if (ytPlayer && ytPlayerReady && typeof ytPlayer.setVolume === 'function') {
      ytPlayer.setVolume(v * 100);
    }
    if (song) song.volume = v;
  },
  seek: function(seconds) {
    if (this.isYt) {
      if (ytPlayer && ytPlayerReady && typeof ytPlayer.seekTo === 'function') {
        ytPlayer.seekTo(seconds, true);
      }
    } else {
      if (song) song.currentTime = seconds;
    }
  },
  getCurrentTime: function() {
    if (this.isYt) {
      return ytPlayer && ytPlayerReady && typeof ytPlayer.getCurrentTime === 'function' ? ytPlayer.getCurrentTime() : 0;
    }
    return song ? song.currentTime : 0;
  },
  getDuration: function() {
    if (this.isYt) {
      return ytPlayer && ytPlayerReady && typeof ytPlayer.getDuration === 'function' ? ytPlayer.getDuration() : 0;
    }
    return song ? song.duration : 0;
  }
};

window.onYouTubeIframeAPIReady = function() {
  ytPlayer = new YT.Player('ytPlayer', {
    height: '1',
    width: '1',
    videoId: '',
    playerVars: {
      'playsinline': 1,
      'controls': 0,
      'disablekb': 1,
      'fs': 0,
      'rel': 0,
      'showinfo': 0
    },
    events: {
      'onReady': () => {
        ytPlayerReady = true;
        if (volumeSlider) {
          playerController.setVolume(parseFloat(volumeSlider.value));
        }
      },
      'onStateChange': (event) => {
        if (event.data === YT.PlayerState.ENDED) {
          playNext();
        } else if (event.data === YT.PlayerState.PLAYING) {
          setPlayIcon(true);
        } else if (event.data === YT.PlayerState.PAUSED) {
          setPlayIcon(false);
        }
      },
      'onError': (err) => {
        console.error("YouTube Player error:", err);
        playNext();
      }
    }
  });
};

setInterval(() => {
  if (playerController.isYt && ytPlayer && ytPlayerReady && typeof ytPlayer.getCurrentTime === 'function') {
    const cur = ytPlayer.getCurrentTime();
    const dur = ytPlayer.getDuration();
    if (dur && isFinite(dur)) {
      progress.max = dur;
      progress.value = cur;
      document.getElementById("currentTime").textContent = formatTime(cur);
      document.getElementById("totalTime").textContent = formatTime(dur);
      updateProgressBar();
    }
  }
}, 250);


/* ===== SPA CLIENT ROUTER ===== */
function navigateTo(url, updateHistory = true) {
  const mainContent = document.getElementById("mainContent");
  if (!mainContent) return;

  fetch(url, {
    headers: {
      "X-Spa-Navigation": "true"
    }
  })
  .then(r => r.text())
  .then(html => {
    mainContent.innerHTML = html;
    mainContent.scrollTop = 0;

    if (typeof syncAllFollowButtons === 'function') {
      syncAllFollowButtons();
    }

    const spaTitleEl = mainContent.querySelector("#spaPageTitle");
    if (spaTitleEl && spaTitleEl.dataset.title) {
      document.title = spaTitleEl.dataset.title;
    }

    if (updateHistory) {
      history.pushState({ url }, "", url);
    }

    // Re-initialize dynamic page scripts & features depending on path
    const path = url.split("?")[0];
    if (path === "/spotify" || path === "/spotify/") {
      setGreeting();
      fetch("/api/browse")
        .then(r => r.json())
        .then(data => {
          if (data.sections && data.sections.length > 0) {
            renderTrendingSections(data.sections);
          }
        })
        .catch(e => console.error("Browse error:", e));
    } else if (path.includes("/spotify/artist/")) {
      const scriptTags = mainContent.querySelectorAll("script");
      scriptTags.forEach(script => {
        const newScript = document.createElement("script");
        newScript.text = script.text;
        script.parentNode.replaceChild(newScript, script);
      });
    }
  })
  .catch(err => {
    console.error("SPA failed, loading natively:", err);
    window.location.href = url;
  });
}
window.navigateTo = navigateTo;

// Global link click interceptor for SPA navigation
document.addEventListener("click", function (e) {
  const link = e.target.closest("a");
  if (!link) return;
  if (link.target === "_blank" || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

  const href = link.getAttribute("href");
  if (!href) return;

  if (href.startsWith("/spotify") && !href.includes("/logout") && !href.includes("/login") && !href.includes("/signup") && !href.includes("/add") && !href.includes("/song/")) {
    e.preventDefault();
    navigateTo(href);
  }
});

// Popstate handler for browser back/forward buttons
window.addEventListener("popstate", function (e) {
  const url = e.state?.url || window.location.pathname;
  if (url.startsWith("/spotify")) {
    navigateTo(url, false);
  }
});

// Unified Global Click Listener for dynamically loaded elements
document.addEventListener("click", function (e) {
  const playBtn = e.target.closest(".play-btn-overlay");

  // 1. Card click (.song-card, .album-card, .artist-card, .trending-card-song)
  const card = e.target.closest(".song-card, .album-card, .artist-card, .trending-card-song");
  if (card) {
    const browseId = card.dataset.browseId;
    const videoId = card.dataset.videoId;

    if (browseId) {
      // It is an Artist or Album
      const isArtist = browseId.startsWith("UC");

      if (playBtn) {
        e.stopPropagation();
        if (isArtist) {
          fetch(`/api/artist/${browseId}`)
            .then(r => r.json())
            .then(data => {
              if (data.popularSongs && data.popularSongs.length > 0) {
                const popularQueue = data.popularSongs.map(s => ({
                  videoId: s.videoId,
                  title: s.title,
                  artist: s.artists || data.name || "Unknown",
                  thumbnail: s.thumbnail
                }));

                requestStream(popularQueue[0].videoId).catch(() => {});

                // Fetch extra tracks by searching the artist name
                const artistSearchName = data.name || card.dataset.title;
                fetch(`/api/search?q=${encodeURIComponent(artistSearchName + " songs")}`)
                  .then(sr => sr.json())
                  .then(searchData => {
                    const extraTracks = (searchData.results || [])
                      .filter(r => r.type === 'song' && r.artist && (
                        r.artist.toLowerCase().includes(artistSearchName.toLowerCase()) ||
                        artistSearchName.toLowerCase().includes(r.artist.toLowerCase())
                      ))
                      .map(s => ({
                        videoId: s.videoId,
                        title: s.title,
                        artist: s.artist,
                        thumbnail: s.thumbnail
                      }));

                    const fullQueue = [...popularQueue];
                    extraTracks.forEach(t => {
                      if (!fullQueue.some(q => q.videoId === t.videoId)) {
                        fullQueue.push(t);
                      }
                    });

                    const first = fullQueue[0];
                    playSong(first.videoId, first.title, first.artist, first.thumbnail, fullQueue);
                    if (!isNowPlayingOpen) {
                      toggleNowPlaying();
                    }
                  })
                  .catch(() => {
                    const first = popularQueue[0];
                    playSong(first.videoId, first.title, first.artist, first.thumbnail, popularQueue);
                    if (!isNowPlayingOpen) {
                      toggleNowPlaying();
                    }
                  });
              }
            })
            .catch(err => console.error("Failed to play artist popular tracks:", err));
        } else {
          // Album playback
          fetch(`/api/album/${browseId}`)
            .then(r => r.json())
            .then(data => {
              if (data.tracks && data.tracks.length > 0) {
                const first = data.tracks[0];
                playSong(first.videoId, first.title, first.artist, first.thumbnail, data.tracks);
                if (!isNowPlayingOpen) {
                  toggleNowPlaying();
                }
              }
            })
            .catch(err => console.error("Failed to play album:", err));
        }
      } else {
        // Navigate
        if (isArtist) {
          navigateTo(`/spotify/artist/${browseId}`);
        } else {
          const title = card.dataset.title || "Album";
          const artist = card.dataset.subtitle || card.dataset.artist || "";
          const thumbnail = card.querySelector("img")?.src || "";
          const params = new URLSearchParams({ title, artist, thumbnail });
          navigateTo(`/spotify/album/${encodeURIComponent(browseId)}?${params.toString()}`);
        }
      }
      return;
    }

    // If it has no browseId but has videoId (Song card)
    if (videoId) {
      const title = card.dataset.title || "Unknown";
      const subtitle = card.dataset.subtitle || card.dataset.artist || "";
      const img = card.querySelector("img")?.src || '';
      playSong(videoId, title, subtitle, img);
    }
    return;
  }

  // 2. Track Row click
  const row = e.target.closest(".track-row");
  if (row) {
    const videoId = row.dataset.videoId;
    if (videoId) {
      const container = row.closest(".tracks-table, .album-tracks-table");
      let customQueue = null;
      if (container) {
        const trackRows = container.querySelectorAll(".track-row");
        customQueue = Array.from(trackRows).map(r => ({
          videoId: r.dataset.videoId,
          title: r.dataset.title || "Unknown",
          artist: r.dataset.artist || "Unknown",
          thumbnail: r.dataset.thumbnail || ''
        }));
      }
      playSong(videoId, row.dataset.title || "Unknown", row.dataset.artist || "Unknown", row.dataset.thumbnail || '', customQueue);
    }
    return;
  }

  // 3. Quick Access Card click
  const qaCard = e.target.closest(".qa-card");
  if (qaCard) {
    const qPlayBtn = e.target.closest(".play-btn-overlay");
    const browseId = qaCard.dataset.browseId;
    const videoId = qaCard.dataset.videoId;
    const title = qaCard.dataset.title;
    const artist = qaCard.dataset.artist || title;
    const image = qaCard.dataset.image || qaCard.querySelector("img")?.src;

    if (qPlayBtn) {
      e.stopPropagation();
      if (browseId) {
        fetch(`/api/artist/${browseId}`)
          .then(r => r.json())
          .then(data => {
            if (data.popularSongs && data.popularSongs.length > 0) {
              const popularQueue = data.popularSongs.map(s => ({
                videoId: s.videoId,
                title: s.title,
                artist: s.artists || data.name || "Unknown",
                thumbnail: s.thumbnail
              }));

              const artistSearchName = data.name || title;
              fetch(`/api/search?q=${encodeURIComponent(artistSearchName + " songs")}`)
                .then(sr => sr.json())
                .then(searchData => {
                  const extraTracks = (searchData.results || [])
                    .filter(r => r.type === 'song' && r.artist && (
                      r.artist.toLowerCase().includes(artistSearchName.toLowerCase()) ||
                      artistSearchName.toLowerCase().includes(r.artist.toLowerCase())
                    ))
                    .map(s => ({
                      videoId: s.videoId,
                      title: s.title,
                      artist: s.artist,
                      thumbnail: s.thumbnail
                    }));

                  const fullQueue = [...popularQueue];
                  extraTracks.forEach(t => {
                    if (!fullQueue.some(q => q.videoId === t.videoId)) {
                      fullQueue.push(t);
                    }
                  });

                  const first = fullQueue[0];
                  playSong(first.videoId, first.title, first.artist, first.thumbnail, fullQueue);
                  if (!isNowPlayingOpen) {
                    toggleNowPlaying();
                  }
                })
                .catch(() => {
                  const first = popularQueue[0];
                  playSong(first.videoId, first.title, first.artist, first.thumbnail, popularQueue);
                  if (!isNowPlayingOpen) {
                    toggleNowPlaying();
                  }
                });
            }
          });
      } else if (videoId) {
        playSong(videoId, title, artist, image);
      }
    } else {
      if (browseId) {
        navigateTo(`/spotify/artist/${browseId}`);
      } else if (videoId) {
        playSong(videoId, title, artist, image);
      }
    }
    return;
  }

  // 4. Artist Page Green Play Button
  const artistPlayBtn = e.target.closest(".artist-play-btn");
  if (artistPlayBtn) {
    const trackRows = document.querySelectorAll(".track-row");
    if (trackRows.length > 0) {
      const firstRow = trackRows[0];
      const videoId = firstRow.dataset.videoId;
      const title = firstRow.dataset.title;
      const artist = firstRow.dataset.artist;
      const thumbnail = firstRow.dataset.thumbnail;

      const artistHeaderName = document.querySelector(".artist-name")?.textContent?.trim() || artist;

      const popularQueue = Array.from(trackRows).map(row => ({
        videoId: row.dataset.videoId,
        title: row.dataset.title,
        artist: row.dataset.artist,
        thumbnail: row.dataset.thumbnail
      }));

      fetch(`/api/search?q=${encodeURIComponent(artistHeaderName + " songs")}`)
        .then(sr => sr.json())
        .then(searchData => {
          const extraTracks = (searchData.results || [])
            .filter(r => r.type === 'song' && r.artist && (
              r.artist.toLowerCase().includes(artistHeaderName.toLowerCase()) ||
              artistHeaderName.toLowerCase().includes(r.artist.toLowerCase())
            ))
            .map(s => ({
              videoId: s.videoId,
              title: s.title,
              artist: s.artist,
              thumbnail: s.thumbnail
            }));

          const fullQueue = [...popularQueue];
          extraTracks.forEach(t => {
            if (!fullQueue.some(q => q.videoId === t.videoId)) {
              fullQueue.push(t);
            }
          });

          playSong(videoId, title, artist, thumbnail, fullQueue);
          if (!isNowPlayingOpen) {
            toggleNowPlaying();
          }
        })
        .catch(() => {
          playSong(videoId, title, artist, thumbnail, popularQueue);
          if (!isNowPlayingOpen) {
            toggleNowPlaying();
          }
        });
    }
    return;
  }

  // 5. Album Page Play Button
  const albumPlayBtn = e.target.closest("#albumPlayBtn");
  if (albumPlayBtn) {
    const rows = Array.from(document.querySelectorAll(".album-track-row"));
    if (!rows.length) return;
    const albumQueue = rows.map(row => ({
      videoId: row.dataset.videoId,
      title: row.dataset.title || "Unknown",
      artist: row.dataset.artist || "Unknown",
      thumbnail: row.dataset.thumbnail || row.querySelector("img")?.src || ""
    }));
    const first = albumQueue[0];
    playSong(first.videoId, first.title, first.artist, first.thumbnail, albumQueue);
    return;
  }
});


/* ===== UTILITY ===== */
function getVideoIdFromThumbnail(url) {
  const match = (url || '').match(/\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

function getHighResThumbnail(url, videoId = null) {
  const id = videoId || getVideoIdFromThumbnail(url);
  // maxresdefault (1280×720, no letterbox bars) is preferred.
  // recoverThumbnail will fall back gracefully if it 404s.
  if (id) return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
  if (!url) return '';

  if (url.includes('=w') || url.includes('=s') || url.includes('=h')) {
    const baseUrl = url.split(/[=]/)[0];
    return `${baseUrl}=w1200-h1200-l90-rj`;
  }
  return url;
}

function recoverThumbnail(img) {
  if (!img || img.dataset.thumbnailFailed === 'true') return;
  const videoId = img.dataset.videoId || img.closest('[data-video-id]')?.dataset.videoId || getVideoIdFromThumbnail(img.currentSrc || img.src);
  const tried = Number(img.dataset.thumbnailAttempt || 0);
  const source = img.currentSrc || img.src;
  // Order: maxresdefault → sddefault → hqdefault → mqdefault → default
  // (hqdefault has letterbox bars; mqdefault is 16:9 and bar-free but small)
  const candidates = videoId
    ? ['maxresdefault.jpg', 'sddefault.jpg', 'hqdefault.jpg', 'mqdefault.jpg', 'default.jpg'].map(size => `https://i.ytimg.com/vi/${videoId}/${size}`)
    : (source.includes('googleusercontent.com') || source.includes('ggpht.com'))
      ? ['w1200-h1200-l90-rj', 'w544-h544-l90-rj', 'w240-h240-l90-rj'].map(size => `${source.split('=')[0]}=${size}`)
      : [];
  const next = candidates.filter(url => url !== img.currentSrc && url !== img.src)[tried];

  if (next) {
    img.dataset.thumbnailAttempt = String(tried + 1);
    img.src = next;
    return;
  }

  // Do not replace missing art with an unrelated stock image. The image is
  // hidden only after every known YouTube size has been tried.
  img.dataset.thumbnailFailed = 'true';
  img.removeAttribute('src');
  img.classList.add('thumbnail-unavailable');
}

window.recoverThumbnail = recoverThumbnail;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/image-cache-sw.js', { scope: '/' }).catch(() => {});
  }, { once: true });
}

document.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement) {
    event.stopImmediatePropagation();
    recoverThumbnail(event.target);
  }
}, true);

// Begin resolving a track while the pointer is over its card. By the time the
// click arrives the server URL is commonly already cached and playback starts
// without waiting for another yt-dlp process.
document.addEventListener('pointerover', event => {
  const card = event.target.closest?.('[data-video-id]');
  const videoId = card?.dataset.videoId;
  if (videoId && !card.dataset.streamWarmed) {
    card.dataset.streamWarmed = 'true';
    requestStream(videoId).catch(() => { card.dataset.streamWarmed = ''; });
  }
}, { passive: true });

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatNumber(num) {
  if (!num) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function escapeQuotes(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function getPlayIcon() {
  return ctrlIcn ? ctrlIcn.querySelector("i") : null;
}

function setPlayIcon(playing) {
  const icon = getPlayIcon();
  if (icon) icon.className = playing ? "fa-solid fa-pause" : "fa-solid fa-play";
}

function requestStream(videoId) {
  if (streamPromises.has(videoId)) return streamPromises.get(videoId);
  const promise = fetch(`/api/stream/${encodeURIComponent(videoId)}`, { cache: "force-cache" })
    .then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || "Could not load this stream.");
      return data;
    })
    .catch(error => {
      streamPromises.delete(videoId);
      throw error;
  });
  streamPromises.set(videoId, promise);
  // Signed YouTube URLs expire; keep the browser-side warm cache short-lived.
  window.setTimeout(() => {
    if (streamPromises.get(videoId) === promise) streamPromises.delete(videoId);
  }, 10 * 60 * 1000);
  return promise;
}

function preloadThumbnail(url, videoId) {
  const source = getHighResThumbnail(url, videoId);
  if (!source) return;
  const image = new Image();
  image.decoding = "async";
  image.src = source;
}

function prefetchNextStream() {
  const next = queue[queueIndex + 1];
  if (!next?.videoId) return;
  // Warm the server-side URL cache after the active stream has started.
  requestStream(next.videoId).catch(() => {});
}

/* ===== AUDIO EVENTS ===== */
if (song) {
  song.onloadedmetadata = function () {
    if (song.duration && isFinite(song.duration)) {
      progress.max = song.duration;
      progress.value = song.currentTime;
    }
  };

  song.ontimeupdate = function () {
    if (song.duration && isFinite(song.duration)) {
      progress.value = song.currentTime;
      document.getElementById("currentTime").textContent = formatTime(song.currentTime);
      document.getElementById("totalTime").textContent = formatTime(song.duration);
      updateProgressBar();
    }
  };

  song.onended = function () {
    setPlayIcon(false);
    playNext();
  };

  song.onerror = function () {
    console.error("Audio playback error:", song.error ? song.error.message : "unknown");
    setPlayIcon(false);
  };

  if (volumeSlider) {
    volumeSlider.addEventListener("input", function () {
      playerController.setVolume(parseFloat(this.value));
      updateVolumeBar();
      updateVolumeIcon();
    });
  }
}

/* ===== PROGRESS & VOLUME BAR VISUAL ===== */
function updateProgressBar() {
  if (!progress) return;
  const cur = playerController.getCurrentTime();
  const dur = playerController.getDuration();
  if (!dur) return;
  const pct = (cur / dur) * 100;
  const fill = document.getElementById("sliderProgress");
  if (fill) fill.style.width = pct + '%';
  progress.style.background = `linear-gradient(to right, #1db954 0%, #1db954 ${pct}%, #4d4d4d ${pct}%)`;
}

function updateVolumeBar() {
  if (!volumeSlider) return;
  const pct = volumeSlider.value * 100;
  const fill = document.getElementById("volumeProgress");
  if (fill) fill.style.width = pct + '%';
  volumeSlider.style.background = `linear-gradient(to right, #1db954 0%, #1db954 ${pct}%, #4d4d4d ${pct}%)`;
}

function updateVolumeIcon() {
  const icon = document.getElementById("volumeIcon");
  if (!icon || !volumeSlider) return;
  const v = parseFloat(volumeSlider.value);
  if (v === 0) icon.className = "fa-solid fa-volume-xmark";
  else if (v < 0.3) icon.className = "fa-solid fa-volume-off";
  else if (v < 0.7) icon.className = "fa-solid fa-volume-low";
  else icon.className = "fa-solid fa-volume-high";
}

function resumeStoredSong() {
  if (!currentVideoId) return;
  const requestId = ++playbackRequestId;
  setPlayIcon(true);
  requestStream(currentVideoId)
    .then(data => {
      if (requestId !== playbackRequestId) return;
      playerController.isYt = false;
      song.src = data.url;
      song.load();
      song.play().then(() => {
        if (requestId === playbackRequestId) {
          setPlayIcon(true);
          prefetchNextStream();
        }
      }).catch(e => {
        console.error("Failed to resume stored song:", e);
        setPlayIcon(false);
      });
    })
    .catch(err => {
      console.error("Stream request failed:", err);
      setPlayIcon(false);
    });
}

/* ===== PLAY / PAUSE ===== */
function playpause() {
  const icon = getPlayIcon();
  if (!icon) return;

  if (icon.classList.contains("fa-circle-pause") || icon.classList.contains("fa-pause")) {
    playerController.pause();
    setPlayIcon(false);
  } else {
    if (currentVideoId && (!song.src || song.src === window.location.href || song.src === "")) {
      resumeStoredSong();
    } else {
      playerController.play().catch(e => console.error("Playback failed:", e));
      setPlayIcon(true);
    }
  }
}
window.playpause = playpause;

if (progress) {
  progress.addEventListener("input", function () {
    const dur = playerController.getDuration();
    if (dur && isFinite(dur)) {
      playerController.seek(parseFloat(this.value));
      updateProgressBar();
    }
  });
}

/* ===== QUEUE MANAGEMENT ===== */
function extractSongsFromPage() {
  const cards = document.querySelectorAll(".song-card, .trending-card-song, .track-row, .sidebar-playlist-item");
  const songs = [];
  cards.forEach(card => {
    const vid = card.dataset.videoId;
    if (vid) {
      // Avoid duplicates in queue
      if (!songs.some(s => s.videoId === vid)) {
        songs.push({
          videoId: vid,
          title: card.dataset.title || "Unknown",
          artist: card.dataset.artist || card.dataset.subtitle || "Unknown",
          thumbnail: getHighResThumbnail(card.querySelector("img")?.src || card.dataset.image || '', vid)
        });
      }
    }
  });
  return songs;
}

function fallbackToYouTubePlayer(videoId, requestId) {
  if (requestId !== playbackRequestId) return;
  playerController.isYt = true;
  if (song) {
    song.src = "";
    song.load();
  }
  if (ytPlayer && ytPlayerReady && typeof ytPlayer.loadVideoById === 'function') {
    ytPlayer.loadVideoById(videoId);
    setPlayIcon(true);
  } else {
    setTimeout(() => fallbackToYouTubePlayer(videoId, requestId), 500);
  }
}

/* ===== PLAY SONG ===== */
function playSong(videoId, title, artist, thumbnail, customQueue = null) {
  if (!song || !videoId) return;

  try {
    localStorage.setItem("lastPlayedSong", JSON.stringify({
      videoId: videoId,
      title: title,
      artist: artist,
      thumbnail: thumbnail
    }));
  } catch (e) {
    console.error("Failed to save song state:", e);
  }

  const requestId = ++playbackRequestId;
  currentVideoId = videoId;
  const highResThumb = getHighResThumbnail(thumbnail, videoId);
  preloadThumbnail(highResThumb, videoId);
  if (currentSongTitle) currentSongTitle.textContent = title;
  if (currentSongArtist) currentSongArtist.textContent = artist;
  if (currentSongImg) currentSongImg.src = highResThumb;

  song.src = "";
  song.load();
  setPlayIcon(false);

  if (ytPlayer && ytPlayerReady && typeof ytPlayer.stopVideo === 'function') {
    ytPlayer.stopVideo();
  }

  requestStream(videoId)
    .then(data => {
      if (requestId !== playbackRequestId) return;
      playerController.isYt = false;
      song.src = data.url;
      song.load();
      song.play().then(() => {
        if (requestId === playbackRequestId) {
          setPlayIcon(true);
          prefetchNextStream();
        }
      }).catch(e => {
        if (requestId === playbackRequestId) {
          console.warn("Native play failed, falling back to YouTube Player:", e);
          fallbackToYouTubePlayer(videoId, requestId);
        }
      });
    })
    .catch(e => {
      if (requestId === playbackRequestId) {
        console.warn("Stream fetch failed, falling back to YouTube Player:", e);
        fallbackToYouTubePlayer(videoId, requestId);
      }
    });

  // Save to play history in DB if logged in
  if (document.body.dataset.userLoggedIn === "true") {
    fetch("/api/library/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, title, artist, image: thumbnail })
    }).catch(err => console.error("Failed to add to history:", err));
  }

  if (customQueue) {
    queue = customQueue;
    queueIndex = queue.findIndex(s => s.videoId === videoId);
    if (queueIndex >= 0) prefetchNextStream();

    // Background artist catalog enrichment for artist contexts
    const cleanArtist = artist.split(/[,&]/)[0].trim();
    if (cleanArtist && (window.location.pathname.includes("/artist/") || customQueue.length > 1)) {
      fetch(`/api/search?q=${encodeURIComponent(cleanArtist + " songs")}`)
        .then(r => r.json())
        .then(searchData => {
          if (searchData.results && searchData.results.length > 0) {
            const extra = searchData.results
              .filter(r => r.type === 'song' && r.artist && (
                r.artist.toLowerCase().includes(cleanArtist.toLowerCase()) ||
                cleanArtist.toLowerCase().includes(r.artist.toLowerCase())
              ))
              .map(s => ({
                videoId: s.videoId,
                title: s.title,
                artist: s.artist,
                thumbnail: s.thumbnail
              }));

            extra.forEach(track => {
              if (!queue.some(q => q.videoId === track.videoId)) {
                queue.push(track);
              }
            });
            updateQueueList();
            prefetchNextStream();
          }
        })
        .catch(err => console.warn("Failed to enrich artist queue:", err));
    }
  } else {
    const idx = queue.findIndex(s => s.videoId === videoId);
    if (idx !== -1) {
      queueIndex = idx;
      if (queueIndex >= 0) prefetchNextStream();
    } else {
      // Seed with initial song, then fetch smart recommendations play queue dynamically
      queue = [{ videoId, title, artist, thumbnail }];
      queueIndex = 0;

      const isPodcast = window.location.pathname.includes("/podcast/") || 
                        (`${title} ${artist}`).toLowerCase().includes("podcast") || 
                        (`${title} ${artist}`).toLowerCase().includes("episode");

      fetch(`/api/recommend/play-queue?videoId=${videoId}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&thumbnail=${encodeURIComponent(thumbnail)}&isPodcast=${isPodcast}`)
        .then(r => r.json())
        .then(data => {
          if (data.queue && data.queue.length > 0) {
            queue = data.queue;
            queueIndex = 0;
            updateQueueList();
            prefetchNextStream();
          }
        })
        .catch(err => {
          console.warn("Failed to fetch smart play queue, falling back to page extraction:", err);
          queue = extractSongsFromPage();
          queueIndex = queue.findIndex(s => s.videoId === videoId);
          if (queueIndex >= 0) prefetchNextStream();
        });
    }
  }

  // Update heart button icon style
  const btnLike = document.getElementById("btnLike");
  if (btnLike) {
    const icon = btnLike.querySelector("i");
    fetch(`/api/library/status/${videoId}`)
      .then(r => r.json())
      .then(data => {
        if (data.liked) {
          icon.className = "fa-solid fa-check";
          btnLike.classList.add("active");
          btnLike.style.color = "#1ed760";
        } else {
          icon.className = "fa-solid fa-plus";
          btnLike.classList.remove("active");
          btnLike.style.color = "";
        }
      })
      .catch(err => console.error(err));
  }

  // Update Now Playing panel
  updateNowPlayingPanel(title, artist, highResThumb);

  // Update fullscreen info
  updateFullscreenInfo(title, artist, highResThumb);
}
window.playSong = playSong;

/* ===== NAV (NEXT / PREV) ===== */
function playNext() {
  if (queue.length === 0) return;
  const nextIdx = queueIndex + 1;
  if (nextIdx >= queue.length) {
    autoLoadRelatedArtistsSongs();
    return;
  }
  const next = queue[nextIdx];
  playSong(next.videoId, next.title, next.artist, next.thumbnail);
}

function autoLoadRelatedArtistsSongs() {
  if (queue.length === 0) return;
  const lastSong = queue[queue.length - 1];
  const artistName = lastSong.artist || "Unknown";

  console.log(`Queue ended. Autoloading songs related to artist: ${artistName}`);

  // 1. Try to read similar artists from the current page DOM first (if on the artist page)
  const fanCards = document.querySelectorAll(".artist-carousel-section .artist-card");
  if (fanCards.length > 0) {
    const randomCard = fanCards[Math.floor(Math.random() * fanCards.length)];
    const browseId = randomCard.dataset.browseId;
    if (browseId) {
      fetchRelatedArtistSongs(browseId, randomCard.dataset.title);
      return;
    }
  }

  // 2. Search for the artist to resolve their browseId
  fetch(`/api/search?q=${encodeURIComponent(artistName)}`)
    .then(r => r.json())
    .then(data => {
      const matchedArtist = data.results?.find(r => r.type === 'artist');
      if (matchedArtist && matchedArtist.browseId) {
        fetch(`/api/artist/${matchedArtist.browseId}`)
          .then(r => r.json())
          .then(artistData => {
            const fans = artistData.fansAlsoLike || [];
            if (fans.length > 0) {
              const randomFan = fans[Math.floor(Math.random() * fans.length)];
              if (randomFan.browseId) {
                fetchRelatedArtistSongs(randomFan.browseId, randomFan.title);
              }
            } else {
              appendRelatedHits();
            }
          })
          .catch(() => appendRelatedHits());
      } else {
        appendRelatedHits();
      }
    })
    .catch(() => appendRelatedHits());
}

function fetchRelatedArtistSongs(browseId, name) {
  console.log(`Fetching popular songs for related artist: ${name}`);
  fetch(`/api/artist/${browseId}`)
    .then(r => r.json())
    .then(data => {
      if (data.popularSongs && data.popularSongs.length > 0) {
        const newTracks = data.popularSongs.map(s => ({
          videoId: s.videoId,
          title: s.title,
          artist: s.artists || data.name || name || "Unknown",
          thumbnail: s.thumbnail
        }));
        
        const insertIndex = queue.length;
        queue.push(...newTracks);
        
        updateQueueList();
        
        const next = queue[insertIndex];
        playSong(next.videoId, next.title, next.artist, next.thumbnail);
      } else {
        appendRelatedHits();
      }
    })
    .catch(() => appendRelatedHits());
}

function appendRelatedHits() {
  console.log("No related artists found or request failed. Appending trending hits instead.");
  fetch(`/api/browse?refresh=${Date.now()}`)
    .then(r => r.json())
    .then(data => {
      const shelf = data.sections?.find(s => s.title.includes("Hits") || s.title.includes("Trending"));
      if (shelf && shelf.items && shelf.items.length > 0) {
        const songs = shelf.items.filter(item => item.type === 'song').map(s => ({
          videoId: s.videoId,
          title: s.title,
          artist: s.subtitle || "Unknown",
          thumbnail: s.thumbnail
        }));
        if (songs.length > 0) {
          const insertIndex = queue.length;
          queue.push(...songs);
          updateQueueList();
          const next = queue[insertIndex];
          playSong(next.videoId, next.title, next.artist, next.thumbnail);
        }
      }
    })
    .catch(err => console.error("Autoplay fallback failed:", err));
}

function playPrev() {
  if (queue.length === 0) return;
  const prevIdx = queueIndex - 1;
  if (prevIdx < 0) return;
  const prev = queue[prevIdx];
  playSong(prev.videoId, prev.title, prev.artist, prev.thumbnail);
}

/* ===== NOW PLAYING PANEL ===== */
function updateNowPlayingPanel(title, artist, thumbnail) {
  const npTitle = document.getElementById("npSongTitle");
  const npArtists = document.getElementById("npSongArtists");
  const npArtistImg = document.getElementById("npArtistImg");
  const npArtistName = document.getElementById("npArtistName");

  if (npTitle) npTitle.textContent = title;
  if (npArtists) npArtists.textContent = artist;
  if (npArtistImg) npArtistImg.src = thumbnail || '';
  if (npArtistName) npArtistName.textContent = artist;

  // Update queue list and panel
  updateQueueList();
  updateQueuePanel(title, artist, thumbnail);

  // Update credits (basic)
  updateCredits(title, artist);

  // Sync follow buttons
  if (typeof syncAllFollowButtons === 'function') {
    syncAllFollowButtons();
  }
}

function updateSidebarPlaylist(savedSongs) {
  const sidebar = document.getElementById("sidebarPlaylist");
  if (!sidebar) return;
  if (!savedSongs || savedSongs.length === 0) {
    sidebar.innerHTML = "";
    return;
  }
  sidebar.innerHTML = savedSongs.map(listing => `
    <div class="sidebar-playlist-item" data-video-id="${escapeQuotes(listing.videoId)}" data-title="${escapeQuotes(listing.title)}" data-artist="${escapeQuotes(listing.artist)}" data-image="${escapeQuotes(listing.image || '')}">
      <img src="${getHighResThumbnail(listing.image, listing.videoId)}" data-video-id="${escapeQuotes(listing.videoId)}" alt="" onerror="recoverThumbnail(this)">
      <div class="sidebar-item-info">
        <div class="sidebar-item-title">${listing.title}</div>
        <div class="sidebar-item-subtitle">${listing.artist}</div>
      </div>
    </div>
  `).join("");
}

function toggleNowPlaying() {
  if (!nowPlayingPanel) return;

  if (isQueueOpen) {
    isQueueOpen = false;
    if (queuePanel) queuePanel.classList.remove("visible");
    const qbtn = document.getElementById("btnQueueToggle");
    if (qbtn) qbtn.classList.remove("active");
  }

  isNowPlayingOpen = !isNowPlayingOpen;
  nowPlayingPanel.classList.toggle("visible", isNowPlayingOpen);

  const btn = document.getElementById("btnNowPlaying");
  if (btn) btn.classList.toggle("active", isNowPlayingOpen);
}

function toggleQueuePanel() {
  if (!queuePanel) return;

  if (isNowPlayingOpen) {
    isNowPlayingOpen = false;
    if (nowPlayingPanel) nowPlayingPanel.classList.remove("visible");
    const npbtn = document.getElementById("btnNowPlaying");
    if (npbtn) npbtn.classList.remove("active");
  }

  isQueueOpen = !isQueueOpen;
  queuePanel.classList.toggle("visible", isQueueOpen);

  const btn = document.getElementById("btnQueueToggle");
  if (btn) btn.classList.toggle("active", isQueueOpen);
}

function updateQueuePanel(title, artist, thumbnail) {
  const qNowPlayingItem = document.getElementById("qNowPlayingItem");
  const qNextFromHeader = document.getElementById("qNextFromHeader");
  const qList = document.getElementById("qList");

  if (qNowPlayingItem) {
    qNowPlayingItem.style.display = "";
    qNowPlayingItem.innerHTML = `
      <div class="q-track-row">
        <img src="${getHighResThumbnail(thumbnail, currentVideoId)}" data-video-id="${escapeQuotes(currentVideoId)}" alt="" onerror="recoverThumbnail(this)">
        <div class="q-track-info">
          <div class="q-track-title playing">${title}</div>
          <div class="q-track-artist">${artist}</div>
        </div>
      </div>
    `;
  }

  if (qNextFromHeader) {
    const primaryArtist = (artist || "Artist").split(/[,&]/)[0].trim();
    qNextFromHeader.textContent = `Next from: ${primaryArtist}`;
  }

  if (qList) {
    const upNext = queue.slice(queueIndex + 1);
    if (upNext.length === 0) {
      qList.innerHTML = '<div style="color:#a7a7a7;font-size:13px;padding:8px;">No upcoming songs</div>';
    } else {
      qList.innerHTML = upNext.map(s => `
        <div class="q-track-row" onclick="playSong('${escapeQuotes(s.videoId)}', '${escapeQuotes(s.title)}', '${escapeQuotes(s.artist)}', '${escapeQuotes(s.thumbnail)}')">
          <img src="${getHighResThumbnail(s.thumbnail, s.videoId)}" data-video-id="${escapeQuotes(s.videoId)}" alt="" onerror="recoverThumbnail(this)">
          <div class="q-track-info">
            <div class="q-track-title">${s.title}</div>
            <div class="q-track-artist">${s.artist}</div>
          </div>
        </div>
      `).join("");
    }
  }
}

function openAlbumTracks(albumTitle, tracks, thumbnail) {
  if (!Array.isArray(tracks) || tracks.length === 0) return;

  // Keep the album in the shared queue, but do not start a song just by
  // opening the album. Every row remains selectable from the queue panel.
  queue = tracks.filter(track => track && track.videoId);
  queueIndex = -1;
  updateQueuePanel(albumTitle || "Album", "Album", thumbnail || "");

  const nowPlayingItem = document.getElementById("qNowPlayingItem");
  const nextFromHeader = document.getElementById("qNextFromHeader");
  if (nowPlayingItem) nowPlayingItem.style.display = "none";
  if (nextFromHeader) nextFromHeader.textContent = "Album tracks";
  updateQueueList();

  if (!isQueueOpen) toggleQueuePanel();
}

function updateQueueList() {
  const queueList = document.getElementById("npQueueList");
  const fsQueueList = document.getElementById("fsQueueList");
  if (!queueList && !fsQueueList) return;

  const upNext = queue.slice(queueIndex + 1);
  const html = upNext.map(s => `
    <div class="np-queue-item" onclick="playSong('${escapeQuotes(s.videoId)}', '${escapeQuotes(s.title)}', '${escapeQuotes(s.artist)}', '${escapeQuotes(s.thumbnail)}')">
      <img src="${getHighResThumbnail(s.thumbnail, s.videoId)}" data-video-id="${escapeQuotes(s.videoId)}" alt="" onerror="recoverThumbnail(this)">
      <div class="np-queue-item-info">
        <div class="np-queue-item-title">${s.title}</div>
        <div class="np-queue-item-artist">${s.artist}</div>
      </div>
    </div>
  `).join("");

  if (queueList) queueList.innerHTML = html || '<div style="color:#a7a7a7;font-size:13px;padding:8px;">No upcoming songs</div>';
  if (fsQueueList) fsQueueList.innerHTML = html || '<div style="color:#a7a7a7;font-size:13px;padding:8px;">No upcoming songs</div>';
}

function updateCredits(title, artist) {
  const creditsList = document.getElementById("npCreditsList");
  const fsCreditsList = document.getElementById("fsCreditsList");
  if (!creditsList && !fsCreditsList) return;

  const artists = (artist || "").split(/[,&]/).map(a => a.trim()).filter(Boolean);
  const roles = ["Main Artist", "Main Artist · Composer", "Main Artist · Music Director"];

  const html = artists.map((a, i) => `
    <div class="np-credit-item">
      <div class="np-credit-info">
        <div class="np-credit-name">${a}</div>
        <div class="np-credit-role">${roles[i % roles.length]}</div>
      </div>
      <button class="np-credit-follow">Follow</button>
    </div>
  `).join("");

  if (creditsList) creditsList.innerHTML = html;
  if (fsCreditsList) fsCreditsList.innerHTML = html;
}

/* ===== FULLSCREEN ===== */
function toggleFullscreen() {
  if (!fullscreenOverlay) return;
  const isVisible = fullscreenOverlay.classList.contains("visible");

  if (isVisible) {
    fullscreenOverlay.classList.remove("visible");
  } else {
    fullscreenOverlay.classList.add("visible");
    // Extract color from album art for background
    extractColorFromImage(currentSongImg?.src);
  }
}

function updateFullscreenInfo(title, artist, thumbnail) {
  const fsTitle = document.getElementById("fsSongTitle");
  const fsArtist = document.getElementById("fsSongArtist");
  const fsArt = document.getElementById("fsAlbumArt");
  const fsArtistName = document.getElementById("fsArtistName");

  if (fsTitle) fsTitle.textContent = title;
  if (fsArtist) fsArtist.textContent = artist;
  if (fsArt) fsArt.src = thumbnail || '';
  if (fsArtistName) fsArtistName.textContent = artist;
}

function extractColorFromImage(src) {
  if (!src || !fullscreenOverlay) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = function () {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = 1;
      canvas.height = 1;
      ctx.drawImage(img, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      // Darken the color for background
      const dr = Math.floor(r * 0.4);
      const dg = Math.floor(g * 0.4);
      const db = Math.floor(b * 0.4);
      fullscreenOverlay.style.background = `rgb(${dr}, ${dg}, ${db})`;
    } catch (e) {
      fullscreenOverlay.style.background = "#3d3527";
    }
  };
  img.onerror = () => { fullscreenOverlay.style.background = "#3d3527"; };
  img.src = src;
}

/* ===== SEARCH ===== */
let searchTimeout = null;
if (searchInput) {
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimeout);
    const query = this.value.trim();
    if (query.length < 2) {
      searchResults.innerHTML = "";
      searchResults.style.display = "none";
      return;
    }
    searchTimeout = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then(r => r.json())
        .then(data => {
          if (data.results && data.results.length > 0) {
            searchResults.innerHTML = data.results.map(r => {
              if (r.type === 'artist') {
                return `<div class="search-result-item" onclick="navigateTo('/spotify/artist/${escapeQuotes(r.browseId)}')">
                  <img src="${getHighResThumbnail(r.thumbnail)}" alt="" style="border-radius: 50%" onerror="recoverThumbnail(this)">
                  <div class="search-result-info">
                    <div class="search-result-title">${r.title}</div>
                    <div class="search-result-artist">Artist</div>
                  </div>
                </div>`;
              } else {
                return `<div class="search-result-item" onclick="playSong('${escapeQuotes(r.videoId)}', '${escapeQuotes(r.title)}', '${escapeQuotes(r.artist || '')}', '${escapeQuotes(r.thumbnail || '')}')">
                  <img src="${getHighResThumbnail(r.thumbnail, r.videoId)}" data-video-id="${escapeQuotes(r.videoId)}" alt="" onerror="recoverThumbnail(this)">
                  <div class="search-result-info">
                    <div class="search-result-title">${r.title}</div>
                    <div class="search-result-artist">${r.artist || ''}</div>
                  </div>
                </div>`;
              }
            }).join("");
            searchResults.style.display = "block";
          } else {
            searchResults.innerHTML = "<div class='search-result-item' style='padding:12px;color:#a7a7a7;cursor:default;'>No results found</div>";
            searchResults.style.display = "block";
          }
        })
        .catch(e => console.error("Search error:", e));
    }, 400);
  });

  searchInput.addEventListener("blur", function () {
    setTimeout(() => { searchResults.style.display = "none"; }, 200);
  });

  searchInput.addEventListener("focus", function () {
    if (this.value.trim().length >= 2) {
      searchResults.style.display = "block";
    }
  });
}

/* ===== GREETING ===== */
function setGreeting() {
  const el = document.getElementById("greeting");
  if (!el) return;
  const h = new Date().getHours();
  if (h < 12) el.textContent = "Good morning";
  else if (h < 18) el.textContent = "Good afternoon";
  else el.textContent = "Good evening";
}

/* ===== TRENDING SECTIONS RENDERING ===== */
function renderTrendingSections(sections) {
  const container = document.getElementById("trendingContainer");
  if (!container) return;

  container.innerHTML = sections.map(section => {
    const items = section.items || [];

    // Determine if this is an "artists" section
    const isArtistSection = items.some(item => item.type === 'artist');
    const isAlbumSection = items.some(item => item.type === 'album');

    const cardsHtml = items.map(item => {
      if (item.type === 'artist') {
        return `
          <div class="artist-card" data-browse-id="${item.browseId || ''}" data-title="${escapeQuotes(item.title)}" data-subtitle="${escapeQuotes(item.subtitle || 'Artist')}">
            <div class="card-img-wrap">
              <img src="${getHighResThumbnail(item.thumbnail, item.videoId)}" data-video-id="${escapeQuotes(item.videoId)}" alt="${escapeQuotes(item.title)}" onerror="recoverThumbnail(this)">
            </div>
            <button class="play-btn-overlay"><i class="fa-solid fa-play"></i></button>
            <div class="card-title">${item.title}</div>
            <div class="card-subtitle">Artist</div>
          </div>`;
      } else {
        const cardClass = item.type === 'album' ? 'album-card' : 'song-card';
        return `
          <div class="${cardClass} trending-card-song" data-video-id="${item.videoId || ''}" data-browse-id="${item.browseId || ''}" data-title="${escapeQuotes(item.title)}" data-subtitle="${escapeQuotes(item.subtitle || '')}">
            <div class="card-img-wrap">
              <img src="${getHighResThumbnail(item.thumbnail, item.videoId)}" data-video-id="${escapeQuotes(item.videoId)}" alt="${escapeQuotes(item.title)}" onerror="recoverThumbnail(this)">
              <button class="play-btn-overlay"><i class="fa-solid fa-play"></i></button>
            </div>
            <div class="card-title">${item.title}</div>
            <div class="card-subtitle-multi">${item.subtitle || ''}</div>
          </div>`;
      }
    }).join("");

    return `
      <div class="content-section">
        <div class="content-section-header">
          <h2>${section.title}</h2>
          <a href="#" class="show-all">Show all</a>
        </div>
        <div class="card-row">
          ${cardsHtml}
        </div>
      </div>`;
  }).join("");
}

document.addEventListener("DOMContentLoaded", function () {
  setGreeting();

  // Restore last played song from localStorage
  try {
    const lastPlayed = localStorage.getItem("lastPlayedSong");
    if (lastPlayed) {
      const songData = JSON.parse(lastPlayed);
      if (songData && songData.videoId) {
        currentVideoId = songData.videoId;
        if (currentSongTitle) currentSongTitle.textContent = songData.title;
        if (currentSongArtist) currentSongArtist.textContent = songData.artist;
        if (currentSongImg) {
          const highResThumb = getHighResThumbnail(songData.thumbnail, songData.videoId);
          currentSongImg.src = highResThumb;
        }
      }
    }
  } catch (e) {
    console.error("Failed to restore last played song:", e);
  }

  // Initialize volume bar
  updateVolumeBar();

  // Fetch trending/browse data
  fetch("/api/browse")
    .then(r => r.json())
    .then(data => {
      if (data.sections && data.sections.length > 0) {
        renderTrendingSections(data.sections);
      }
    })
    .catch(e => console.error("Browse error:", e));

  // Sidebar playlist click
  const sidebarPlaylist = document.getElementById("sidebarPlaylist");
  if (sidebarPlaylist) {
    sidebarPlaylist.addEventListener("click", function (e) {
      const item = e.target.closest("[data-video-id]");
      if (!item) return;
      const videoId = item.dataset.videoId;
      if (videoId) {
        playSong(videoId, item.dataset.title || "Unknown Song", item.dataset.artist || "Unknown Artist", item.dataset.image || '');
      }
    });
  }

  // Song grid click
  if (songPanel) {
    songPanel.addEventListener("click", function (e) {
      const card = e.target.closest(".song-card");
      if (!card) return;
      const videoId = card.dataset.videoId;
      if (videoId) {
        const title = card.dataset.title || "Unknown Song";
        const artist = card.dataset.artist || "Unknown Artist";
        const imgSrc = card.querySelector("img")?.src || '';
        playSong(videoId, title, artist, imgSrc);
      }
    });
  }

  // Player control buttons
  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");
  const btnShuffle = document.getElementById("btnShuffle");
  const btnRepeat = document.getElementById("btnRepeat");

  if (btnPrev) btnPrev.addEventListener("click", playPrev);
  if (btnNext) btnNext.addEventListener("click", playNext);
  if (btnShuffle) {
    btnShuffle.addEventListener("click", function () {
      this.classList.toggle("active");
    });
  }
  if (btnRepeat) {
    btnRepeat.addEventListener("click", function () {
      if (this.dataset.mode === "one") {
        delete this.dataset.mode;
        this.classList.remove("active");
      } else if (this.dataset.mode === "all") {
        this.dataset.mode = "one";
        this.classList.add("active");
      } else {
        this.dataset.mode = "all";
        this.classList.add("active");
      }
    });
  }

  // Now Playing panel toggle
  const btnNowPlaying = document.getElementById("btnNowPlaying");
  if (btnNowPlaying) {
    btnNowPlaying.addEventListener("click", toggleNowPlaying);
  }

  // Queue toggle
  const btnQueueToggle = document.getElementById("btnQueueToggle");
  if (btnQueueToggle) {
    btnQueueToggle.addEventListener("click", toggleQueuePanel);
  }

  // Now Playing close button
  const npCloseBtn = document.getElementById("npCloseBtn");
  if (npCloseBtn) {
    npCloseBtn.addEventListener("click", function () {
      if (isNowPlayingOpen) toggleNowPlaying();
    });
  }

  // Queue close button
  const qCloseBtn = document.getElementById("qCloseBtn");
  if (qCloseBtn) {
    qCloseBtn.addEventListener("click", function () {
      if (isQueueOpen) toggleQueuePanel();
    });
  }

  // Fullscreen toggle
  const btnFullscreen = document.getElementById("btnFullscreen");
  if (btnFullscreen) {
    btnFullscreen.addEventListener("click", toggleFullscreen);
  }
  const fsExitBtn = document.getElementById("fsExitBtn");
  if (fsExitBtn) {
    fsExitBtn.addEventListener("click", toggleFullscreen);
  }
  const fsCloseBtn = document.getElementById("fsCloseBtn");
  if (fsCloseBtn) {
    fsCloseBtn.addEventListener("click", toggleFullscreen);
  }

  // Click album art in player bar → open fullscreen
  if (currentSongImg) {
    currentSongImg.addEventListener("click", function () {
      if (currentVideoId) {
        if (!fullscreenOverlay?.classList.contains("visible")) {
          toggleFullscreen();
        }
      }
    });
  }

  // Volume mute toggle
  const btnVolume = document.getElementById("btnVolume");
  let savedVolume = 0.5;
  if (btnVolume && volumeSlider) {
    btnVolume.addEventListener("click", function () {
      if (parseFloat(volumeSlider.value) > 0) {
        savedVolume = volumeSlider.value;
        volumeSlider.value = 0;
        song.volume = 0;
      } else {
        volumeSlider.value = savedVolume;
        song.volume = savedVolume;
      }
      updateVolumeBar();
      updateVolumeIcon();
    });
  }

  // Heart / Like button click handler
  const btnLike = document.getElementById("btnLike");
  if (btnLike) {
    btnLike.addEventListener("click", function () {
      if (!currentVideoId) return;
      const isLiked = btnLike.classList.contains("active");
      const url = isLiked ? "/api/library/unsave" : "/api/library/save";
      const icon = btnLike.querySelector("i");
      
      const title = currentSongTitle?.textContent || "Unknown";
      const artist = currentSongArtist?.textContent || "Unknown";
      const image = currentSongImg?.src || '';

      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: currentVideoId, title, artist, image })
      })
      .then(r => {
        if (r.status === 401) {
          // If unauthorized, redirect to Spotify login page
          window.location.href = "/spotify/login";
          throw new Error("Unauthorized");
        }
        return r.json();
      })
      .then(data => {
        if (data.success) {
          if (isLiked) {
            btnLike.classList.remove("active");
            icon.className = "fa-solid fa-plus";
            btnLike.style.color = "";
          } else {
            btnLike.classList.add("active");
            icon.className = "fa-solid fa-check";
            btnLike.style.color = "#1ed760";
          }
          
          // Re-render Liked Songs in sidebar library
          if (data.savedSongs) {
            updateSidebarPlaylist(data.savedSongs);
          }
        }
      })
      .catch(err => {
        if (err.message !== "Unauthorized") {
          console.error("Like handler error:", err);
        }
      });
    });
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.code === "Space") {
      e.preventDefault();
      playpause();
    }
    if (e.code === "Escape" && fullscreenOverlay?.classList.contains("visible")) {
      toggleFullscreen();
    }
  });

  // Search form submit
  window.handleSearch = function (event) {
    event.preventDefault();
    const query = document.getElementById("searchInput")?.value?.trim();
    if (query) {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then(r => r.json())
        .then(data => {
          if (data.results && data.results.length > 0) {
            const r = data.results[0];
            if (r.type === 'artist') {
              navigateTo(`/spotify/artist/${r.browseId}`);
            } else {
              playSong(r.videoId, r.title, r.artist || '', r.thumbnail || '');
            }
          }
        });
    }
    return false;
  };

  // Auto-dismiss flash messages after 5 seconds
  document.querySelectorAll(".alert").forEach(alert => {
    setTimeout(() => {
      alert.style.opacity = '0';
      alert.style.transform = 'translateY(-10px)';
      alert.style.transition = 'all 0.3s ease';
      setTimeout(() => alert.remove(), 300);
    }, 5000);
  });

  // ===== ARTIST FOLLOW SYSTEM FUNCTIONALITY =====
  window.followedArtists = [];

  function syncAllFollowButtons() {
    const followed = window.followedArtists || [];
    
    // 1. Update all .artist-follow-btn (Artist Page header)
    const artistBtns = document.querySelectorAll(".artist-follow-btn");
    artistBtns.forEach(btn => {
      const name = (btn.dataset.name || "").trim().toLowerCase();
      const isFollowing = followed.some(a => a.name.toLowerCase() === name);
      btn.classList.toggle("active", isFollowing);
      btn.textContent = isFollowing ? "Following" : "Follow";
    });
    
    // 2. Update .np-follow-btn (Now Playing panel)
    const npBtns = document.querySelectorAll(".np-follow-btn");
    npBtns.forEach(btn => {
      const currentArtist = (document.getElementById("npArtistName")?.textContent || "").trim().toLowerCase();
      const mainArtist = currentArtist.split(/[,&]/)[0].trim();
      const isFollowing = followed.some(a => a.name.toLowerCase() === mainArtist);
      btn.classList.toggle("active", isFollowing);
      btn.textContent = isFollowing ? "Following" : "Follow";
    });
    
    // 3. Update all .np-credit-follow (Credits lists)
    const creditBtns = document.querySelectorAll(".np-credit-follow");
    creditBtns.forEach(btn => {
      const name = (btn.closest(".np-credit-item")?.querySelector(".np-credit-name")?.textContent || "").trim().toLowerCase();
      const isFollowing = followed.some(a => a.name.toLowerCase() === name);
      btn.classList.toggle("active", isFollowing);
      btn.textContent = isFollowing ? "Following" : "Follow";
    });
  }
  
  window.syncAllFollowButtons = syncAllFollowButtons;

  // Fetch initial followed artists list if logged in
  const isLoggedIn = document.body.dataset.userLoggedIn === "true";
  if (isLoggedIn) {
    fetch("/api/artist/followed")
      .then(r => r.json())
      .then(data => {
        window.followedArtists = data.followedArtists || [];
        syncAllFollowButtons();
      })
      .catch(e => console.error("Follow list fetch error:", e));
  }

  // Global Follow Click Handler
  document.addEventListener("click", function (e) {
    const followBtn = e.target.closest(".artist-follow-btn, .np-follow-btn, .np-credit-follow");
    if (followBtn) {
      e.stopPropagation();
      
      const loggedIn = document.body.dataset.userLoggedIn === "true";
      if (!loggedIn) {
        alert("Please log in to follow artists.");
        window.location.href = "/spotify/login";
        return;
      }
      
      let browseId = followBtn.dataset.browseId || "";
      let name = followBtn.dataset.name || "";
      let thumbnail = followBtn.dataset.thumbnail || "";
      
      if (!name) {
        if (followBtn.classList.contains("np-credit-follow")) {
          name = followBtn.closest(".np-credit-item")?.querySelector(".np-credit-name")?.textContent || "";
        } else if (followBtn.classList.contains("np-follow-btn")) {
          name = document.getElementById("npArtistName")?.textContent || "";
          thumbnail = document.getElementById("npArtistImg")?.src || "";
        }
      }
      
      name = name.trim();
      if (!name) return;
      
      const isCurrentlyFollowing = window.followedArtists && window.followedArtists.some(a => a.name.toLowerCase() === name.toLowerCase());
      const apiUrl = isCurrentlyFollowing ? "/api/artist/unfollow" : "/api/artist/follow";
      
      followBtn.disabled = true;
      
      fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browseId, name, thumbnail })
      })
        .then(r => r.json())
        .then(data => {
          followBtn.disabled = false;
          if (data.success) {
            window.followedArtists = data.followedArtists || [];
            syncAllFollowButtons();
            
            // If on home feed, refresh recommendations so new "More from" categories appear
            const path = window.location.pathname;
            if (path === "/spotify" || path === "/spotify/") {
              fetch("/api/browse")
                .then(r => r.json())
                .then(bData => {
                  if (bData.sections && bData.sections.length > 0) {
                    renderTrendingSections(bData.sections);
                  }
                })
                .catch(e => console.error("Browse refresh error:", e));
            }
          } else {
            alert(data.error || "Failed to update follow status.");
          }
        })
        .catch(err => {
          followBtn.disabled = false;
          console.error("Follow error:", err);
        });
    }
  });

  // ===== SHOW ALL / SHOW LESS GRID EXPANSION TOGGLE =====
  document.addEventListener("click", function (e) {
    const showAllBtn = e.target.closest(".show-all");
    if (showAllBtn) {
      const text = showAllBtn.textContent.trim().toLowerCase();
      if (text.includes("queue")) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof toggleQueuePanel === 'function') {
          toggleQueuePanel();
        }
        return;
      }

      if (showAllBtn.closest(".np-credits-section")) {
        e.preventDefault();
        e.stopPropagation();
        const creditsSection = showAllBtn.closest(".np-credits-section");
        const creditsList = creditsSection?.querySelector(".np-credits-list") || document.getElementById("npCreditsList");
        if (creditsList) {
          const isExpanded = creditsList.classList.toggle("expanded");
          showAllBtn.textContent = isExpanded ? "Show less" : "Show all";
        }
        return;
      }

      if (text.includes("all") || text.includes("less")) {
        e.preventDefault();
        e.stopPropagation();
        const parent = showAllBtn.closest(".content-section, .artist-carousel-section, .discography-section");
        const cardRow = parent?.querySelector(".card-row");
        if (cardRow) {
          const isExpanded = cardRow.classList.toggle("expanded");
          showAllBtn.textContent = isExpanded ? "Show less" : "Show all";
        }
      }
    }
  });

  // ===== ARTIST POPULAR TRACKS EXPANSION TOGGLE =====
  document.addEventListener("click", function (e) {
    const toggleBtn = e.target.closest("#btnTogglePopularTracks");
    if (toggleBtn) {
      e.preventDefault();
      e.stopPropagation();
      const container = toggleBtn.closest(".popular-tracks");
      if (container) {
        const hiddenTracks = container.querySelectorAll(".track-row");
        let isCurrentlyHidden = toggleBtn.textContent.trim().toLowerCase() === "show all";
        
        hiddenTracks.forEach((track, index) => {
          if (index >= 5) {
            track.classList.toggle("hidden-track", !isCurrentlyHidden);
          }
        });
        
        toggleBtn.textContent = isCurrentlyHidden ? "Show less" : "Show all";
      }
    }
  });

  // ===== LIBRARY ADD DROPDOWN TOGGLER =====
  window.toggleLibraryAddDropdown = function (e) {
    e.preventDefault();
    e.stopPropagation();
    const dd = document.getElementById("libraryAddDropdown");
    if (dd) {
      const isHidden = dd.style.display === "none";
      dd.style.display = isHidden ? "block" : "none";
    }
  };

  window.handleDropdownCreateBlend = function (e) {
    e.preventDefault();
    e.stopPropagation();
    const dd = document.getElementById("libraryAddDropdown");
    if (dd) dd.style.display = "none";
    alert("Blend Feature: Combine your tastes with friends! (Feature coming soon)");
  };

  window.handleDropdownCreateFolder = function (e) {
    e.preventDefault();
    e.stopPropagation();
    const dd = document.getElementById("libraryAddDropdown");
    if (dd) dd.style.display = "none";
    alert("Folder Feature: Organize your playlists into folders! (Feature coming soon)");
  };

  // Close dropdown on clicking outside
  document.addEventListener("click", function (e) {
    const dd = document.getElementById("libraryAddDropdown");
    if (dd && dd.style.display === "block" && !e.target.closest(".lib-actions")) {
      dd.style.display = "none";
    }
  });

  // ===== PLAYLIST CREATION PROMPT =====
  window.openPlaylistCreatePrompt = function () {
    const dd = document.getElementById("libraryAddDropdown");
    if (dd) dd.style.display = "none";

    if (document.body.dataset.userLoggedIn !== "true") {
      const confirmLogin = confirm("Creating playlists requires a user profile. Would you like to Sign Up or Log In now?");
      if (confirmLogin) {
        navigateTo("/spotify/signup");
      }
      return;
    }

    const playlistName = prompt("Enter a name for your new playlist:", "My Playlist");
    if (playlistName === null) return;
    const name = playlistName.trim() || "My Playlist";

    fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success && data.playlist) {
          // Add newly created playlist to sidebar library dynamically
          const sidebarList = document.getElementById("sidebarPlaylist");
          if (sidebarList) {
            // Find or create liked songs container if missing, else append
            const itemHtml = `
              <div class="sidebar-playlist-item playlist-item" data-playlist-id="${data.playlist.id}" onclick="navigateTo('/spotify/playlist/${data.playlist.id}')">
                <div class="playlist-badge-icon">
                  <i class="fa-solid fa-music"></i>
                </div>
                <div class="sidebar-item-info">
                  <div class="sidebar-item-title">${escapeHtml(data.playlist.name)}</div>
                  <div class="sidebar-item-subtitle">Playlist • 0 songs</div>
                </div>
              </div>`;
            
            // Insert after liked-songs-item if present, otherwise prepend
            const likedSongsItem = sidebarList.querySelector(".liked-songs-item");
            if (likedSongsItem) {
              likedSongsItem.insertAdjacentHTML("afterend", itemHtml);
            } else {
              sidebarList.insertAdjacentHTML("afterbegin", itemHtml);
            }
          }
          // Navigate to the new playlist page!
          navigateTo(`/spotify/playlist/${data.playlist.id}`);
        } else {
          alert(data.error || "Failed to create playlist.");
        }
      })
      .catch(err => console.error("Create playlist error:", err));
  };

  // Helper to escape HTML dynamically
  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // ===== PLAYLIST INLINE SEARCH =====
  let playlistSearchTimeout = null;
  document.addEventListener("input", function (e) {
    const input = e.target.closest("#playlistSearchInput");
    if (input) {
      const query = input.value.trim();
      const resultsDiv = document.getElementById("playlistSearchResults");
      if (!resultsDiv) return;

      clearTimeout(playlistSearchTimeout);
      if (query.length < 2) {
        resultsDiv.innerHTML = "";
        resultsDiv.style.display = "none";
        return;
      }

      playlistSearchTimeout = setTimeout(() => {
        fetch(`/api/search?q=${encodeURIComponent(query)}`)
          .then(r => r.json())
          .then(data => {
            if (data.results && data.results.length > 0) {
              resultsDiv.innerHTML = data.results.map(r => `
                <div class="playlist-search-result-item">
                  <div class="playlist-result-info">
                    <img src="${r.thumbnail}" alt="" onerror="recoverThumbnail(this)">
                    <div class="playlist-result-text">
                      <span class="playlist-result-title">${escapeHtml(r.title)}</span>
                      <span class="playlist-result-artist">${escapeHtml(r.artist || '')}</span>
                    </div>
                  </div>
                  <button class="playlist-btn-add" 
                          data-video-id="${r.videoId}" 
                          data-title="${escapeQuotes(r.title)}" 
                          data-artist="${escapeQuotes(r.artist || '')}" 
                          data-thumbnail="${escapeQuotes(r.thumbnail)}">
                    Add
                  </button>
                </div>
              `).join("");
              resultsDiv.style.display = "flex";
            } else {
              resultsDiv.innerHTML = "<div style='padding:12px;color:#a7a7a7;'>No matching songs found.</div>";
              resultsDiv.style.display = "flex";
            }
          })
          .catch(err => console.error("Playlist search error:", err));
      }, 400);
    }
  });

  // ===== PLAYLIST EVENT DELEGATIONS =====
  document.addEventListener("click", function (e) {
    // 1. Play entire playlist
    const playPlaylistBtn = e.target.closest("#btnPlayPlaylist");
    if (playPlaylistBtn) {
      e.preventDefault();
      e.stopPropagation();
      const tracks = Array.from(document.querySelectorAll(".playlist-detail-page .track-row")).map(row => ({
        videoId: row.dataset.videoId,
        title: row.dataset.title,
        artist: row.dataset.artist,
        thumbnail: row.dataset.thumbnail
      }));
      if (tracks.length > 0) {
        playSong(tracks[0].videoId, tracks[0].title, tracks[0].artist, tracks[0].thumbnail, tracks);
        if (!isNowPlayingOpen) toggleNowPlaying();
      }
      return;
    }

    // 2. Delete Playlist
    const deletePlaylistBtn = e.target.closest("#btnDeletePlaylist");
    if (deletePlaylistBtn) {
      e.preventDefault();
      e.stopPropagation();
      const playlistId = deletePlaylistBtn.dataset.playlistId;
      if (confirm("Are you sure you want to delete this playlist? This action cannot be undone.")) {
        fetch(`/api/playlists/${playlistId}`, { method: "DELETE" })
          .then(r => r.json())
          .then(data => {
            if (data.success) {
              // Remove playlist from sidebar library list
              const sidebarItem = document.querySelector(`.sidebar-playlist-item[data-playlist-id="${playlistId}"]`);
              if (sidebarItem) sidebarItem.remove();
              // Navigate back to home view
              navigateTo("/spotify");
            }
          })
          .catch(err => console.error("Delete playlist error:", err));
      }
      return;
    }

    // 3. Add song to playlist
    const btnAdd = e.target.closest(".playlist-btn-add");
    if (btnAdd) {
      e.preventDefault();
      e.stopPropagation();
      const page = document.querySelector(".playlist-detail-page");
      if (!page) return;
      const playlistId = page.dataset.playlistId;
      const { videoId, title, artist, thumbnail } = btnAdd.dataset;

      btnAdd.disabled = true;

      fetch(`/api/playlists/${playlistId}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, title, artist, image: thumbnail })
      })
        .then(r => r.json())
        .then(data => {
          if (data.success && data.playlist) {
            // Reload/render the playlist page SPA-style to reflect the newly added song!
            navigateTo(`/spotify/playlist/${playlistId}`);
            
            // Sync sidebar song count
            const sidebarItem = document.querySelector(`.sidebar-playlist-item[data-playlist-id="${playlistId}"]`);
            if (sidebarItem) {
              const countEl = sidebarItem.querySelector(".sidebar-item-subtitle");
              if (countEl) {
                countEl.textContent = `Playlist • ${data.playlist.songs ? data.playlist.songs.length : 0} songs`;
              }
            }
          }
        })
        .catch(err => {
          btnAdd.disabled = false;
          console.error("Add song to playlist error:", err);
        });
      return;
    }

    // 4. Remove song from playlist
    const btnRemove = e.target.closest(".btn-remove-from-playlist");
    if (btnRemove) {
      e.preventDefault();
      e.stopPropagation();
      const page = document.querySelector(".playlist-detail-page");
      if (!page) return;
      const playlistId = page.dataset.playlistId;
      const videoId = btnRemove.dataset.videoId;

      btnRemove.disabled = true;

      fetch(`/api/playlists/${playlistId}/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId })
      })
        .then(r => r.json())
        .then(data => {
          if (data.success && data.playlist) {
            // Reload/render playlist page SPA-style
            navigateTo(`/spotify/playlist/${playlistId}`);

            // Sync sidebar song count
            const sidebarItem = document.querySelector(`.sidebar-playlist-item[data-playlist-id="${playlistId}"]`);
            if (sidebarItem) {
              const countEl = sidebarItem.querySelector(".sidebar-item-subtitle");
              if (countEl) {
                countEl.textContent = `Playlist • ${data.playlist.songs ? data.playlist.songs.length : 0} songs`;
              }
            }
          }
        })
        .catch(err => {
          btnRemove.disabled = false;
          console.error("Remove song error:", err);
        });
      return;
    }
  });
});
