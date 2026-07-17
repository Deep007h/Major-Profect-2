const express = require("express");
const path = require("path");
const session = require("express-session");
const flash = require("connect-flash");
const methodOverride = require("method-override");
const catchAsync = require("./utils/catchAsync");
const ExpressError = require("./utils/ExpressError");
const { searchSongs, getStreamUrl } = require("./utils/youtube");

const app = express();
const Listing = require("./models/schema");

const SESSION_SECRET = process.env.SESSION_SECRET || "musickeysecret_dev_only";

const sessionOptions = {
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
  },
};

app.use(session(sessionOptions));
app.use(flash());
app.use(methodOverride("_method"));

app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  next();
});

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
