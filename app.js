const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const { GridFSBucket } = require("mongodb");
const { Readable } = require("stream");
const ejs = require("ejs");
const path = require("path");
const session = require("express-session");
const flash = require("connect-flash");
const methodOverride = require("method-override");
const catchAsync = require("./utils/catchAsync");
const ExpressError = require("./utils/ExpressError");

// Load environment variables if .env file exists
try {
    require("dotenv").config();
} catch (e) {
    // dotenv is optional; fall back to process.env or defaults
}

const app = express();
const Listing = require("./models/schema");

// ---------- Multer Configuration ----------
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            "audio/mpeg",
            "audio/mp3",
            "audio/wav",
            "audio/x-wav",
            "audio/ogg",
            "audio/mp4",
            "audio/x-m4a",
            "audio/aac",
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new ExpressError(400, "Invalid audio file type. Only MP3, WAV, OGG, M4A, AAC allowed."));
        }
    },
});

// ---------- Database Configuration ----------
const MONGO_URL =
    process.env.MONGO_URL || "mongodb://127.0.0.1:27017/spotify_clone";

const SESSION_SECRET =
    process.env.SESSION_SECRET || "musickeysecret_dev_only";

// ---------- Session Configuration ----------
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

// Make flash messages available in all views
app.use((req, res, next) => {
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    next();
});

// ---------- GridFS Setup ----------
let gfsBucket;
let dbReady = false;

async function main() {
    await mongoose.connect(MONGO_URL);
    const db = mongoose.connection.db;
    gfsBucket = new GridFSBucket(db, { bucketName: "audioFiles" });
    dbReady = true;
    console.log("Connected to MongoDB & GridFS ready");
}

main()
    .then(() => {
        console.log("Database connection established");
    })
    .catch((err) => {
        console.error("MongoDB Connection Error:", err);
        process.exit(1); // Exit if DB connection fails
    });

// ---------- Express Middleware ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// ---------- Routes ----------

// Home
app.get("/", (req, res) => {
    res.redirect("/spotify");
});

// Main music player page
app.get(
    "/spotify",
    catchAsync(async (req, res) => {
        const files = await mongoose.connection.db
            .collection("audioFiles.files")
            .find()
            .toArray();
        const allListings = await Listing.find({});
        res.render("index.ejs", { allListings, files });
    })
);

// Upload page
app.get("/spotify/upload", (req, res) => {
    res.render("upload");
});

// Login page (UI only - no auth implemented)
app.get("/spotify/login", (req, res) => {
    res.render("login.ejs");
});

// Add song form
app.get("/spotify/add", (req, res) => {
    res.render("listing_song.ejs");
});

// Stream audio from GridFS
app.get("/audio/:filename", (req, res) => {
    if (!dbReady || !gfsBucket) {
        return res.status(503).send("Database not ready. Please try again.");
    }

    const { filename } = req.params;

    // Validate filename to prevent path traversal
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
        return res.status(400).send("Invalid filename");
    }

    const downloadStream = gfsBucket.openDownloadStreamByName(filename);

    downloadStream.on("error", (err) => {
        console.error("GridFS stream error:", err.message);
        if (!res.headersSent) {
            res.status(404).send("Audio file not found");
        }
    });

    res.set("Content-Type", "audio/mpeg");
    res.set("Accept-Ranges", "bytes");
    downloadStream.pipe(res);
});

// Upload audio file to GridFS
app.post(
    "/upload",
    upload.single("audio"),
    catchAsync(async (req, res) => {
        if (!dbReady || !gfsBucket) {
            req.flash("error", "Database not ready. Please wait and try again.");
            return res.redirect("/spotify/upload");
        }

        if (!req.file) {
            req.flash("error", "Please select an audio file to upload.");
            return res.redirect("/spotify/upload");
        }

        const { originalname, buffer, mimetype } = req.file;

        // Sanitize filename
        const sanitizedFilename = originalname.replace(/[^a-zA-Z0-9._-]/g, "_");

        const readableStream = new Readable();
        readableStream.push(buffer);
        readableStream.push(null);

        const uploadStream = gfsBucket.openUploadStream(sanitizedFilename, {
            contentType: mimetype || "audio/mpeg",
            metadata: {
                originalName: originalname,
                uploadedAt: new Date(),
            },
        });

        readableStream.pipe(uploadStream);

        return new Promise((resolve, reject) => {
            uploadStream.on("finish", () => {
                req.flash("success", `Audio "${originalname}" uploaded successfully!`);
                res.redirect("/spotify");
                resolve();
            });

            uploadStream.on("error", (err) => {
                console.error("Upload stream error:", err);
                req.flash("error", "Upload failed: " + err.message);
                res.redirect("/spotify/upload");
                resolve();
            });
        });
    })
);

// Add song metadata (title, artist, image)
app.post(
    "/add-user",
    catchAsync(async (req, res) => {
        const { title, artist, image } = req.body;

        // Input validation
        if (!title || !title.trim()) {
            req.flash("error", "Song title is required.");
            return res.redirect("/spotify/add");
        }

        if (!artist || !artist.trim()) {
            req.flash("error", "Artist name is required.");
            return res.redirect("/spotify/add");
        }

        // Sanitize inputs - trim and limit length
        const sanitizedTitle = title.trim().slice(0, 200);
        const sanitizedArtist = artist.trim().slice(0, 200);
        const sanitizedImage = image ? image.trim().slice(0, 500) : "";

        // Validate image URL if provided (basic check)
        if (sanitizedImage && !sanitizedImage.startsWith("http://") && !sanitizedImage.startsWith("https://") && !sanitizedImage.startsWith("/")) {
            req.flash("error", "Image must be a valid URL or path.");
            return res.redirect("/spotify/add");
        }

        const newListing = new Listing({
            title: sanitizedTitle,
            artist: sanitizedArtist,
            image: sanitizedImage || undefined,
        });

        await newListing.save();
        req.flash("success", `Song "${sanitizedTitle}" added successfully!`);
        res.redirect("/spotify");
    })
);

// Delete a song (POST with method override, or DELETE)
app.delete(
    "/spotify/song/:id",
    catchAsync(async (req, res) => {
        const { id } = req.params;

        // Validate ObjectId format
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            req.flash("error", "Invalid song ID.");
            return res.redirect("/spotify");
        }

        const deleted = await Listing.findByIdAndDelete(id);
        if (!deleted) {
            req.flash("error", "Song not found.");
        } else {
            req.flash("success", "Song deleted successfully!");
        }
        res.redirect("/spotify");
    })
);

// 404 handler
app.all("*", (req, res, next) => {
    next(new ExpressError(404, "Page Not Found"));
});

// Global error handler
app.use((err, req, res, next) => {
    const { statusCode = 500, message = "Something went wrong!" } = err;
    console.error(`[${statusCode}] ${message}`, err.stack || "");

    // For API-like requests, send JSON
    if (req.xhr || (req.headers.accept && req.headers.accept.includes("json"))) {
        return res.status(statusCode).json({ error: message });
    }

    // For HTML requests, flash and redirect or render
    req.flash("error", message);
    if (req.method === "GET") {
        return res.status(statusCode).render("error.ejs", { statusCode, message });
    }
    res.status(statusCode).redirect("back");
});

// ---------- Start Server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
