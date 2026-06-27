const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const importController = require('../controllers/importController');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function(req, file, cb) {
        var allowed = ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'];
        var ext = (file.originalname || '').toLowerCase().split('.').pop();
        if (allowed.indexOf(file.mimetype) !== -1 || ext === 'csv') {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed. Received: ' + file.mimetype));
        }
    }
});

// Require authentication for all endpoints
router.use(auth);

// Template downloads
router.get('/template/:dataset', importController.getTemplate);

// Import execution
router.post('/:dataset', rbac.requirePermission('import', 'write'), upload.single('file'), importController.importDataset);

module.exports = router;
