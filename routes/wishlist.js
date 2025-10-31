const express = require('express');
const router = express.Router();
const { isLoggedin } = require("../middleware.js");
const Listing = require("../models/listing.js");
const User = require("../models/user.js");
const Wishlist = require("../models/wishlist.js");

router.post('/wishlist', isLoggedin, async (req, res) => {
  try {
    const { listingId } = req.body;
    const userId = req.user._id;

    if (!listingId) {
      return res.status(400).json({ success: false, message: 'Listing ID is required' });
    }

    const existing = await Wishlist.findOne({ user: userId, listing: listingId });

    if (existing) {
      await Wishlist.deleteOne({ _id: existing._id });
      return res.status(200).json({ success: true, added: false, message: 'Removed from wishlist' });
    }

    await Wishlist.create({ user: userId, listing: listingId });
    return res.status(200).json({ success: true, added: true, message: 'Added to wishlist' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

router.get("/:id/wishlist",async (req, res) => {
  let { id } = req.params;
  let wishlists = await Wishlist.find({user: id});
  let listingIds = []; 
  let listings = [];
  for(wishlist of wishlists){
    listingIds.push(wishlist.listing);
  }
  for(const lid of listingIds){
    const doc = await Listing.findById(lid);
    if (!doc) continue;
    const o = doc.toObject();
    const img0 = (o.images && o.images.length) ? o.images[0] : null;
    const img0Url = img0 ? (typeof img0 === 'string' ? img0 : (img0.url || img0.secure_url || img0.path)) : null;
    const single = o.image || null;
    const singleUrl = single ? (typeof single === 'string' ? single : (single.url || single.secure_url || single.path)) : null;
    listings.push({ ...o, displayUrl: img0Url || singleUrl || null });
  }
  res.render("partials/wishlist.ejs" , {listings})
});

router.delete('/wishlist/:id', async (req, res) => {
  let { id } = req.params;
  const userId = req.user._id;
  let deletedWishlist = await Wishlist.deleteOne({listing: id, user: userId});
  req.flash("success", "removed from wishlist.");
  res.redirect(`/profile/${userId}`);
})

module.exports = router;
