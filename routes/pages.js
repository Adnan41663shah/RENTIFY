const express = require('express');
const router = express.Router();

// Features
router.get('/features', (req, res) => {
  res.render('pages/features');
});

// About
router.get('/about', (req, res) => {
  res.render('pages/about');
});

// Contact
router.get('/contact', (req, res) => {
  res.render('pages/contact', { errors: {}, formData: {} });
});

router.post('/contact', (req, res) => {
  const { name = '', email = '', message = '' } = req.body || {};
  const errors = {};
  const trimmed = {
    name: String(name).trim(),
    email: String(email).trim(),
    message: String(message).trim(),
  };

  if (trimmed.name.length < 2) {
    errors.name = 'Please enter a valid name (min 2 characters).';
  }
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRx.test(trimmed.email)) {
    errors.email = 'Please enter a valid email address.';
  }
  if (trimmed.message.length < 10) {
    errors.message = 'Please enter at least 10 characters.';
  }

  if (Object.keys(errors).length) {
    return res.status(400).render('pages/contact', { errors, formData: trimmed });
  }

  // In a real app, send email or store the message. For now, just flash success.
  req.flash('success', 'Thanks for reaching out! We will get back to you soon.');
  res.redirect('/contact');
});

module.exports = router;
