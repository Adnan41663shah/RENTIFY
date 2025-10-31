function initCancelHandlers(){
  const container = document;
  container.addEventListener("click", async (e) => {
    const btn = e.target.closest(".cancel-booking-btn");
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();
    console.debug("Cancel click captured");

    const bookingId = btn.getAttribute("data-booking-id");
    if (!bookingId) return;

    if (!confirm("Are you sure you want to cancel this booking?")) return;

    btn.disabled = true;
    btn.dataset.prevText = btn.innerText;
    btn.innerText = "Cancelling...";

    try {
      const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        credentials: "same-origin",
      });

      if (res.status === 401) {
        // Not logged in -> redirect to login
        window.location.href = "/login";
        return;
      }

      let data = null;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON (e.g., HTML) */ }

      if (!res.ok || !(data && data.success)) {
        const msg = (data && (data.error || data.message)) || (text && text.slice(0,200)) || "Failed to cancel booking";
        throw new Error(msg);
      }
      // Refresh to update status and buttons
      window.location.reload();
    } catch (err) {
      console.error("Cancel booking error:", err);
      alert("Error: " + err.message);
      btn.disabled = false;
      btn.innerText = btn.dataset.prevText || "Cancel booking";
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCancelHandlers);
} else {
  initCancelHandlers();
}
