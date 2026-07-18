require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const flash = require("connect-flash");
const methodOverride = require("method-override");
const catchAsync = require("./utils/catchAsync");
const ExpressError = require("./utils/ExpressError");
const { searchSongs, getStreamUrl, getTrending } = require("./utils/youtube");

// Ensure the NeDB data directory exists (NeDB does not create it automatically)
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const app = express();

app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  res.on('finish', () => {
    console.log(`[RESPONSE] ${req.method} ${req.url} -> ${res.statusCode}`);
  });
  next();
});

app.use((req, res, next) => {
  if (req.headers['x-spa-navigation'] === 'true') {
    const originalRender = res.render;
    res.render = function (view, options = {}, fn) {
      options.layout = false;
      originalRender.call(this, view, options, fn);
    };
  }
  next();
});

const Listing = require("./models/schema");

// Database URL repair migration (runs once on startup)
const repairUrl = (url, videoId = null) => {
  if (!url) return url;
  if (videoId && (url.includes('yt3.googleusercontent.com') || url.includes('yt3.ggpht.com'))) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
    if (url.includes('500-h500') || url.includes('s500') || url.includes('w500')) {
      let rep = url;
      rep = rep.replace('=w500-h500', '=w120-h120');
      rep = rep.replace('-w500-h500', '-w120-h120');
      rep = rep.replace('=s500', '=s120');
      rep = rep.replace('-s500', '-s120');
      return rep;
    }
  }
  return url;
};

const runMigration = async () => {
  try {
    // Repair songs.db
    const listings = await Listing.find({});
    for (const listing of listings) {
      if (listing.image) {
        const repaired = repairUrl(listing.image, listing.videoId);
        if (repaired !== listing.image) {
          await Listing.db.update({ _id: listing._id }, { $set: { image: repaired } });
        }
      }
    }
    // Repair users.db
    const UserDb = require('./models/user').db;
    const users = await UserDb.find({});
    for (const user of users) {
      if (user.savedSongs && user.savedSongs.length > 0) {
        let changed = false;
        const newSongs = user.savedSongs.map(song => {
          const repaired = repairUrl(song.image, song.videoId);
          if (repaired !== song.image) {
            changed = true;
          }
          return { ...song, image: repaired };
        });
        if (changed) {
          await UserDb.update({ _id: user._id }, { $set: { savedSongs: newSongs } });
        }
      }
    }
    console.log("Database image URLs repaired successfully!");
  } catch (err) {
    console.error("Database migration error:", err.message);
  }
};
runMigration();

const SESSION_SECRET = process.env.SESSION_SECRET || "musickeysecret_dev_only";

const sessionOptions = {
  store: new FileStore({
    path: "./sessions",
    logFn: function() {} // Suppress console logs in development
  }),
  secret: SESSION_SECRET,
  resave: false,
  // Avoid creating a session and writing a cookie for anonymous API requests.
  saveUninitialized: false,
  cookie: {
    // maxAge alone controls expiry; `expires` must be a Date, not a number
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
  },
};

app.use(session(sessionOptions));
app.use(flash());
app.use(methodOverride("_method"));

const User = require("./models/user");

app.use(catchAsync(async (req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.user = req.session.user || null;
  // API calls do not render the saved-song sidebar. Skipping this database read
  // keeps search and stream-start requests off the page-rendering hot path.
  if (req.session.user && !req.path.startsWith("/api/")) {
    res.locals.savedSongs = await User.getSavedSongs(req.session.user._id);
    res.locals.followedArtists = await User.getFollowedArtists(req.session.user._id);
    res.locals.history = await User.getHistory(req.session.user._id);
    res.locals.playlists = await User.getPlaylists(req.session.user._id);
  } else {
    res.locals.savedSongs = [];
    res.locals.followedArtists = [];
    res.locals.history = [];
    res.locals.playlists = [];
  }
  next();
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.redirect("/spotify");
});

app.get(
  "/spotify",
  catchAsync(async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    const allListings = await Listing.find({});
    res.render("index.ejs", { allListings });
  })
);

app.get("/spotify/upload", (req, res) => {
  res.render("upload");
});

app.get("/spotify/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/spotify/signup", (req, res) => {
  res.render("signup.ejs");
});

app.post(
  "/spotify/signup",
  catchAsync(async (req, res) => {
    const { username, password } = req.body;
    try {
      await User.register(username, password);
      req.flash("success", "Registration successful! Please log in.");
      res.redirect("/spotify/login");
    } catch (e) {
      req.flash("error", e.message || "Registration failed.");
      res.redirect("/spotify/signup");
    }
  })
);

app.post(
  "/spotify/login",
  catchAsync(async (req, res) => {
    const { username, password } = req.body;
    const user = await User.authenticate(username, password);
    if (!user) {
      req.flash("error", "Invalid username or password.");
      return res.redirect("/spotify/login");
    }
    req.session.user = { _id: user._id, username: user.username };
    req.flash("success", `Welcome back, ${user.username}!`);
    res.redirect("/spotify");
  })
);

app.get("/spotify/logout", (req, res) => {
  req.session.user = null;
  req.flash("success", "Logged out successfully!");
  res.redirect("/spotify");
});

app.post(
  "/api/library/save",
  catchAsync(async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ error: "Please log in to save songs." });
    }
    const { videoId, title, artist, image } = req.body;
    if (!videoId || !title) {
      return res.status(400).json({ error: "Video ID and Title are required." });
    }
    const saved = await User.saveSong(req.session.user._id, { videoId, title, artist, image });
    res.json({ success: true, savedSongs: saved });
  })
);

app.post(
  "/api/library/unsave",
  catchAsync(async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ error: "Please log in." });
    }
    const { videoId } = req.body;
    if (!videoId) {
      return res.status(400).json({ error: "Video ID is required." });
    }
    const saved = await User.unsaveSong(req.session.user._id, videoId);
    res.json({ success: true, savedSongs: saved });
  })
);

app.get(
  "/api/library/status/:videoId",
  catchAsync(async (req, res) => {
    if (!req.session.user) {
      return res.json({ liked: false });
    }
    const { videoId } = req.params;
    const savedSongs = await User.getSavedSongs(req.session.user._id);
    const liked = savedSongs.some(s => s.videoId === videoId);
    res.json({ liked });
  })
);

// ===== ARTIST FOLLOW SYSTEM API =====
app.post(
  "/api/artist/follow",
  catchAsync(async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ error: "Please log in to follow artists." });
    }
    
    let { browseId, name, thumbnail } = req.body;
    
    // If name is provided but browseId is missing, resolve it using search
    if (name && !browseId) {
      const searchSongs = require("./utils/youtube").searchSongs;
      const searchResults = await searchSongs(name);
      const artistMatch = searchResults.find(r => r.type === 'artist' && r.title.toLowerCase() === name.toLowerCase()) || 
                          searchResults.find(r => r.type === 'artist') ||
                          searchResults.find(r => r.browseId && r.browseId.startsWith('UC'));
      
      if (artistMatch) {
        browseId = artistMatch.browseId;
        name = artistMatch.title;
        thumbnail = artistMatch.thumbnail;
      } else {
        return res.status(404).json({ error: `Could not resolve artist "${name}".` });
      }
    }
    
    if (!browseId || !name) {
      return res.status(400).json({ error: "Artist browseId and name are required." });
    }
    
    const followed = await User.followArtist(req.session.user._id, { browseId, name, thumbnail });
    res.json({ success: true, followedArtists: followed });
  })
);

app.post(
  "/api/artist/unfollow",
  catchAsync(async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ error: "Please log in." });
    }
    
    let { browseId, name } = req.body;
    
    // Resolve browseId if only name is provided
    if (name && !browseId) {
      const followedArtists = await User.getFollowedArtists(req.session.user._id);
      const matched = followedArtists.find(a => a.name.toLowerCase() === name.toLowerCase());
      if (matched) {
        browseId = matched.browseId;
      } else {
        const searchSongs = require("./utils/youtube").searchSongs;
        const searchResults = await searchSongs(name);
        const artistMatch = searchResults.find(r => r.type === 'artist');
        if (artistMatch) {
          browseId = artistMatch.browseId;
        }
      }
    }
    
    if (!browseId) {
      return res.status(400).json({ error: "Artist browseId is required." });
    }
    
    const followed = await User.unfollowArtist(req.session.user._id, browseId);
    res.json({ success: true, followedArtists: followed });
  })
);

app.get(
  "/api/artist/followed",
  catchAsync(async (req, res) => {
    if (!req.session.user) {
      return res.json({ followedArtists: [] });
    }
    const followed = await User.getFollowedArtists(req.session.user._id);
    res.json({ followedArtists: followed });
  })
);

app.get(
  "/api/artist/follow/status-by-name",
  catchAsync(async (req, res) => {
    if (!req.session.user) {
      return res.json({ followed: false });
    }
    const { name } = req.query;
    if (!name) return res.json({ followed: false });
    
    const mainArtist = name.split(/[,&]/)[0].trim().toLowerCase();
    const followedArtists = await User.getFollowedArtists(req.session.user._id);
    const followed = followedArtists.some(a => a.name.toLowerCase() === mainArtist);
    res.json({ followed });
  })
);

// ===== PLAYLISTS APIs =====
app.get(
  "/api/playlists",
  catchAsync(async (req, res) => {
    if (!req.session.user) return res.json({ playlists: [] });
    const playlists = await User.getPlaylists(req.session.user._id);
    res.json({ playlists });
  })
);

app.post(
  "/api/playlists",
  catchAsync(async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Please log in to create playlists." });
    const { name } = req.body;
    const playlist = await User.createPlaylist(req.session.user._id, name);
    res.json({ success: true, playlist });
  })
);

app.delete(
  "/api/playlists/:id",
  catchAsync(async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Please log in." });
    const playlists = await User.deletePlaylist(req.session.user._id, req.params.id);
    res.json({ success: true, playlists });
  })
);

app.post(
  "/api/playlists/:id/add",
  catchAsync(async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Please log in." });
    const { videoId, title, artist, image } = req.body;
    const playlist = await User.addSongToPlaylist(req.session.user._id, req.params.id, { videoId, title, artist, image });
    if (!playlist) return res.status(404).json({ error: "Playlist not found." });
    res.json({ success: true, playlist });
  })
);

app.post(
  "/api/playlists/:id/remove",
  catchAsync(async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Please log in." });
    const { videoId } = req.body;
    const playlist = await User.removeSongFromPlaylist(req.session.user._id, req.params.id, videoId);
    if (!playlist) return res.status(404).json({ error: "Playlist not found." });
    res.json({ success: true, playlist });
  })
);

// ===== PLAY HISTORY APIs =====
app.get(
  "/api/library/history",
  catchAsync(async (req, res) => {
    if (!req.session.user) {
      return res.json({ history: [] });
    }
    const history = await User.getHistory(req.session.user._id);
    res.json({ history });
  })
);

app.post(
  "/api/library/history",
  catchAsync(async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ error: "Please log in to save history." });
    }
    const { videoId, title, artist, image } = req.body;
    if (!videoId || !title) {
      return res.status(400).json({ error: "Video ID and Title are required." });
    }
    const history = await User.addToHistory(req.session.user._id, { videoId, title, artist, image });
    res.json({ success: true, history });
  })
);

// ===== SMART RECOMMENDATION PLAY QUEUE ENGINE =====
app.get(
  "/api/recommend/play-queue",
  catchAsync(async (req, res) => {
    const { videoId, title, artist, thumbnail } = req.query;
    if (!videoId || !title) {
      return res.status(400).json({ error: "Video ID and Title are required to seed the queue." });
    }

    const isPodcastActive = req.query.isPodcast === 'true';

    const firstTrack = {
      videoId,
      title,
      artist: artist || "Unknown Artist",
      thumbnail: thumbnail || ""
    };

    let queue = [firstTrack];
    let similarTracks = [];
    const { searchSongs, getTrending } = require("./utils/youtube");

    // Helper check to identify podcasts or episodes
    const isPodcastTitle = (t, a) => {
      const lower = `${t} ${a}`.toLowerCase();
      return lower.includes("podcast") || lower.includes("episode") || lower.includes("talk show");
    };

    if (isPodcastActive) {
      // 1. Fetch podcast episodes using YouTube Music search
      try {
        const cleanArtist = (artist || "").replace(/[,&].*$/, "").trim();
        const searchQuery = cleanArtist ? `${cleanArtist} podcast` : `${title} podcast`;
        const searchData = await searchSongs(searchQuery);
        if (searchData && searchData.length > 0) {
          similarTracks = searchData
            .filter(r => r.videoId !== videoId)
            .map(s => ({
              videoId: s.videoId,
              title: s.title,
              artist: s.artist || artist || "Podcast Show",
              thumbnail: s.thumbnail || ""
            }));
        }
      } catch (err) {
        console.error("Failed to fetch similar podcast episodes:", err.message);
      }

      let pool = [...similarTracks];
      // Keep only podcast episodes in podcast queues
      pool = pool.filter(item => isPodcastTitle(item.title, item.artist));

      // Remove duplicates from pool
      const seenIds = new Set([videoId]);
      const uniquePool = [];
      pool.forEach(track => {
        if (track.videoId && !seenIds.has(track.videoId)) {
          seenIds.add(track.videoId);
          uniquePool.push(track);
        }
      });

      // Shuffle the unique pool
      const shuffleArray = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      };
      const shuffled = shuffleArray(uniquePool);
      queue = queue.concat(shuffled.slice(0, 19));
      return res.json({ queue });

    } else {
      // Standard Song queue logic
      try {
        const cleanArtist = (artist || "").replace(/[,&].*$/, "").trim();
        const searchQuery = cleanArtist ? `${title} ${cleanArtist} radio` : `${title} radio`;
        const searchData = await searchSongs(searchQuery);
        if (searchData && searchData.length > 0) {
          similarTracks = searchData
            .filter(r => r.type === 'song' && r.videoId !== videoId)
            .map(s => ({
              videoId: s.videoId,
              title: s.title,
              artist: s.artist || "Unknown Artist",
              thumbnail: s.thumbnail || ""
            }));
        }
      } catch (err) {
        console.error("Failed to fetch similar tracks:", err.message);
      }

      // 2. Fetch personalized list if user is logged in
      let likedSongs = [];
      let historySongs = [];
      let followedArtists = [];

      if (req.session.user) {
        try {
          likedSongs = await User.getSavedSongs(req.session.user._id);
          historySongs = await User.getHistory(req.session.user._id);
          followedArtists = await User.getFollowedArtists(req.session.user._id);
        } catch (err) {
          console.error("Failed to load user preferences for queue:", err.message);
        }
      }

      // Accumulate candidates
      let pool = [];

      // Add similar tracks from search (weight: high)
      pool.push(...similarTracks.slice(0, 8));

      // Add user liked songs (shuffled, filtered, prioritized same artist)
      if (likedSongs.length > 0) {
        const sameArtistLikes = likedSongs.filter(s => s.videoId !== videoId && s.artist && s.artist.toLowerCase().includes((artist || "").toLowerCase()));
        const otherLikes = likedSongs.filter(s => s.videoId !== videoId && (!s.artist || !s.artist.toLowerCase().includes((artist || "").toLowerCase())));
        
        pool.push(...sameArtistLikes.slice(0, 3));
        pool.push(...otherLikes.slice(0, 3));
      }

      // Add play history songs
      if (historySongs.length > 0) {
        const recentHistory = historySongs.filter(s => s.videoId !== videoId).slice(0, 5);
        pool.push(...recentHistory);
      }

      // Add tracks from followed artists
      if (followedArtists.length > 0) {
        const randomArtist = followedArtists[Math.floor(Math.random() * followedArtists.length)];
        try {
          const artistSongs = await searchSongs(`${randomArtist.name} hits`);
          const artistTracks = artistSongs
            .filter(r => r.type === 'song' && r.videoId !== videoId)
            .map(s => ({
              videoId: s.videoId,
              title: s.title,
              artist: s.artist || randomArtist.name,
              thumbnail: s.thumbnail || ""
            }));
          pool.push(...artistTracks.slice(0, 5));
        } catch (err) {
          console.error("Failed to fetch followed artist hits for queue:", err.message);
        }
      }

      // Add general trending/popular tracks
      try {
        const trending = await getTrending();
        const trendingSongs = [];
        trending.forEach(section => {
          if (section.items) {
            section.items.forEach(item => {
              if (item.type === 'song' && item.videoId !== videoId) {
                trendingSongs.push({
                  videoId: item.videoId,
                  title: item.title,
                  artist: item.subtitle || "Unknown Artist",
                  thumbnail: item.thumbnail || ""
                });
              }
            });
          }
        });
        pool.push(...trendingSongs.slice(0, 10));
      } catch (err) {
        console.error("Failed to load trending items for queue:", err.message);
      }

      // Exclude podcast episodes from standard song queues
      pool = pool.filter(item => !isPodcastTitle(item.title, item.artist));

      // Remove duplicates from pool
      const seenIds = new Set([videoId]);
      const uniquePool = [];
      pool.forEach(track => {
        if (track.videoId && !seenIds.has(track.videoId)) {
          seenIds.add(track.videoId);
          uniquePool.push(track);
        }
      });

      // Shuffle the unique pool
      const shuffleArray = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      };
      const shuffled = shuffleArray(uniquePool);
      queue = queue.concat(shuffled.slice(0, 19));
      return res.json({ queue });
    }
  })
);

app.get("/spotify/add", (req, res) => {
  res.render("listing_song.ejs");
});

app.post(
  "/add-user",
  catchAsync(async (req, res) => {
    const { title, artist, image } = req.body;

    if (!title || !title.trim()) {
      req.flash("error", "Song title is required.");
      return res.redirect("/spotify/add");
    }

    if (!artist || !artist.trim()) {
      req.flash("error", "Artist name is required.");
      return res.redirect("/spotify/add");
    }

    const sanitizedTitle = title.trim().slice(0, 200);
    const sanitizedArtist = artist.trim().slice(0, 200);
    const sanitizedImage = image ? image.trim().slice(0, 500) : "";

    if (sanitizedImage && !sanitizedImage.startsWith("http://") && !sanitizedImage.startsWith("https://") && !sanitizedImage.startsWith("/")) {
      req.flash("error", "Image must be a valid URL or path.");
      return res.redirect("/spotify/add");
    }

    const newListing = new Listing(sanitizedTitle, sanitizedArtist, sanitizedImage);
    await newListing.save();
    req.flash("success", `Song "${sanitizedTitle}" added successfully!`);
    res.redirect("/spotify");
  })
);

app.delete(
  "/spotify/song/:id",
  catchAsync(async (req, res) => {
    const { id } = req.params;
    const deleted = await Listing.findByIdAndDelete(id);
    if (!deleted) {
      req.flash("error", "Song not found.");
    } else {
      req.flash("success", "Song deleted successfully!");
    }
    res.redirect("/spotify");
  })
);

app.get(
  "/api/search",
  catchAsync(async (req, res) => {
    const query = req.query.q;
    if (!query || !query.trim()) {
      return res.json({ results: [] });
    }

    const results = await searchSongs(query);
    if (results.length === 0) {
      return res.json({ results: [], message: "No results found" });
    }

    res.json({ results });
  })
);

app.get(
  "/api/stream/:videoId",
  catchAsync(async (req, res) => {
    const { videoId } = req.params;
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      return res.status(400).json({ error: "Invalid video ID" });
    }
    const streamData = await getStreamUrl(videoId);

    if (!streamData || !streamData.url) {
      return res.status(404).json({ error: "Could not get stream URL" });
    }

    // The signed media URL is short-lived, so keep this browser cache deliberately brief.
    res.set("Cache-Control", "private, max-age=300");
    res.json(streamData);
  })
);

app.get(
  "/api/browse",
  catchAsync(async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");

    let personalizedShelves = [];
    const { searchSongs } = require("./utils/youtube");

    if (req.session.user) {
      try {
        const userId = req.session.user._id;
        const history = await User.getHistory(userId);
        const likedSongs = await User.getSavedSongs(userId);
        const followedArtists = await User.getFollowedArtists(userId);

        // 1. Recently Played Shelf
        if (history && history.length > 0) {
          personalizedShelves.push({
            title: "Recently Played",
            items: history.slice(0, 8).map(s => ({
              videoId: s.videoId,
              title: s.title,
              subtitle: s.artist || "Unknown Artist",
              thumbnail: s.image || "",
              type: "song"
            }))
          });
        }

        // 2. Liked Songs Shelf
        if (likedSongs && likedSongs.length > 0) {
          personalizedShelves.push({
            title: "Your Liked Songs",
            items: likedSongs.slice(0, 8).map(s => ({
              videoId: s.videoId,
              title: s.title,
              subtitle: s.artist || "Unknown Artist",
              thumbnail: s.image || "",
              type: "song"
            }))
          });
        }

        // 3. Recommended based on Liked Artist
        if (likedSongs && likedSongs.length > 0) {
          const randomLiked = likedSongs[Math.floor(Math.random() * likedSongs.length)];
          const cleanArtist = (randomLiked.artist || "").replace(/[,&].*$/, "").trim();
          if (cleanArtist) {
            try {
              const recSongs = await searchSongs(`${cleanArtist} similar songs`);
              const items = recSongs
                .filter(r => r.type === 'song' && r.videoId !== randomLiked.videoId)
                .slice(0, 8)
                .map(s => ({
                  videoId: s.videoId,
                  title: s.title,
                  subtitle: s.artist || cleanArtist,
                  thumbnail: s.thumbnail || "",
                  type: "song"
                }));

              if (items.length > 0) {
                personalizedShelves.push({
                  title: `Recommended based on ${cleanArtist}`,
                  items
                });
              }
            } catch (err) {
              console.error("Failed to fetch similar recommendations for liked artist:", err.message);
            }
          }
        }

        // 4. Followed Artist Shelves
        if (followedArtists && followedArtists.length > 0) {
          const selectedArtists = followedArtists.slice(-2); // Take last 2 followed artists
          const { getArtistPage } = require('./utils/youtube');

          for (const artist of selectedArtists) {
            try {
              const artistData = await getArtistPage(artist.browseId);
              if (artistData) {
                const items = [];
                if (artistData.popularSongs) {
                  artistData.popularSongs.forEach(song => {
                    items.push({
                      title: song.title,
                      subtitle: song.artists || artistData.name,
                      thumbnail: song.thumbnail,
                      videoId: song.videoId,
                      type: 'song'
                    });
                  });
                }
                if (items.length > 0) {
                  personalizedShelves.push({
                    title: `More from ${artistData.name}`,
                    items: items.slice(0, 8)
                  });
                }
              }
            } catch (err) {
              console.error(`Failed to load followed artist shelf for ${artist.name}:`, err.message);
            }
          }
        }

        // 5. Your Daily Mix Shelf
        const mixPool = [];
        if (likedSongs.length > 0) mixPool.push(...likedSongs.map(s => ({ ...s, source: 'liked' })));
        if (history.length > 0) mixPool.push(...history.map(s => ({ ...s, source: 'history' })));
        
        if (mixPool.length > 0) {
          const shuffleArray = (arr) => {
            for (let i = arr.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
          };
          const uniqueMix = [];
          const seenIds = new Set();
          shuffleArray(mixPool).forEach(item => {
            if (item.videoId && !seenIds.has(item.videoId)) {
              seenIds.add(item.videoId);
              uniqueMix.push({
                videoId: item.videoId,
                title: item.title,
                subtitle: item.artist || "Daily Mix Selection",
                thumbnail: item.image || item.thumbnail || "",
                type: "song"
              });
            }
          });

          if (uniqueMix.length > 0) {
            personalizedShelves.push({
              title: "Your Daily Mix",
              items: uniqueMix.slice(0, 8)
            });
          }
        }

      } catch (err) {
        console.error("Error building personalized browse shelves:", err);
      }
    }

    const baseSections = await getTrending();
    const sections = [...personalizedShelves, ...baseSections];
    res.json({ sections });
  })
);

// Artist page (server-rendered)
app.get('/spotify/artist/:browseId', catchAsync(async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  const { browseId } = req.params;
  const { getArtistPage } = require('./utils/youtube');
  const artistData = await getArtistPage(browseId);
  if (!artistData || !artistData.name) {
    throw new ExpressError(404, 'Artist not found');
  }
  artistData.browseId = browseId;
  res.render('artist.ejs', { artistData });
}));

// Artist page API (for AJAX loading)
app.get('/api/artist/:browseId', catchAsync(async (req, res) => {
  const { browseId } = req.params;
  const { getArtistPage } = require('./utils/youtube');
  const artistData = await getArtistPage(browseId);
  if (!artistData) {
    return res.status(404).json({ error: 'Artist not found' });
  }
  artistData.browseId = browseId;
  res.json(artistData);
}));

// Album page API (for playing albums)
app.get('/api/album/:browseId', catchAsync(async (req, res) => {
  const { browseId } = req.params;
  const { getAlbum } = require('./utils/youtube');
  const albumData = await getAlbum(browseId);
  if (!albumData) {
    return res.status(404).json({ error: 'Album not found' });
  }
  res.json(albumData);
}));

app.get('/spotify/album/:browseId', catchAsync(async (req, res) => {
  const { browseId } = req.params;
  const { getAlbum } = require('./utils/youtube');
  const albumData = await getAlbum(browseId);
  if (!albumData || !albumData.tracks?.length) {
    throw new ExpressError(404, 'Album not found');
  }
  // Some YouTube Music playlist-style album browse responses contain tracks
  // but omit the detail header. Preserve the card metadata in the page URL.
  albumData.title = albumData.title || String(req.query.title || 'Album').slice(0, 200);
  albumData.artist = albumData.artist || String(req.query.artist || albumData.tracks[0].artist || '').slice(0, 200);
  albumData.thumbnail = albumData.thumbnail || String(req.query.thumbnail || albumData.tracks[0].thumbnail || '').slice(0, 1000);
  res.render('album.ejs', { albumData });
}));

// Playlist details page
app.get('/spotify/playlist/:id', catchAsync(async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  
  if (!req.session.user) {
    req.flash("error", "Please log in to view playlists.");
    return res.redirect("/spotify");
  }

  const playlist = await User.getPlaylist(req.session.user._id, req.params.id);
  if (!playlist) {
    throw new ExpressError(404, 'Playlist not found');
  }

  res.render('playlist.ejs', { playlist });
}));

// Podcasts explorer page
app.get('/spotify/podcasts', catchAsync(async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  const { searchSongs } = require('./utils/youtube');
  
  // Search for popular podcasts to populate the podcasts list
  let podcasts = [];
  try {
    podcasts = await searchSongs("popular podcasts");
    podcasts = podcasts.filter(item => item.type === 'artist' || item.type === 'album' || item.type === 'song');
  } catch (err) {
    console.error("Failed to fetch podcasts:", err);
  }

  res.render('podcasts.ejs', { podcasts });
}));

// Podcast show detail page
app.get('/spotify/podcast/:browseId', catchAsync(async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  const { browseId } = req.params;
  const { getArtistPage, getAlbum } = require('./utils/youtube');
  
  let podcastData = null;
  if (browseId.startsWith("UC")) {
    podcastData = await getArtistPage(browseId);
  } else {
    podcastData = await getAlbum(browseId);
  }

  if (!podcastData) {
    throw new ExpressError(404, 'Podcast not found');
  }

  res.render('podcast_detail.ejs', { podcastData, browseId });
}));

app.all("*", (req, res, next) => {
  next(new ExpressError(404, "Page Not Found"));
});

app.use((err, req, res, next) => {
  const { statusCode = 500, message = "Something went wrong!" } = err;
  console.error(`[${statusCode}] ${message}`, err.stack || "");

  if (req.path.startsWith("/api/") || req.xhr || (req.headers.accept && req.headers.accept.includes("json"))) {
    return res.status(statusCode).json({ error: message });
  }

  req.flash("error", message);
  if (req.method === "GET") {
    return res.status(statusCode).render("error.ejs", { statusCode, message });
  }
  res.status(statusCode).redirect("back");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
