const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const listSchema = new Schema({
    title:String,
    artist:String,
    image:String,
    createdAt: { type: Date, default: Date.now }
});

const Listing = mongoose.model("Listing" , listSchema);

module.exports = Listing;