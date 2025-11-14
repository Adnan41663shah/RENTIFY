// Example starter JavaScript for disabling form submissions if there are invalid fields
(() => {
  'use strict'

  // Fetch all the forms we want to apply custom Bootstrap validation styles to
  const forms = document.querySelectorAll('.needs-validation')

  // Loop over them and prevent submission
  Array.from(forms).forEach(form => {
    form.addEventListener('submit', event => {
      if (!form.checkValidity()) {
        event.preventDefault()
        event.stopPropagation()
      }

      form.classList.add('was-validated')
    }, false)
  })
})()

// display after tax switch functionality (only if present)
const taxSwitch = document.getElementById("switchCheckDefault");
if (taxSwitch) {
  taxSwitch.addEventListener("click", () => {
    const taxInfo = document.getElementsByClassName("tax-info");
    for (const info of taxInfo) {
      if (info.style.display !== "inline") {
        info.style.display = "inline";
      } else {
        info.style.display = "none";
      }
    }
  });
}

// Premium Button Interactive States
(function() {
  const premiumButtons = document.querySelectorAll('.premium-button');
  
  premiumButtons.forEach(button => {
    const wrapper = button.closest('.premium-button-wrapper');
    if (!wrapper) return;
    
    const activeOverlay = wrapper.querySelector('[data-active-overlay]');
    const focusGlow = wrapper.querySelector('[data-focus-glow]');
    
    // Mouse down - show active overlay
    button.addEventListener('mousedown', (e) => {
      if (activeOverlay) {
        activeOverlay.style.opacity = "1";
      }
    });
    
    // Mouse up - hide active overlay
    button.addEventListener('mouseup', (e) => {
      if (activeOverlay) {
        activeOverlay.style.opacity = "0";
      }
    });
    
    // Mouse leave - hide active overlay
    button.addEventListener('mouseleave', (e) => {
      if (activeOverlay) {
        activeOverlay.style.opacity = "0";
      }
    });
    
    // Focus - show focus glow (only for keyboard navigation)
    button.addEventListener('focus', (e) => {
      if (focusGlow) {
        // Check if focus was from keyboard (focus-visible)
        setTimeout(() => {
          if (e.target.matches(':focus-visible')) {
            focusGlow.style.opacity = "1";
          }
        }, 0);
      }
    });
    
    // Focus visible - show focus glow
    button.addEventListener('focusin', (e) => {
      if (focusGlow && e.target.matches(':focus-visible')) {
        focusGlow.style.opacity = "1";
      }
    });
    
    // Blur - hide focus glow
    button.addEventListener('blur', (e) => {
      if (focusGlow) {
        focusGlow.style.opacity = "0";
      }
    });
  });
})();

