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

const categorySetupUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function(req, file, cb) {
        var allowed = ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream', 'application/json'];
        var original = (file.originalname || '').toLowerCase();
        var ext = original.split('.').pop();
        if (allowed.indexOf(file.mimetype) !== -1 || ['csv', 'json', 'txt'].indexOf(ext) !== -1 || original === 'categories') {
            cb(null, true);
        } else {
            cb(new Error('Only CSV or JSON category setup files are allowed. Received: ' + file.mimetype));
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
router.delete('/batches/:id/purge', rbac.requireMaster, importController.purgeBatch);
router.delete('/batches/:id', rbac.requirePermission('import', 'delete'), importController.removeBatch);
router.post('/batches/:id/post',
    rbac.requirePermission('import', 'edit'),
    rbac.requirePermission('transactions', 'add'),
    importController.postBatchRows
);

// Bank statement parser uploads. These stage rows only and never post ledger data.
router.get('/bank-statement/profiles', rbac.requirePermission('import', 'read'), importController.getBankStatementProfiles);
router.post('/bank-statement', rbac.requirePermission('import', 'write'), statementUpload.single('file'), importController.importBankStatement);

// Merchant categorization index and optional per-merchant online lookup.
router.get('/merchant-rules', rbac.requirePermission('import', 'read'), importController.getMerchantRules);
router.post('/merchant-rules', rbac.requirePermission('import', 'edit'), importController.saveMerchantRule);
router.post('/merchant-suggest', rbac.requirePermission('import', 'edit'), importController.suggestMerchantCategory);

// Category chart setup import/export updates the live category list directly.
router.get('/categories/export',
    rbac.requirePermission('categories', 'export'),
    importController.exportCategories
);
router.post('/categories/import',
    rbac.requirePermission('import', 'write'),
    rbac.requirePermission('categories', 'write'),
    categorySetupUpload.single('file'),
    importController.importCategories
);

// Import execution
router.post('/:dataset', rbac.requirePermission('import', 'write'), upload.single('file'), importController.importDataset);

module.exports = router;
