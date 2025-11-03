require("dotenv").config();
// const axios = require("axios");

const Listing = require("../models/listing.js");
const Wishlist = require("../models/wishlist.js");

module.exports.index = async (req, res) => {
  const allListings = await Listing.find().populate({ path: 'reviews', select: 'rating' });
  const listingsNormalized = allListings.map(l => {
    const obj = l.toObject();
    if (!obj.images || obj.images.length === 0) {
      if (obj.image) obj.images = [obj.image]; else obj.images = [];
    }
    const ratings = Array.isArray(obj.reviews) ? obj.reviews.map(r => Number(r.rating) || 0) : [];
    const reviewCount = ratings.length;
    const avgRating = reviewCount ? (ratings.reduce((a,b)=>a+b,0) / reviewCount) : 0;
    obj.avgRating = Number(avgRating.toFixed(1));
    obj.reviewCount = reviewCount;
    return obj;
  });

  let wishlistIds = [];
  if (req.user) {
    const items = await Wishlist.find({ user: req.user._id }).select("listing");
    wishlistIds = items.map(i => String(i.listing));
  }
  res.render("listings/index", { allListings: listingsNormalized, wishlistIds });
}

module.exports.allListing = async (req, res) => {
  const {
    q = "",
    location = "",
    minPrice = "",
    maxPrice = "",
    sort = "",
    page = 1,
    limit = 12,
  } = req.query;

  // Build filter
  const filter = {};

  if (q) {
    const rx = new RegExp(q, "i");
    filter.$or = [
      { title: rx },
      { location: rx },
      { country: rx },
    ];
  }

  if (location) {
    filter.$or = (filter.$or || []).concat([{ location: new RegExp(location, "i") }]);
  }

  const priceFilter = {};
  if (minPrice !== "") priceFilter.$gte = Number(minPrice);
  if (maxPrice !== "") priceFilter.$lte = Number(maxPrice);
  if (Object.keys(priceFilter).length) filter.price = priceFilter;

  // Sorting
  let sortSpec = {};
  switch (sort) {
    case "price_asc":
      sortSpec = { price: 1 };
      break;
    case "price_desc":
      sortSpec = { price: -1 };
      break;
    case "new":
      sortSpec = { createdAt: -1 };
      break;
    case "az":
      sortSpec = { title: 1 };
      break;
    case "za":
      sortSpec = { title: -1 };
      break;
    default:
      sortSpec = { createdAt: -1 };
  }

  const pageNum = Math.max(parseInt(page) || 1, 1);
  const perPage = Math.max(parseInt(limit) || 12, 1);
  const skip = (pageNum - 1) * perPage;

  const totalCount = await Listing.countDocuments(filter);
  const allListingsRaw = await Listing.find(filter)
    .sort(sortSpec)
    .skip(skip)
    .limit(perPage)
    .populate({ path: 'reviews', select: 'rating' });
  const allListings = allListingsRaw.map(l => {
    const obj = l.toObject();
    if (!obj.images || obj.images.length === 0) {
      if (obj.image) obj.images = [obj.image]; else obj.images = [];
    }
    const ratings = Array.isArray(obj.reviews) ? obj.reviews.map(r => Number(r.rating) || 0) : [];
    const reviewCount = ratings.length;
    const avgRating = reviewCount ? (ratings.reduce((a,b)=>a+b,0) / reviewCount) : 0;
    obj.avgRating = Number(avgRating.toFixed(1));
    obj.reviewCount = reviewCount;
    return obj;
  });

  const totalPages = Math.max(Math.ceil(totalCount / perPage), 1);

  res.render("listings/listings", {
    allListings,
    page: pageNum,
    totalPages,
    totalCount,
    limit: perPage,
    q,
    location,
    minPrice,
    maxPrice,
    sort,
    wishlistIds: req.user ? (await Wishlist.find({ user: req.user._id }).select("listing")).map(i => String(i.listing)) : [],
  });
}

module.exports.renderNewForm = (req, res) => {
  res.render("listings/new");
}

module.exports.createNewListing = async (req, res) => {
    const address = req.body.listing.location;
    // Google Geocoding API
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`)
    const data = await response.json();
    const { lat, lng } = data.results[0].geometry.location;    // console.log(data);

  const newListing = new Listing(req.body.listing);
  newListing.owner = req.user._id;
  // handle up to 3 images
  if (req.files && req.files.length) {
    newListing.images = req.files.slice(0, 3).map(f => ({ url: f.path, filename: f.filename }));
  }

  newListing.geometry.type = "Point";
  newListing.geometry.coordinates = [lng, lat]; 

  let savedListing = await newListing.save();
  console.log(savedListing);
  req.flash("success", "New Listing Created.");
  res.redirect("/listings");
}

module.exports.showListing = async (req, res) => {
    const { id } = req.params;
    const listingDoc = await Listing.findById(id).populate({path:"reviews",populate: { path:"author"}}).populate("owner");
    let listing = listingDoc ? listingDoc.toObject() : null;
    if (!listing) {
      req.flash("error", "Listing Does not Exist");
      return res.redirect("/listings")
    }
    if (!listing.images || listing.images.length === 0) {
      if (listing.image) listing.images = [listing.image]; else listing.images = [];
    }
    // Determine if current user has already reviewed
    let hasUserReviewed = false;
    if (req.user && Array.isArray(listing.reviews)) {
      hasUserReviewed = listing.reviews.some(r => r.author && String(r.author._id) === String(req.user._id));
    }

    // Compute average rating
    const ratings = Array.isArray(listing.reviews) ? listing.reviews.map(r => Number(r.rating) || 0) : [];
    const reviewCount = ratings.length;
    const avgRating = reviewCount ? (ratings.reduce((a,b)=>a+b,0) / reviewCount) : 0;
    listing.avgRating = Number(avgRating.toFixed(1));
    listing.reviewCount = reviewCount;

    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    let isWishlisted = false;
    if (req.user) {
      const existing = await Wishlist.findOne({ user: req.user._id, listing: id });
      isWishlisted = !!existing;
    }
    res.render("listings/show", { listing, GOOGLE_MAPS_API_KEY, hasUserReviewed, isWishlisted });
}

module.exports.renderEditForm = async (req, res) => {
  const { id } = req.params;
  const listing = await Listing.findById(id);
  if (!listing) {
    req.flash("error", "Listing Does not Exist");
    return res.redirect("/listings")
  }

  let originalImageUrl = (listing.images && listing.images[0] && listing.images[0].url) ? listing.images[0].url : "";
  if (originalImageUrl) {
    originalImageUrl = originalImageUrl.replace("/upload", "/upload/h_70,w_110");
  }
  res.render("listings/edit", { listing, originalImageUrl });
}

module.exports.updateListing = async (req, res) => {
  const { id } = req.params;

  try {
    // Update the listing and return the updated document
    let listing = await Listing.findByIdAndUpdate(id, { ...req.body.listing }, { new: true });

    const address = listing.location;
    // Google Geocoding API
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`);
    const data = await response.json();

    if (data.results.length > 0) {
      const { lat, lng } = data.results[0].geometry.location;
      listing.geometry.type = "Point";
      listing.geometry.coordinates = [lng, lat];
    }

    if (req.files && req.files.length) {
      // replace with new set (max 3)
      listing.images = req.files.slice(0, 3).map(f => ({ url: f.path, filename: f.filename }));
    }

    await listing.save();

    req.flash("success", "Listing Updated.");
    res.redirect(`/listings/${id}`);
  } catch (error) {
    console.error(error);
    req.flash("error", "Something went wrong while updating the listing.");
    res.redirect(`/listings/${id}`);
  }
};

module.exports.destroyListing = async (req, res) => {
    const { id } = req.params;
    await Listing.findByIdAndDelete(id);
    req.flash("success", "Listing Deleted.");
    res.redirect("/listings");
}