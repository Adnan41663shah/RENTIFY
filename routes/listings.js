const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync.js");
const ListingController = require("../controllers/listings.js");
const { validateListing, isLoggedin, isOwner} = require("../middleware.js");
const {storage} = require("../cloudConfig.js")
const multer  = require('multer');
const upload = multer({ storage });

router.route("/")
  // All Listings
  .get(wrapAsync(ListingController.index))
  // Create Listing
  .post(
    isLoggedin,
    upload.array("listing[images]", 3),
    validateListing, 
    wrapAsync(ListingController.createNewListing)
  )

router.get("/allListing", (ListingController.allListing))
// New Form
router.get("/new", isLoggedin, (ListingController.renderNewForm));



router.route("/:id")
  // Show Listing
  .get(wrapAsync(ListingController.showListing))
  // Update Listing
  .put(isLoggedin, isOwner, upload.array("listing[images]", 3), validateListing, wrapAsync(ListingController.updateListing))
  // Delete Listing
  .delete( isLoggedin, isOwner, wrapAsync(ListingController.destroyListing))

// Edit Form
router.get("/:id/edit", isLoggedin, isOwner, wrapAsync(ListingController.renderEditForm));

module.exports = router;