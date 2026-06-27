const db = require('../models');

exports.getAll = async (req, res) => {
    try {
        const where = {};
        if (req.query.activeOnly === 'true') where.isActive = true;
        const data = await db.MedicationCatalog.findAll({
            where,
            order: [['sortOrder', 'ASC'], ['name', 'ASC']]
        });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getOne = async (req, res) => {
    try {
        const data = await db.MedicationCatalog.findByPk(req.params.id);
        if (!data) return res.status(404).json({ message: 'Not found' });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.create = async (req, res) => {
    try {
        if (!req.body.name || !req.body.name.trim()) {
            return res.status(400).json({ error: 'Medication name is required.' });
        }
        const data = await db.MedicationCatalog.create({
            name:        req.body.name.trim(),
            description: req.body.description || null,
            sortOrder:   req.body.sortOrder !== undefined && req.body.sortOrder !== '' ? parseInt(req.body.sortOrder, 10) : 999,
            isActive:    req.body.isActive !== undefined ? req.body.isActive : true
        });
        res.status(201).json(data);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.update = async (req, res) => {
    try {
        const item = await db.MedicationCatalog.findByPk(req.params.id);
        if (!item) return res.status(404).json({ message: 'Not found' });
        ['name', 'description', 'isActive'].forEach(f => {
            if (req.body.hasOwnProperty(f)) item[f] = req.body[f];
        });
        if (req.body.hasOwnProperty('sortOrder') && req.body.sortOrder !== '') {
            item.sortOrder = parseInt(req.body.sortOrder, 10);
        }
        await item.save();
        res.json(item);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.delete = async (req, res) => {
    try {
        const [updated] = await db.MedicationCatalog.update(
            { isActive: false },
            { where: { id: req.params.id } }
        );
        if (!updated) return res.status(404).json({ message: 'Not found' });
        res.status(204).send();
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.restore = async (req, res) => {
    try {
        const [updated] = await db.MedicationCatalog.update(
            { isActive: true },
            { where: { id: req.params.id } }
        );
        if (!updated) return res.status(404).json({ message: 'Not found' });
        res.json({ message: 'Restored' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
