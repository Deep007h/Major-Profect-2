require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
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
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
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
  if (req.session.user) {
    res.locals.savedSongs = await User.getSavedSongs(req.session.user._id);
  } else {
    res.locals.savedSongs = [];
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
    const streamData = await getStreamUrl(videoId);

    if (!streamData || !streamData.url) {
      return res.status(404).json({ error: "Could not get stream URL" });
    }

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
    const sections = await getTrending();
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

app.all("*", (req, res, next) => {
  next(new ExpressError(404, "Page Not Found"));
});

app.use((err, req, res, next) => {
  const { statusCode = 500, message = "Something went wrong!" } = err;
  console.error(`[${statusCode}] ${message}`, err.stack || "");

  if (req.xhr || (req.headers.accept && req.headers.accept.includes("json"))) {
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
