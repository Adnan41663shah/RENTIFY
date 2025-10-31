const Listing = require("../models/listing.js");
const Review = require("../models/review.js");

module.exports.createReview = async (req,res) => {
  // console.log(req.params.id);
  let listing = await Listing.findById(req.params.id);
  if (!listing) {
    req.flash("error", "Listing not found");
    return res.redirect("/listings");
  }

  // Block duplicate review by same user on this listing
  const existing = await Review.findOne({
    _id: { $in: listing.reviews },
    author: req.user._id,
  });
  if (existing) {
    req.flash("error", "You have already reviewed this listing.");
    return res.redirect(`/listings/${listing._id}`);
  }

  let review = new Review(req.body.review);
  review.author = req.user._id;
  listing.reviews.push(review);
  await review.save();
  await listing.save();
  req.flash("success", "Review Created");
  res.redirect(`/listings/${listing._id}`);
}

module.exports.destroyReview = async (req, res) => {
  let {id , reviewId }  = req.params;
  await Review.findByIdAndDelete(reviewId);
  await Listing.findByIdAndUpdate(id, {$pull: { reviews : reviewId}});
  req.flash("success", "Review Deleted.");
  res.redirect(`/listings/${id}`);
}