const express = require("express");
const router = express.Router();
const User = require("../models/user.js")
const Listing = require("../models/listing.js");
const Booking = require("../models/booking.js");
const Notification = require("../models/notification.js");
const { isLoggedin } = require("../middleware.js");

router.get('/:id/myListings', async (req, res) => {
  let { id } = req.params;
  const docs = await Listing.find({owner: id});
  const listings = docs.map(doc => {
    const o = doc.toObject();
    const img0 = (o.images && o.images.length) ? o.images[0] : null;
    const img0Url = img0 ? (typeof img0 === 'string' ? img0 : (img0.url || img0.secure_url || img0.path)) : null;
    const single = o.image || null;
    const singleUrl = single ? (typeof single === 'string' ? single : (single.url || single.secure_url || single.path)) : null;
    return { ...o, displayUrl: img0Url || singleUrl || null };
  });
  res.render('partials/myListings', {listings});
});

router.get('/:id/myBookings', async (req, res) => {
  try {
    const { id } = req.params;

    // Partition bookings into upcoming (including ongoing) and past by checkOut
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [upcomingBookingsRaw, pastBookingsRaw] = await Promise.all([
      Booking.find({ user: id, checkOut: { $gte: today } }),
      Booking.find({ user: id, checkOut: { $lt: today } })
    ]);

    // Fetch listings once for all involved listing IDs
    const listingIds = Array.from(new Set([
      ...upcomingBookingsRaw.map(b => String(b.listing)),
      ...pastBookingsRaw.map(b => String(b.listing)),
    ]));
    const listingDocs = await Listing.find({ _id: { $in: listingIds } });

    function mergeWithListing(booking) {
      const listing = listingDocs.find(l => String(l._id) === String(booking.listing));
      const o = listing ? listing.toObject() : {};
      const img0 = (o.images && o.images.length) ? o.images[0] : null;
      const img0Url = img0 ? (typeof img0 === 'string' ? img0 : (img0.url || img0.secure_url || img0.path)) : null;
      const single = o.image || null;
      const singleUrl = single ? (typeof single === 'string' ? single : (single.url || single.secure_url || single.path)) : null;
      const displayUrl = img0Url || singleUrl || null;
      return { ...o, displayUrl, booking: booking.toObject() };
    }

    const upcoming = upcomingBookingsRaw.map(mergeWithListing);
    const past = pastBookingsRaw.map(mergeWithListing);

    // Render with both lists
    res.render('partials/myBookings', { upcoming, past });

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// Notifications panel
router.get('/:id/notifications', async (req, res) => {
  try {
    const { id } = req.params;
    const notifications = await Notification.find({ recipient: id })
      .populate('listing')
      .populate('booking')
      .sort({ createdAt: -1 });
    res.render('partials/notifications', { notifications });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// Delete a notification
router.post('/:id/notifications/:notificationId/delete', isLoggedin, async (req, res) => {
  try {
    const { id, notificationId } = req.params;
    const n = await Notification.findById(notificationId);
    if (!n) {
      return res.status(404).send("Notification not found");
    }
    // Ensure the logged-in user owns this notification
    if (!req.user || String(n.recipient) !== String(req.user._id) || String(id) !== String(req.user._id)) {
      return res.status(403).send("Not authorized");
    }
    await Notification.deleteOne({ _id: notificationId });
    // Redirect back to profile with notifications tab
    return res.redirect(`/profile/${req.user._id}?tab=notifications`);
  } catch (err) {
    console.error(err);
    return res.status(500).send("Server error");
  }
});

module.exports = router;