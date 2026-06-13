/**
 * Spotify Clone - Music Player Controls
 * Handles audio playback, progress, and UI interactions.
 */

// DOM Elements
const progress = document.getElementById("progress");
const song = document.getElementById("song");
const ctrlIcn = document.getElementById("ctrlIcn");
const volumeSlider = document.getElementById("volumeSlider");
const currentSongTitle = document.getElementById("currentSongTitle");
const currentSongArtist = document.getElementById("currentSongArtist");
const currentSongImg = document.getElementById("currentSongImg");

// ---------- Audio Metadata Loaded ----------
if (song) {
    song.onloadedmetadata = function () {
        if (song.duration && isFinite(song.duration)) {
            progress.max = song.duration;
            progress.value = song.currentTime;
        }
    };

    // Time update listener to move progress bar
    song.ontimeupdate = function () {
        if (song.duration && isFinite(song.duration)) {
            progress.value = song.currentTime;
        }
    };

    // When song ends, reset play button
    song.onended = function () {
        ctrlIcn.classList.remove("fa-circle-pause");
        ctrlIcn.classList.add("fa-circle-play");
    };

    // Volume control
    if (volumeSlider) {
        volumeSlider.addEventListener("input", function () {
            song.volume = this.value;
        });
    }
}

// ---------- Play / Pause Toggle ----------
function playpause() {
    if (!song || !song.src) {
        // No audio source loaded
        return;
    }

    if (ctrlIcn.classList.contains("fa-circle-pause")) {
        song.pause();
        ctrlIcn.classList.remove("fa-circle-pause");
        ctrlIcn.classList.add("fa-circle-play");
    } else {
        song.play().catch((err) => {
            console.error("Playback failed:", err);
        });
        ctrlIcn.classList.add("fa-circle-pause");
        ctrlIcn.classList.remove("fa-circle-play");
    }
}

// Make playpause globally accessible (called from inline onclick)
window.playpause = playpause;

// ---------- Progress Bar Seek ----------
if (progress) {
    progress.oninput = function () {
        if (song && song.duration && isFinite(song.duration)) {
            song.currentTime = this.value;
        }
    };
}

// ---------- Song Card Click Handler ----------
// Use event delegation for dynamically added cards
document.addEventListener("DOMContentLoaded", function () {
    const songPanel = document.getElementById("songPanel");

    if (songPanel) {
        songPanel.addEventListener("click", function (e) {
            // Find the closest card element
            const card = e.target.closest(".card");
            if (!card) return;

            const title = card.dataset.title || "Unknown Song";
            const artist = card.dataset.artist || "Unknown Artist";
            const imgSrc = card.querySelector("img") ? card.querySelector("img").src : "/assets/card3img.jpeg";

            // Update player UI
            if (currentSongTitle) currentSongTitle.textContent = title;
            if (currentSongArtist) currentSongArtist.textContent = artist;
            if (currentSongImg) currentSongImg.src = imgSrc;

            // Toggle play/pause when a card is clicked
            playpause();
        });
    }

    // ---------- Handle Search (placeholder) ----------
    window.handleSearch = function (event) {
        event.preventDefault();
        const query = document.getElementById("searchInput")?.value?.trim();
        if (query) {
            console.log("Searching for:", query);
            // Future: implement search functionality
            alert('Search feature coming soon! You searched for: "' + query + '"');
        }
        return false;
    };
});
