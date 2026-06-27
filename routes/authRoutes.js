'use strict';
const express        = require('express');
const router         = express.Router();
const authController = require('../controllers/authController');
const auth           = require('../middleware/auth');

// Rate limiting is applied globally in app.js (loginLimiter on /api/auth/login)
router.post('/login',   authController.login);
router.get ('/profile', auth, authController.getProfile);

module.exports = router;
