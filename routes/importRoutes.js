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

const statementUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: function(req, file, cb) {
        var ext = (file.originalname || '').toLowerCase().split('.').pop();
        if (file.mimetype === 'application/pdf' || ext === 'pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF bank statements are allowed for this importer. Received: ' + file.mimetype));
        }
    }
});

// Require authentication for all endpoints
router.use(auth);

// Template downloads
router.get('/template/:dataset', importController.getTemplate);

// Staged import history
router.get('/batches', rbac.requirePermission('import', 'read'), importController.getBatches);
router.get('/batches/:id/rows', rbac.requirePermission('import', 'read'), importController.getBatchRows);
router.put('/batches/:id/rows', rbac.requirePermission('import', 'edit'), importController.updateBatchRows);
router.post('/batches/:id/post',
    rbac.requirePermission('import', 'edit'),
    rbac.requirePermission('transactions', 'add'),
    importController.postBatchRows
);

// Bank statement parser uploads. These stage rows only and never post ledger data.
router.get('/bank-statement/profiles', rbac.requirePermission('import', 'read'), importController.getBankStatementProfiles);
router.post('/bank-statement', rbac.requirePermission('import', 'write'), statementUpload.single('file'), importController.importBankStatement);

// Import execution
router.post('/:dataset', rbac.requirePermission('import', 'write'), upload.single('file'), importController.importDataset);

module.exports = router;
