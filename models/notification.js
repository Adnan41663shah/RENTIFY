const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, enum: ["booking_created", "booking_cancelled"], required: true },
  message: { type: String, required: true },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: "Listing" },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
  read: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model("Notification", notificationSchema);
