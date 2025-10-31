document.addEventListener("DOMContentLoaded", () => {
  const todayISO = new Date().toISOString().split("T")[0];
  const checkInEl = document.getElementById("checkIn");
  const checkOutEl = document.getElementById("checkOut");
  checkInEl.setAttribute("min", todayISO);
  checkOutEl.setAttribute("min", todayISO);

  const pricePerNight = parseInt(document.getElementById("pricePerNight").innerText);
  const nightsCountEl = document.getElementById("nightsCount");
  const subTotalEl = document.getElementById("subTotal");
  const gstAmountEl = document.getElementById("gstAmount");
  const grandTotalEl = document.getElementById("grandTotal");

  const blockedRanges = [];
  let fpIn = null;
  let fpOut = null;

  function parseISO(dateStr){
    const d = new Date(dateStr);
    // normalize to midnight local
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function isOverlap(aStart, aEnd, bStart, bEnd){
    // a overlaps b if aStart < bEnd and aEnd > bStart
    return aStart < bEnd && aEnd > bStart;
  }

  function selectionOverlapsBlocked(checkInVal, checkOutVal){
    if(!checkInVal || !checkOutVal) return false;
    const s = parseISO(checkInVal);
    const e = parseISO(checkOutVal);
    for(const r of blockedRanges){
      const rs = parseISO(r.start);
      const re = parseISO(r.end);
      if(isOverlap(s, e, rs, re)) return true;
    }
    return false;
  }

  function calculateTotal() {
    const checkInVal = checkInEl.value;
    const checkOutVal = checkOutEl.value;

    const checkInDate = new Date(checkInVal);
    const checkOutDate = new Date(checkOutVal);

    if (checkInVal && checkOutVal && checkOutDate > checkInDate) {
      if (selectionOverlapsBlocked(checkInVal, checkOutVal)) {
        alert("Selected dates overlap with an existing booking. Please choose different dates.");
        return;
      }
      const diffTime = checkOutDate - checkInDate;
      const nights = diffTime / (1000 * 60 * 60 * 24);

      const subTotal = nights * pricePerNight;
      const gst = subTotal * 0.18;
      const grandTotal = subTotal + gst;

      nightsCountEl.innerText = nights;
      subTotalEl.innerText = subTotal.toFixed(2);
      gstAmountEl.innerText = gst.toFixed(2);
      grandTotalEl.innerText = grandTotal.toFixed(2);
    }
  }

  checkInEl.addEventListener("change", calculateTotal);
  checkOutEl.addEventListener("change", calculateTotal);

  // Fetch blocked dates for this listing
  const listingId = document.getElementById("listingId").value;
  fetch(`/api/bookings/listing/${listingId}/blocked-dates`)
    .then(r => r.json())
    .then(data => {
      if (data && Array.isArray(data.ranges)) {
        // Convert to Flatpickr disable ranges (inclusive)
        const disable = data.ranges.map(r => {
          const start = new Date(r.start);
          const end = new Date(r.end);
          // make end inclusive by subtracting 1 day (server sends exclusive end)
          end.setDate(end.getDate() - 1);
          const toISO = d => d.toISOString().split("T")[0];
          return { from: toISO(start), to: toISO(end) };
        });
        blockedRanges.splice(0, blockedRanges.length, ...disable);
      }

      // Initialize Flatpickr after we have blocked ranges
      if (window.flatpickr) {
        fpIn = flatpickr(checkInEl, {
          dateFormat: "Y-m-d",
          minDate: "today",
          disable: blockedRanges,
          onChange: function(selectedDates) {
            if (selectedDates && selectedDates[0]) {
              const nextDay = new Date(selectedDates[0]);
              nextDay.setDate(nextDay.getDate() + 1);
              if (fpOut) fpOut.set("minDate", nextDay);
            }
            calculateTotal();
          },
        });

        fpOut = flatpickr(checkOutEl, {
          dateFormat: "Y-m-d",
          minDate: "today",
          disable: blockedRanges,
          onChange: function() { calculateTotal(); },
        });
      }
    })
    .catch(() => {/* non-fatal */});
});

document.getElementById("bookingForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currUser) {
    alert("❌ Please login to book this listing.");
    window.location.href = "/login";
    return;
  }

  const checkInVal = document.getElementById("checkIn").value;
  const checkOutVal = document.getElementById("checkOut").value;
  const guests = document.getElementById("guests").value;

  const checkInDate = new Date(checkInVal);
  const checkOutDate = new Date(checkOutVal);

  if (isNaN(checkInDate) || isNaN(checkOutDate)) {
    alert("❌ Please select both Check-In and Check-Out dates.");
    return;
  }
  if (checkOutDate <= checkInDate) {
    alert("❌ Check-Out date must be after Check-In date.");
    return;
  }

  // Prevent overlapping bookings client-side (server also validates)
  const listingId = document.getElementById("listingId").value;
  try {
    const resp = await fetch(`/api/bookings/listing/${listingId}/blocked-dates`);
    const data = await resp.json();
    if (data && Array.isArray(data.ranges)) {
      const s = new Date(checkInVal);
      const e = new Date(checkOutVal);
      const overlaps = data.ranges.some(r => {
        const rs = new Date(r.start);
        const re = new Date(r.end);
        return (s < re) && (e > rs);
      });
      if (overlaps) {
        alert("❌ Selected dates are no longer available. Please choose different dates.");
        return;
      }
    }
  } catch (_) { /* ignore; server-side still validates */ }

  // Calculate nights & amount with GST
  const nights = (checkOutDate - checkInDate) / (1000 * 60 * 60 * 24);
  const pricePerNight = parseInt(document.getElementById("pricePerNight").innerText);
  const subTotal = nights * pricePerNight;
  const gst = subTotal * 0.18;
  const grandTotal = subTotal + gst;

  const bookingData = {
    listing: document.getElementById("listingId").value,
    user: currUser,
    checkIn: checkInVal,
    checkOut: checkOutVal,
    guests: guests
  };

  // --- 1. Create order from backend ---
  const res = await fetch("/api/bookings/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: grandTotal }) // pass total with GST
  });

  if (!res.ok) {
    alert("❌ Failed to create payment order. Please try again.");
    return;
  }

  const order = await res.json();

  // --- 2. Open Razorpay Checkout ---
  const options = {
    key: razorpay_key_id,
    amount: order.amount,
    currency: order.currency,
    name: "StayEase Booking",
    description: "Booking Payment",
    order_id: order.id,
    handler: async function (response) {
      const verifyRes = await fetch("/api/bookings/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...response,
          booking: bookingData
        })
      });

      const result = await verifyRes.json();
      if (result.success) {
        alert("✅ Booking Confirmed!");
        window.location.reload();
      } else {
        alert("❌ Payment Failed: " + result.error);
      }
    },
    theme: { color: "#000000" }
  };

  const rzp = new Razorpay(options);
  rzp.open();
});