# Spotify Clone - Music Streaming Platform

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-Express-green?style=for-the-badge&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/MongoDB-Database-green?style=for-the-badge&logo=mongodb" alt="MongoDB">
  <img src="https://img.shields.io/badge/GridFS-Storage-blue?style=for-the-badge" alt="GridFS">
  <img src="https://img.shields.io/badge/EJS-Templates-yellow?style=for-the-badge&logo=ejs" alt="EJS">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License">
</p>

A full-stack music streaming application built with **Node.js**, **Express**, **MongoDB**, and **GridFS** for audio storage. Upload, stream, and manage your music library with a Spotify-inspired UI.

---

## Features

- **Audio Streaming** -- Stream music directly from MongoDB GridFS with seek support
- **Upload Music** -- Upload audio files (MP3, WAV, OGG, M4A, AAC) to the server (max 50 MB)
- **Song Management** -- Add, view, and delete songs with title, artist, and album art metadata
- **Music Player** -- Play/pause controls, progress bar seek, volume control, and track info display
- **Flash Messages** -- User feedback for uploads, additions, deletions, and errors
- **Responsive Design** -- Spotify-inspired UI that adapts to different screen sizes
- **Error Handling** -- Comprehensive error handling with custom error pages and validation
- **Method Override** -- Supports DELETE operations from browser forms

---

## Tech Stack

| Technology | Purpose | Version |
|------------|---------|---------|
| **Node.js** | Runtime environment | >= 18.x |
| **Express.js** | Web framework | ^4.21.2 |
| **MongoDB** | Database | >= 6.x |
| **Mongoose** | ODM for MongoDB | ^8.9.5 |
| **GridFS** | Large file storage | MongoDB built-in |
| **Multer** | File upload handling | ^1.4.5-lts.1 |
| **EJS** | Template engine | ^3.1.10 |
| **Express Session** | Session management | ^1.18.1 |
| **Connect Flash** | Flash messages | ^1.1.1 |
| **Method-Override** | HTTP method override | ^3.0.0 |
| **dotenv** | Environment variable loading | ^16.4.7 |
| **Nodemon** | Development auto-restart (dev) | ^3.1.9 |

---

## Project Structure

```
Major-Profect-2/
├── models/
│   └── schema.js                   # Mongoose schema for song metadata
├── public/
│   ├── assets/                     # Images, icons, UI assets
│   ├── js/
│   │   └── event.js                # Client-side music player logic
│   ├── style.css                   # Main application styles
│   └── login-style.css             # Login page styles
├── utils/
│   ├── catchAsync.js               # Async error wrapper for route handlers
│   └── ExpressError.js             # Custom Express error class
├── views/
│   ├── index.ejs                   # Home page - music player & song listing
│   ├── upload.ejs                  # Audio file upload form
│   ├── login.ejs                   # Login page (UI mockup)
│   ├── listing_song.ejs            # Add song metadata form
│   ├── navbar.ejs                  # Navigation bar partial
│   └── error.ejs                   # Error page template
├── app.js                          # Main application entry point
├── package.json                    # Project metadata and dependencies
├── package-lock.json               # Locked dependency versions
├── .gitignore                      # Git ignore rules
└── README.md                       # This file
```

---

## Getting Started

### Prerequisites

- **Node.js** v18 or higher
- **MongoDB** v6 or higher (local or Atlas)
- **npm** v9 or higher

### Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/Deep007h/Major-Profect-2.git
cd Major-Profect-2
```

#### 2. Install Dependencies

```bash
npm install
```

#### 3. Configure Environment Variables

Create a `.env` file in the project root (optional -- defaults are provided):

```bash
# .env
MONGO_URL=mongodb://127.0.0.1:27017/spotify_clone
PORT=3000
SESSION_SECRET=your_secure_random_secret_here
```

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGO_URL` | MongoDB connection string | `mongodb://127.0.0.1:27017/spotify_clone` |
| `PORT` | Server port | `3000` |
| `SESSION_SECRET` | Session encryption secret | `musickeysecret_dev_only` |

#### 4. Start MongoDB

```bash
# Local MongoDB
mongod

# Or use MongoDB Atlas (cloud) -- set MONGO_URL in .env
```

#### 5. Run the Server

```bash
# Production mode
npm start

# Development mode (with auto-restart via nodemon)
npm run dev
```

#### 6. Access the Application

Open your browser and visit: **http://localhost:3000**

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Redirect to `/spotify` |
| GET | `/spotify` | Music player home page |
| GET | `/spotify/upload` | Upload audio form |
| GET | `/spotify/login` | Login page |
| GET | `/spotify/add` | Add song metadata form |
| POST | `/upload` | Upload audio file to GridFS |
| POST | `/add-user` | Add new song metadata |
| GET | `/audio/:filename` | Stream audio file from GridFS |
| DELETE | `/spotify/song/:id` | Delete a song by ID |
| POST | `/spotify/song/:id?_method=DELETE` | Delete via form (method override) |

---

## Usage Guide

### Uploading Music

1. Navigate to **Upload** from the navigation bar
2. Select an audio file (MP3, WAV, OGG, M4A, AAC -- max 50 MB)
3. Click **Upload**
4. The audio is stored in MongoDB GridFS and you will be redirected home

### Adding Song Metadata

1. Go to **Add Song** from the navigation bar
2. Enter:
   - **Title** -- Song name (required, max 200 characters)
   - **Artist** -- Artist name (required, max 200 characters)
   - **Image** -- Album art URL (optional)
3. Click **Add Song** to save

### Playing Music

1. Visit the home page at `/spotify`
2. Click on any song card to start playback
3. Use the player controls at the bottom:
   - **Play/Pause** -- Toggle playback
   - **Progress Bar** -- Seek to any position
   - **Volume Slider** -- Adjust volume level
4. The currently playing track info is displayed in the bottom-left

### Deleting a Song

Songs can be deleted via the DELETE endpoint. Form-based deletion uses `_method=DELETE` query parameter with method-override middleware.

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGO_URL` | MongoDB connection string | `mongodb://127.0.0.1:27017/spotify_clone` |
| `PORT` | Server port | `3000` |
| `SESSION_SECRET` | Session encryption secret | `musickeysecret_dev_only` |

---

## Bugs and Troubleshooting

### MongoDB Connection Error

```
MongoServerSelectionError: connect ECONNREFUSED
```

**Solution:** Ensure MongoDB is running:
```bash
mongod
```

### Port Already in Use

```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solution:**
```bash
# Find process using port 3000
lsof -i :3000
# Kill it
kill <PID>
# Or set a different PORT in .env
```

### File Upload Issues

- Maximum file size is 50 MB
- Supported formats: MP3, WAV, OGG, M4A, AAC
- Check that MongoDB is running and GridFS bucket is initialized

### Audio Streaming Not Working

- Ensure audio files were uploaded successfully (check flash messages)
- Verify files exist in the `audioFiles.files` collection
- Check browser console for JavaScript errors

---

## Known Limitations

- **Authentication** -- The login page is UI-only; no actual authentication is implemented
- **Social Login Buttons** -- Google, Facebook, and Apple login buttons are decorative
- **Search** -- Search functionality is a placeholder (logs to console)
- **Multiple Audio Sources** -- Currently loads only the first uploaded audio file for playback
- **No User Accounts** -- All songs are shared globally; no per-user libraries

---

## Screenshots

### Home Page (Music Player)
- Lists all songs with album art
- Click any card to play
- Streaming from MongoDB GridFS
- Bottom player bar with controls

### Upload Page
- File upload form with format/size info
- Flash message feedback on success/failure

### Add Song Page
- Metadata form for title, artist, and image URL
- Input validation and sanitization

---

## Contributing

Contributions are welcome! Please follow these steps:

1. **Fork** the repository
2. **Create** a new branch (`git checkout -b feature/AmazingFeature`)
3. **Commit** your changes (`git commit -m 'Add some AmazingFeature'`)
4. **Push** to the branch (`git push origin feature/AmazingFeature`)
5. **Open** a Pull Request

### Coding Standards

- Use `catchAsync` wrapper for all async route handlers
- Validate and sanitize all user inputs
- Keep views modular (use EJS partials)
- Handle errors with the custom `ExpressError` class

---

## License

This project is licensed under the **MIT License**.

---

## Acknowledgments

- [MongoDB](https://www.mongodb.com/) -- Database & GridFS
- [Express.js](https://expressjs.com/) -- Web framework
- [Multer](https://github.com/expressjs/multer) -- File uploads
- [EJS](https://ejs.co/) -- Templating engine
- [Font Awesome](https://fontawesome.com/) -- Icons
- [Bootstrap](https://getbootstrap.com/) -- CSS framework

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/Deep007h">Deep007h</a>
</p>

[![GitHub stars](https://img.shields.io/github/stars/Deep007h/Major-Profect-2?style=social)](https://github.com/Deep007h/Major-Profect-2/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/Deep007h/Major-Profect-2?style=social)](https://github.com/Deep007h/Major-Profect-2/network)

