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

let queue = [];
let queueIndex = -1;
let currentVideoId = null;

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getPlayIcon() {
  return ctrlIcn ? ctrlIcn.querySelector("i") : null;
}

function setPlayIcon(playing) {
  const icon = getPlayIcon();
  if (icon) icon.className = playing ? "fa-solid fa-pause" : "fa-solid fa-play";
}

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
    });
  }
}

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
    }
  });
}

function extractSongsFromPage() {
  const cards = document.querySelectorAll(".song-card");
  const songs = [];
  cards.forEach(card => {
    const vid = card.dataset.videoId;
    if (vid) {
      songs.push({
        videoId: vid,
        title: card.dataset.title || "Unknown",
        artist: card.dataset.artist || "Unknown",
        thumbnail: card.querySelector("img") ? card.querySelector("img").src : "/assets/card3img.jpeg"
      });
    }
  });
  return songs;
}

function playSong(videoId, title, artist, thumbnail) {
  currentVideoId = videoId;
  if (currentSongTitle) currentSongTitle.textContent = title;
  if (currentSongArtist) currentSongArtist.textContent = artist;
  if (currentSongImg) currentSongImg.src = thumbnail || "/assets/card3img.jpeg";

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
}
window.playSong = playSong;

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

// --- Search ---
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
            searchResults.innerHTML = data.results.map(r =>
              `<div class="search-result-item" onclick="playSong('${r.videoId}', '${r.title.replace(/'/g, "\\'")}', '${(r.artist || '').replace(/'/g, "\\'")}', '${r.thumbnail || ''}')">
                <img src="${r.thumbnail || '/assets/card3img.jpeg'}" alt="" onerror="this.src='/assets/card3img.jpeg'">
                <div class="search-result-info">
                  <div class="search-result-title">${r.title}</div>
                  <div class="search-result-artist">${r.artist || ''}</div>
                </div>
              </div>`
            ).join("");
            searchResults.style.display = "block";
          } else {
            searchResults.innerHTML = "<div class='search-result-item' style='padding:10px;color:#b3b3b3;'>No results found</div>";
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

function setGreeting() {
  const el = document.getElementById("greeting");
  if (!el) return;
  const h = new Date().getHours();
  if (h < 12) el.textContent = "Good morning";
  else if (h < 18) el.textContent = "Good afternoon";
  else el.textContent = "Good evening";
}

function renderTrendingSections(sections) {
  const container = document.getElementById("trendingContainer");
  if (!container) return;
  container.innerHTML = sections.map(section => `
    <div class="trending-section">
      <div class="trending-section-header">
        <h2>${section.title}</h2>
        <a href="#">Show all</a>
      </div>
      <div class="trending-carousel">
        ${section.items.map(item => `
          <div class="trending-card" data-video-id="${item.videoId || ''}" data-browse-id="${item.browseId || ''}" data-title="${(item.title || '').replace(/'/g, "\\'")}" data-subtitle="${(item.subtitle || '').replace(/'/g, "\\'")}">
            <img src="${item.thumbnail || '/assets/card3img.jpeg'}" alt="" onerror="this.src='/assets/card3img.jpeg'">
            <div class="trending-title">${item.title}</div>
            <div class="trending-subtitle">${item.subtitle}</div>
            <button class="play-btn-overlay"><i class="fa-solid fa-play"></i></button>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");

  container.addEventListener("click", function (e) {
    const card = e.target.closest(".trending-card");
    if (!card) return;
    const videoId = card.dataset.videoId;
    if (videoId) {
      const title = card.dataset.title || "Unknown";
      const subtitle = card.dataset.subtitle || "";
      const img = card.querySelector("img")?.src || "/assets/card3img.jpeg";
      playSong(videoId, title, subtitle, img);
    }
  });
}

// --- DOM ready ---
document.addEventListener("DOMContentLoaded", function () {
  setGreeting();

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
      this.style.color = this.classList.contains("active") ? "#1ed760" : "";
    });
  }
  if (btnRepeat) {
    btnRepeat.addEventListener("click", function () {
      if (this.dataset.mode === "one") {
        delete this.dataset.mode;
        this.style.color = "";
      } else if (this.dataset.mode === "all") {
        this.dataset.mode = "one";
        this.style.color = "#1ed760";
      } else {
        this.dataset.mode = "all";
        this.style.color = "#1ed760";
      }
    });
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") {
      e.preventDefault();
      playpause();
    }
  });

  window.handleSearch = function (event) {
    event.preventDefault();
    const query = document.getElementById("searchInput")?.value?.trim();
    if (query) {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then(r => r.json())
        .then(data => {
          if (data.results && data.results.length > 0) {
            const r = data.results[0];
            playSong(r.videoId, r.title, r.artist || '', r.thumbnail || '');
          }
        });
    }
    return false;
  };
});
