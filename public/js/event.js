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
const fullscreenOverlay = document.getElementById("fullscreenOverlay");

let queue = [];
let queueIndex = -1;
let currentVideoId = null;
let isNowPlayingOpen = false;

/* ===== UTILITY ===== */
function getHighResThumbnail(url) {
  if (!url) return "/assets/card3img.jpeg";
  let hr = url;
  hr = hr.replace(/-w\d+-h\d+/, '-w500-h500');
  hr = hr.replace(/=w\d+-h\d+/, '=w500-h500');
  hr = hr.replace(/=s\d+/, '=s500');
  if (hr.includes('i.ytimg.com') && hr.includes('default.jpg')) {
    hr = hr.replace('default.jpg', 'hqdefault.jpg');
  }
  return hr;
}

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
      song.volume = this.value;
      updateVolumeBar();
      updateVolumeIcon();
    });
  }
}

/* ===== PROGRESS & VOLUME BAR VISUAL ===== */
function updateProgressBar() {
  if (!progress || !song || !song.duration) return;
  const pct = (song.currentTime / song.duration) * 100;
  const wrap = progress.closest('.progress-bar-wrap') || progress.closest('.progress-row');
  if (wrap) wrap.style.setProperty('--progress-pct', pct + '%');
  progress.style.background = `linear-gradient(to right, #fff 0%, #fff ${pct}%, #4d4d4d ${pct}%)`;
}

function updateVolumeBar() {
  if (!volumeSlider) return;
  const pct = volumeSlider.value * 100;
  const wrap = volumeSlider.closest('.volume-bar-wrap');
  if (wrap) wrap.style.setProperty('--volume-pct', pct + '%');
  volumeSlider.style.background = `linear-gradient(to right, #fff 0%, #fff ${pct}%, #4d4d4d ${pct}%)`;
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

/* ===== PLAY / PAUSE ===== */
function playpause() {
  if (!song || !song.src) return;
  const icon = getPlayIcon();
  if (!icon) return;

  if (icon.classList.contains("fa-pause")) {
    song.pause();
    setPlayIcon(false);
  } else {
    song.play().catch(e => console.error("Playback failed:", e));
    setPlayIcon(true);
  }
}
window.playpause = playpause;

if (progress) {
  progress.addEventListener("input", function () {
    if (song && song.duration && isFinite(song.duration)) {
      song.currentTime = this.value;
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
          thumbnail: getHighResThumbnail(card.querySelector("img") ? card.querySelector("img").src : (card.dataset.image || "/assets/card3img.jpeg"))
        });
      }
    }
  });
  return songs;
}

/* ===== PLAY SONG ===== */
function playSong(videoId, title, artist, thumbnail) {
  currentVideoId = videoId;
  const highResThumb = getHighResThumbnail(thumbnail);
  if (currentSongTitle) currentSongTitle.textContent = title;
  if (currentSongArtist) currentSongArtist.textContent = artist;
  if (currentSongImg) currentSongImg.src = highResThumb;

  song.src = "";
  song.load();
  setPlayIcon(false);

  fetch(`/api/stream/${videoId}`)
    .then(r => r.json())
    .then(data => {
      if (data.error || !data.url) {
        console.error("Stream error:", data.error || "No URL");
        return;
      }
      song.src = data.url;
      song.load();
      song.play().then(() => {
        setPlayIcon(true);
      }).catch(e => console.error("Play error:", e));
    })
    .catch(e => console.error("Fetch stream error:", e));

  queue = extractSongsFromPage();
  queueIndex = queue.findIndex(s => s.videoId === videoId);

  // Update heart button icon style
  const btnLike = document.getElementById("btnLike");
  if (btnLike) {
    const icon = btnLike.querySelector("i");
    fetch(`/api/library/status/${videoId}`)
      .then(r => r.json())
      .then(data => {
        if (data.liked) {
          icon.className = "fa-solid fa-circle-check";
          btnLike.classList.add("active");
          btnLike.style.color = "#1ed760";
        } else {
          icon.className = "fa-regular fa-circle-plus";
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
  if (nextIdx >= queue.length) return;
  const next = queue[nextIdx];
  playSong(next.videoId, next.title, next.artist, next.thumbnail);
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
  if (npArtistImg) npArtistImg.src = thumbnail || "/assets/card3img.jpeg";
  if (npArtistName) npArtistName.textContent = artist;

  // Update queue list
  updateQueueList();

  // Update credits (basic)
  updateCredits(title, artist);
}

function updateSidebarPlaylist(savedSongs) {
  const sidebar = document.getElementById("sidebarPlaylist");
  if (!sidebar) return;
  if (!savedSongs || savedSongs.length === 0) {
    sidebar.innerHTML = "";
    return;
  }
  sidebar.innerHTML = savedSongs.map(listing => `
    <div class="sidebar-playlist-item" data-video-id="${escapeQuotes(listing.videoId)}" data-title="${escapeQuotes(listing.title)}" data-artist="${escapeQuotes(listing.artist)}" data-image="${escapeQuotes(listing.image || '/assets/card3img.jpeg')}">
      <img src="${listing.image || '/assets/card3img.jpeg'}" alt="" onerror="this.src='/assets/card3img.jpeg'">
      <div class="sidebar-item-info">
        <div class="sidebar-item-title">${listing.title}</div>
        <div class="sidebar-item-subtitle">${listing.artist}</div>
      </div>
    </div>
  `).join("");
}

function toggleNowPlaying() {
  if (!nowPlayingPanel) return;
  isNowPlayingOpen = !isNowPlayingOpen;
  nowPlayingPanel.classList.toggle("visible", isNowPlayingOpen);

  const btn = document.getElementById("btnNowPlaying");
  if (btn) btn.classList.toggle("active", isNowPlayingOpen);
}

function updateQueueList() {
  const queueList = document.getElementById("npQueueList");
  const fsQueueList = document.getElementById("fsQueueList");
  if (!queueList && !fsQueueList) return;

  const upNext = queue.slice(queueIndex + 1, queueIndex + 6);
  const html = upNext.map(s => `
    <div class="np-queue-item" onclick="playSong('${escapeQuotes(s.videoId)}', '${escapeQuotes(s.title)}', '${escapeQuotes(s.artist)}', '${escapeQuotes(s.thumbnail)}')">
      <img src="${s.thumbnail || '/assets/card3img.jpeg'}" alt="" onerror="this.src='/assets/card3img.jpeg'">
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
  if (fsArt) fsArt.src = thumbnail || "/assets/card3img.jpeg";
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
                return `<div class="search-result-item" onclick="window.location.href='/spotify/artist/${escapeQuotes(r.browseId)}'">
                  <img src="${r.thumbnail || '/assets/card3img.jpeg'}" alt="" style="border-radius: 50%" onerror="this.src='/assets/card3img.jpeg'">
                  <div class="search-result-info">
                    <div class="search-result-title">${r.title}</div>
                    <div class="search-result-artist">Artist</div>
                  </div>
                </div>`;
              } else {
                return `<div class="search-result-item" onclick="playSong('${escapeQuotes(r.videoId)}', '${escapeQuotes(r.title)}', '${escapeQuotes(r.artist || '')}', '${escapeQuotes(r.thumbnail || '')}')">
                  <img src="${r.thumbnail || '/assets/card3img.jpeg'}" alt="" onerror="this.src='/assets/card3img.jpeg'">
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
              <img src="${item.thumbnail || '/assets/card3img.jpeg'}" alt="${escapeQuotes(item.title)}" onerror="this.src='/assets/card3img.jpeg'">
              <button class="play-btn-overlay"><i class="fa-solid fa-play"></i></button>
            </div>
            <div class="card-title">${item.title}</div>
            <div class="card-subtitle">Artist</div>
          </div>`;
      } else {
        const cardClass = item.type === 'album' ? 'album-card' : 'song-card';
        return `
          <div class="${cardClass} trending-card-song" data-video-id="${item.videoId || ''}" data-browse-id="${item.browseId || ''}" data-title="${escapeQuotes(item.title)}" data-subtitle="${escapeQuotes(item.subtitle || '')}">
            <div class="card-img-wrap">
              <img src="${item.thumbnail || '/assets/card3img.jpeg'}" alt="${escapeQuotes(item.title)}" onerror="this.src='/assets/card3img.jpeg'">
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

  // Click handler for trending cards
  container.addEventListener("click", function (e) {
    const playBtn = e.target.closest(".play-btn-overlay");
    const card = e.target.closest(".song-card, .album-card, .artist-card, .trending-card-song");
    if (!card) return;

    // Artist card → navigate to artist page
    if (card.classList.contains("artist-card")) {
      const browseId = card.dataset.browseId;
      if (browseId) {
        window.location.href = `/spotify/artist/${browseId}`;
      }
      return;
    }

    // Song/Album card → play
    const videoId = card.dataset.videoId;
    if (videoId) {
      const title = card.dataset.title || "Unknown";
      const subtitle = card.dataset.subtitle || "";
      const img = card.querySelector("img")?.src || "/assets/card3img.jpeg";
      playSong(videoId, title, subtitle, img);
    }
  });
}

/* ===== DOM READY ===== */
document.addEventListener("DOMContentLoaded", function () {
  setGreeting();

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
        playSong(videoId, item.dataset.title || "Unknown Song", item.dataset.artist || "Unknown Artist", item.dataset.image || "/assets/card3img.jpeg");
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
        const imgSrc = card.querySelector("img") ? card.querySelector("img").src : "/assets/card3img.jpeg";
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

  // Queue toggle (also opens now playing panel)
  const btnQueueToggle = document.getElementById("btnQueueToggle");
  if (btnQueueToggle) {
    btnQueueToggle.addEventListener("click", function () {
      if (!isNowPlayingOpen) toggleNowPlaying();
    });
  }

  // Now Playing close button
  const npCloseBtn = document.getElementById("npCloseBtn");
  if (npCloseBtn) {
    npCloseBtn.addEventListener("click", function () {
      if (isNowPlayingOpen) toggleNowPlaying();
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
      const image = currentSongImg?.src || "/assets/card3img.jpeg";

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
            icon.className = "fa-regular fa-circle-plus";
            btnLike.style.color = "";
          } else {
            btnLike.classList.add("active");
            icon.className = "fa-solid fa-circle-check";
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
              window.location.href = `/spotify/artist/${r.browseId}`;
            } else {
              playSong(r.videoId, r.title, r.artist || '', r.thumbnail || '');
            }
          }
        });
    }
    return false;
  };

  // Global track-row click (for artist page popular tracks table)
  document.addEventListener("click", function (e) {
    const row = e.target.closest(".track-row");
    if (!row) return;
    const videoId = row.dataset.videoId;
    if (videoId) {
      playSong(videoId, row.dataset.title || "Unknown", row.dataset.artist || "Unknown", row.dataset.thumbnail || "/assets/card3img.jpeg");
    }
  });

  // Auto-dismiss flash messages after 5 seconds
  document.querySelectorAll(".alert").forEach(alert => {
    setTimeout(() => {
      alert.style.opacity = '0';
      alert.style.transform = 'translateY(-10px)';
      alert.style.transition = 'all 0.3s ease';
      setTimeout(() => alert.remove(), 300);
    }, 5000);
  });
});
