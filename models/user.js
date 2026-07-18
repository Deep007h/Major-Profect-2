const Datastore = require('nedb-promises');
const path = require('path');
const crypto = require('crypto');

const db = Datastore.create({
  filename: path.join(__dirname, '..', 'data', 'users.db'),
  autoload: true
});

// Legacy unsalted SHA-256 (kept only to verify pre-existing accounts)
function legacyHash(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// New salted scrypt hashing: stored as "scrypt$<saltHex>$<hashHex>"
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;

  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    if (!salt || !hash) return false;
    const derived = crypto.scryptSync(password, salt, 64);
    const hashBuf = Buffer.from(hash, 'hex');
    return hashBuf.length === derived.length && crypto.timingSafeEqual(hashBuf, derived);
  }

  // Legacy SHA-256 verification (constant-time)
  const legacy = Buffer.from(legacyHash(password), 'hex');
  const storedBuf = Buffer.from(stored, 'hex');
  return storedBuf.length === legacy.length && crypto.timingSafeEqual(storedBuf, legacy);
}

class User {
  constructor(username, password) {
    this.username = username.trim().toLowerCase();
    this.password = hashPassword(password);
    this.savedSongs = []; // Array of { videoId, title, artist, image }
    this.followedArtists = []; // Array of { browseId, name, thumbnail }
    this.history = []; // Array of { videoId, title, artist, image, playedAt }
    this.playlists = []; // Array of { id, name, description, songs }
    this.createdAt = new Date();
  }

  static async register(username, password) {
    if (!username || !password) {
      throw new Error("Username and password are required.");
    }
    const cleanUsername = username.trim().toLowerCase();
    const existing = await db.findOne({ username: cleanUsername });
    if (existing) {
      throw new Error("Username already exists.");
    }
    const newUser = new User(cleanUsername, password);
    return await db.insert(newUser);
  }

  static async authenticate(username, password) {
    if (!username || !password) return null;
    const cleanUsername = username.trim().toLowerCase();
    const user = await db.findOne({ username: cleanUsername });
    if (!user || !verifyPassword(password, user.password)) return null;

    // Transparently upgrade legacy SHA-256 hashes to salted scrypt on login
    if (!user.password.startsWith('scrypt$')) {
      const upgraded = hashPassword(password);
      await db.update({ _id: user._id }, { $set: { password: upgraded } });
      user.password = upgraded;
    }
    return user;
  }

  static async saveSong(userId, song) {
    const user = await db.findOne({ _id: userId });
    if (!user) return null;

    if (!user.savedSongs) user.savedSongs = [];

    // Check if song is already saved
    const exists = user.savedSongs.some(s => s.videoId === song.videoId);
    if (!exists) {
      user.savedSongs.push({
        videoId: song.videoId,
        title: song.title,
        artist: song.artist,
        image: song.image
      });
      await db.update({ _id: userId }, { $set: { savedSongs: user.savedSongs } });
    }
    return user.savedSongs;
  }

  static async unsaveSong(userId, videoId) {
    const user = await db.findOne({ _id: userId });
    if (!user) return null;

    if (!user.savedSongs) return [];

    user.savedSongs = user.savedSongs.filter(s => s.videoId !== videoId);
    await db.update({ _id: userId }, { $set: { savedSongs: user.savedSongs } });
    return user.savedSongs;
  }

  static async getSavedSongs(userId) {
    const user = await db.findOne({ _id: userId });
    return user && user.savedSongs ? user.savedSongs : [];
  }

  static async followArtist(userId, artist) {
    const user = await db.findOne({ _id: userId });
    if (!user) return null;

    if (!user.followedArtists) user.followedArtists = [];

    const exists = user.followedArtists.some(a => a.browseId === artist.browseId);
    if (!exists) {
      user.followedArtists.push({
        browseId: artist.browseId,
        name: artist.name,
        thumbnail: artist.thumbnail || ''
      });
      await db.update({ _id: userId }, { $set: { followedArtists: user.followedArtists } });
    }
    return user.followedArtists;
  }

  static async unfollowArtist(userId, browseId) {
    const user = await db.findOne({ _id: userId });
    if (!user) return null;

    if (!user.followedArtists) return [];

    user.followedArtists = user.followedArtists.filter(a => a.browseId !== browseId);
    await db.update({ _id: userId }, { $set: { followedArtists: user.followedArtists } });
    return user.followedArtists;
  }

  static async getFollowedArtists(userId) {
    const user = await db.findOne({ _id: userId });
    return user && user.followedArtists ? user.followedArtists : [];
  }

  static async addToHistory(userId, song) {
    const user = await db.findOne({ _id: userId });
    if (!user) return null;

    if (!user.history) user.history = [];

    // Filter out duplicates so the song is bumped to the top of the history list
    user.history = user.history.filter(s => s.videoId !== song.videoId);

    user.history.unshift({
      videoId: song.videoId,
      title: song.title,
      artist: song.artist || '',
      image: song.image || '',
      playedAt: new Date()
    });

    // Enforce history cap (max 50 tracks)
    if (user.history.length > 50) {
      user.history = user.history.slice(0, 50);
    }

    await db.update({ _id: userId }, { $set: { history: user.history } });
    return user.history;
  }

  static async getHistory(userId) {
    const user = await db.findOne({ _id: userId });
    return user && user.history ? user.history : [];
  }

  static async createPlaylist(userId, name) {
    const user = await db.findOne({ _id: userId });
    if (!user) return null;
    if (!user.playlists) user.playlists = [];
    const newPlaylist = {
      id: crypto.randomBytes(8).toString('hex'),
      name: name || `My Playlist #${user.playlists.length + 1}`,
      description: "A custom playlist",
      songs: []
    };
    user.playlists.push(newPlaylist);
    await db.update({ _id: userId }, { $set: { playlists: user.playlists } });
    return newPlaylist;
  }

  static async deletePlaylist(userId, playlistId) {
    const user = await db.findOne({ _id: userId });
    if (!user) return null;
    if (!user.playlists) return [];
    user.playlists = user.playlists.filter(p => p.id !== playlistId);
    await db.update({ _id: userId }, { $set: { playlists: user.playlists } });
    return user.playlists;
  }

  static async addSongToPlaylist(userId, playlistId, song) {
    const user = await db.findOne({ _id: userId });
    if (!user) return null;
    if (!user.playlists) user.playlists = [];
    const playlist = user.playlists.find(p => p.id === playlistId);
    if (playlist) {
      if (!playlist.songs) playlist.songs = [];
      const exists = playlist.songs.some(s => s.videoId === song.videoId);
      if (!exists) {
        playlist.songs.push({
          videoId: song.videoId,
          title: song.title,
          artist: song.artist,
          image: song.image
        });
        await db.update({ _id: userId }, { $set: { playlists: user.playlists } });
      }
    }
    return playlist;
  }

  static async removeSongFromPlaylist(userId, playlistId, videoId) {
    const user = await db.findOne({ _id: userId });
    if (!user) return null;
    if (!user.playlists) return null;
    const playlist = user.playlists.find(p => p.id === playlistId);
    if (playlist && playlist.songs) {
      playlist.songs = playlist.songs.filter(s => s.videoId !== videoId);
      await db.update({ _id: userId }, { $set: { playlists: user.playlists } });
    }
    return playlist;
  }

  static async getPlaylists(userId) {
    const user = await db.findOne({ _id: userId });
    return user && user.playlists ? user.playlists : [];
  }

  static async getPlaylist(userId, playlistId) {
    const user = await db.findOne({ _id: userId });
    if (!user || !user.playlists) return null;
    return user.playlists.find(p => p.id === playlistId) || null;
  }
}

module.exports = User;
module.exports.db = db;
