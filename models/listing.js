const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const Review = require("./review.js");
const User = require("./user.js");

let listingSchema = new Schema({
    title: {
        type: String,
        required: true,
    },
    description: String,
    images: [
        {
            url: String,
            filename: String,
        }
    ],
    price: {
        type: Number,
        min: 0,
    },
    location: String,
    country: String,
    amenities: {
        type: Schema.Types.Mixed,
        default: {},
    },
    reviews: [
        {
            type: Schema.Types.ObjectId,
            ref: "Review"
        }
    ],
    owner: {
        type: Schema.Types.ObjectId,
        ref: "User",
    },
    geometry: {
        type:{
            type: String,
            enum: ["Point"],
            required: true,
        },
        coordinates: {
            type: [Number],
            required: true,
        }
    }
}, { timestamps: true });

listingSchema.post("findOneAndDelete", async (listing) => {
    if(listing){
        await Review.deleteMany({_id : { $in: listing.reviews}});
    }
})

let Listing = mongoose.model("Listing", listingSchema);
module.exports = Listing;