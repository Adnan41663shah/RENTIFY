
document.addEventListener('DOMContentLoaded', function () {
  const wishlistIcons = document.querySelectorAll('.wishlist-icon');

  wishlistIcons.forEach(icon => {
    icon.addEventListener('click', function (event) {
      event.stopPropagation();
      event.preventDefault();

      const listingId = this.getAttribute('data-listing-id');

      fetch('/wishlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ listingId: listingId })
      })
        .then(response => response.json().then(data => ({ status: response.status, body: data })))
        .then(({ status, body }) => {
          if (status === 200 && body && body.success) {
            if (body.added) {
              this.classList.add('red-heart');
              Toastify({
                text: body.message || 'Added to wishlist',
                duration: 2500,
                gravity: "top",
                position: "right",
                style: { background: "#4CAF50", borderRadius: "1rem" }
              }).showToast();
            } else {
              this.classList.remove('red-heart');
              Toastify({
                text: body.message || 'Removed from wishlist',
                duration: 2500,
                gravity: "top",
                position: "right",
                style: { background: "#FF9800", borderRadius: "1rem" }
              }).showToast();
            }
          } else if (status === 401) {
            Toastify({
              text: body.message || "Please login to add to wishlist",
              duration: 3000,
              gravity: "top",
              position: "right",
              style: {
                background: "#ff4f4fff",
                borderRadius: "1rem"
              }
            }).showToast();
            setTimeout(() => {
              window.location.href = '/login';
            }, 1500);
          } else {
            Toastify({
              text: body.message || "Something went wrong",
              duration: 3000,
              gravity: "top",
              position: "right",
              style: {
                background: "#ff0000ff",
                borderRadius: "1rem"
              }
            }).showToast();
          }
        })
        .catch(error => {
          console.error('Error:', error);
          Toastify({
            text: 'Network error occurred',
            duration: 3000,
            gravity: "top",
            position: "right",
            style: {
              background: "#FF0000",
                borderRadius: "1rem"
            }
          }).showToast();
        });
    });
  });
});
