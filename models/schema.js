const Datastore = require('nedb-promises');
const path = require('path');

const db = Datastore.create({
  filename: path.join(__dirname, '..', 'data', 'songs.db'),
  autoload: true
});

class Listing {
  constructor(title, artist, image) {
    this.title = title;
    this.artist = artist;
    this.image = image || '';
    this.createdAt = new Date();
  }

  async save() {
    return await db.insert(this);
  }

  static async find(query) {
    return await db.find(query || {});
  }

  static async findById(id) {
    return await db.findOne({ _id: id });
  }

  static async findByIdAndDelete(id) {
    return await db.remove({ _id: id }, {});
  }
}

module.exports = Listing;
module.exports.db = db;
