const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const Booking = require("../models/booking.js");
const Listing = require("../models/listing.js");
const User = require("../models/user.js");
const Notification = require("../models/notification.js");
const { isLoggedin } = require("../middleware.js");

const router = express.Router();

const GST_RATE = 0.18; // 18%

// ---- Razorpay client ----
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ---- Remove a cancelled booking (do not delete the listing) ----
router.post("/:bookingId/remove", isLoggedin, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }
    if (!req.user || String(booking.user) !== String(req.user._id)) {
      return res.status(403).json({ error: "Not authorized to remove this booking" });
    }

    // Only allow removal if already cancelled (as per requirement)
    if (booking.status !== "Cancelled") {
      return res.status(400).json({ error: "Booking must be cancelled before removal" });
    }

    // Try to remove receipt file if exists
    const receiptsDir = ensureReceiptsDir();
    const receiptFilename = `receipt_${bookingId}.pdf`;
    const receiptAbsPath = path.join(receiptsDir, receiptFilename);
    if (fs.existsSync(receiptAbsPath)) {
      try { fs.unlinkSync(receiptAbsPath); } catch (_) { /* ignore */ }
    }

    // Delete only the booking (keep the listing intact)
    await Booking.deleteOne({ _id: bookingId });

    const accepts = req.headers.accept || "";
    if (accepts.includes("text/html")) {
      return res.redirect(`/profile/${req.user._id}`);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Remove booking error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Helpers ----
function diffNights(checkInISO, checkOutISO) {
  const start = new Date(checkInISO);
  const end = new Date(checkOutISO);
  // normalize to midnight to avoid DST/timezone drift
  const startUTC = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUTC = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  const msPerDay = 1000 * 60 * 60 * 24;
  const nights = Math.max(1, Math.round((endUTC - startUTC) / msPerDay));
  return nights;
}

function ensureReceiptsDir() {
  const receiptsDir = path.join(__dirname, "..", "receipts");
  if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
  }
  return receiptsDir;
}

function money(n) {
  return Math.round(Number(n)); // round to nearest paise-less rupee because you charge in INR rupees
}

function formatDate(d) {
  const date = new Date(d);
  return date.toISOString().split("T")[0];
}

// ---- Create Razorpay Order ----
// (kept compatible with your existing frontend; it still accepts { amount } in INR)
router.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body; // amount in INR (from client)
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const order = await razorpay.orders.create({
      amount: money(amount) * 100, // convert to paise
      currency: "INR",
      payment_capture: 1,
    });

    res.json(order);
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Get blocked dates for a listing (confirmed bookings only) ----
router.get("/listing/:listingId/blocked-dates", async (req, res) => {
  try {
    const { listingId } = req.params;
    const today = new Date();
    today.setHours(0,0,0,0);
    const bookings = await Booking.find({
      listing: listingId,
      status: "Confirmed",
      // only return ranges that end after today (i.e., still relevant)
      checkOut: { $gt: today },
    }, {
      checkIn: 1,
      checkOut: 1,
      _id: 0,
    });

    // Return date ranges as ISO strings (inclusive of checkIn to exclusive of checkOut)
    const ranges = bookings.map(b => ({
      start: new Date(b.checkIn).toISOString().split("T")[0],
      end: new Date(b.checkOut).toISOString().split("T")[0],
    }));
    return res.json({ ranges });
  } catch (err) {
    console.error("Blocked dates error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Cancel a booking ----
router.post("/:bookingId/cancel", isLoggedin, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }
    if (!req.user || String(booking.user) !== String(req.user._id)) {
      return res.status(403).json({ error: "Not authorized to cancel this booking" });
    }
    if (booking.status === "Cancelled") {
      return res.json({ success: true, status: booking.status });
    }
    booking.status = "Cancelled";
    await booking.save();

    // Notify listing owner about the cancellation
    try {
      const listing = await Listing.findById(booking.listing).populate('owner');
      const user = await User.findById(booking.user);
      if (listing && listing.owner) {
        const ownerId = listing.owner._id ? listing.owner._id : listing.owner;
        await Notification.create({
          recipient: ownerId,
          type: "booking_cancelled",
          message: `${user?.username || user?.email || "A user"} cancelled a booking for: ${listing.title}`,
          listing: listing._id,
          booking: booking._id,
        });
      }
    } catch (e) {
      console.error("Notification create (booking_cancelled) error:", e);
    }

    // If this was an HTML form submission, redirect back to My Bookings
    const accepts = req.headers.accept || "";
    if (accepts.includes("text/html")) {
      return res.redirect(`/profile/${req.user._id}`);
    }

    // Otherwise, respond with JSON for API clients
    return res.json({ success: true, status: booking.status });
  } catch (err) {
    console.error("Cancel booking error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Verify Payment, Save Booking, Generate Receipt ----
router.post("/verify", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      booking, // { listing, user, checkIn, checkOut, guests }
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !booking) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Signature verification
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.json({ success: false, error: "Invalid signature" });
    }

    // Fetch listing & user for titles/names and price
    const [listingDoc, userDoc] = await Promise.all([
      Listing.findById(booking.listing),
      User.findById(booking.user),
    ]);

    if (!listingDoc) {
      return res.status(404).json({ error: "Listing not found" });
    }
    if (!userDoc) {
      return res.status(404).json({ error: "User not found" });
    }

    const perNight = Number(listingDoc.price) || 0;
    const nights = diffNights(booking.checkIn, booking.checkOut);

    // Prevent overlapping bookings for this listing (only against Confirmed bookings)
    const newCheckIn = new Date(booking.checkIn);
    const newCheckOut = new Date(booking.checkOut);
    const conflict = await Booking.findOne({
      listing: booking.listing,
      status: "Confirmed",
      // overlap if existing.checkIn < newCheckOut AND existing.checkOut > newCheckIn
      checkIn: { $lt: newCheckOut },
      checkOut: { $gt: newCheckIn },
    });
    if (conflict) {
      return res.status(409).json({ success: false, error: "Selected dates are no longer available. Please choose different dates." });
    }

    const subtotal = perNight * nights;
    const gstAmount = Math.round(subtotal * GST_RATE);
    const grandTotal = subtotal + gstAmount;

    // Save booking
    const newBooking = new Booking({
      listing: booking.listing,
      user: booking.user,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      guests: booking.guests,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      status: "Confirmed",
      // (not adding pricing fields to DB to avoid schema change)
    });
    await newBooking.save();

    // Notify listing owner about the new booking
    try {
      if (listingDoc.owner) {
        const ownerId = listingDoc.owner._id ? listingDoc.owner._id : listingDoc.owner;
        await Notification.create({
          recipient: ownerId,
          type: "booking_created",
          message: `${userDoc.username || userDoc.email || "A user"} booked your property: ${listingDoc.title}`,
          listing: listingDoc._id,
          booking: newBooking._id,
        });
      }
    } catch (e) {
      console.error("Notification create (booking_created) error:", e);
    }

    // Generate PDF receipt
    const receiptsDir = ensureReceiptsDir();
    const receiptFilename = `receipt_${newBooking._id}.pdf`;
    const receiptAbsPath = path.join(receiptsDir, receiptFilename);
    const receiptPublicUrl = `/receipts/${receiptFilename}`;

    const doc = new PDFDocument({ margin: 50 });
    const writeStream = fs.createWriteStream(receiptAbsPath);
    doc.pipe(writeStream);

    // Header
    doc
      .fontSize(20)
      .text("Booking Receipt", { align: "center" })
      .moveDown(0.5);

    doc
      .fontSize(10)
      .text(`Date: ${formatDate(new Date())}`, { align: "right" })
      .moveDown();

    // Business / Brand
    doc
      .fontSize(14)
      .text("StayEase", { continued: true })
      .fontSize(10)
      .text("  •  support@stayease.example  •  +91-95292-57473");

    doc.moveDown();

    // User & Booking info
    doc
      .fontSize(12)
      .text(`Booking ID: ${newBooking._id}`)
      .text(`Order ID:   ${razorpay_order_id}`)
      .text(`Payment ID: ${razorpay_payment_id}`)
      .moveDown();

    doc
      .fontSize(12)
      .text(`Guest Name: ${userDoc.username || userDoc.name || userDoc.email || "User"}`)
      .text(`Listing:    ${listingDoc.title}`)
      .text(`Location:   ${listingDoc.location || ""}`)
      .text(`Check-In:   ${formatDate(booking.checkIn)}`)
      .text(`Check-Out:  ${formatDate(booking.checkOut)}`)
      .text(`Guests:     ${booking.guests}`)
      .moveDown();

    // Pricing table
    doc.fontSize(12).text("Pricing", { underline: true }).moveDown(0.5);

    const lineYStart = doc.y;
    const leftX = doc.page.margins.left;
    const rightX = doc.page.width - doc.page.margins.right;

    function row(label, value) {
      const y = doc.y;
      doc.text(label, leftX, y, { continued: false });
      doc.text(`₹ ${value.toLocaleString("en-IN")}`, rightX - 120, y, {
        width: 120,
        align: "right",
      });
      doc.moveDown(0.6);
    }

    row(`Price per night × ${nights} night(s)`, money(subtotal));
    row(`GST (18%)`, money(gstAmount));

    doc
      .moveTo(leftX, doc.y + 4)
      .lineTo(rightX, doc.y + 4)
      .stroke();

    doc.moveDown(0.8);
    doc.fontSize(13).text("Grand Total", leftX, doc.y, { continued: false });
    doc.fontSize(13).text(`₹ ${money(grandTotal).toLocaleString("en-IN")}`, rightX - 120, doc.y, {
      width: 120,
      align: "right",
    });

    doc.moveDown(2);
    doc
      .fontSize(10)
      .text(
        "Note: Amounts are indicative per your booking details. The final captured amount is as per your Razorpay payment.",
        { align: "left" }
      );

    doc.moveDown(1.5).fontSize(10).text("Thank you for booking with StayEase!", { align: "center" });

    doc.end();

    // Wait for file to finish writing before responding
    writeStream.on("finish", () => {
      return res.json({
        success: true,
        bookingId: newBooking._id,
        receipt: receiptPublicUrl,
        breakdown: {
          perNight: money(perNight),
          nights,
          subtotal: money(subtotal),
          gstRate: GST_RATE,
          gstAmount: money(gstAmount),
          grandTotal: money(grandTotal),
        },
      });
    });

    writeStream.on("error", (err) => {
      console.error("Receipt write error:", err);
      // Still return success for booking; omit receipt link if error
      return res.json({
        success: true,
        bookingId: newBooking._id,
        breakdown: {
          perNight: money(perNight),
          nights,
          subtotal: money(subtotal),
          gstRate: GST_RATE,
          gstAmount: money(gstAmount),
          grandTotal: money(grandTotal),
        },
      });
    });
  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// ---- Download Receipt by Booking ID ----
// Secured so only the booking owner can download their receipt
router.get("/:bookingId/receipt", isLoggedin, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (!req.user || String(booking.user) !== String(req.user._id)) {
      return res.status(403).json({ error: "Not authorized to access this receipt" });
    }

    const receiptsDir = ensureReceiptsDir();
    const receiptFilename = `receipt_${bookingId}.pdf`;
    const receiptAbsPath = path.join(receiptsDir, receiptFilename);

    if (!fs.existsSync(receiptAbsPath)) {
      return res.status(404).json({ error: "Receipt not found for this booking" });
    }

    return res.download(receiptAbsPath, receiptFilename);
  } catch (err) {
    console.error("Download receipt error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
