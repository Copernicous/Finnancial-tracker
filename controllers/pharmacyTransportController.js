const db = require('../models');

const Model = db.PharmacyTransportCompany;

exports.getAll = async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const where = includeInactive ? {} : { isActive: true };
        const data = await Model.findAll({ where });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getOne = async (req, res) => {
    try {
        const data = await Model.findByPk(req.params.id);
        if (!data) return res.status(404).json({ message: 'Not found' });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.create = async (req, res) => {
    try {
        if (!req.body.companyName || !req.body.companyName.trim()) {
            return res.status(400).json({ error: 'Company Name is required.' });
        }
        const data = await Model.create({ ...req.body, isActive: true });
        res.status(201).json(data);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.update = async (req, res) => {
    try {
        if (req.body.companyName !== undefined && !req.body.companyName.trim()) {
            return res.status(400).json({ error: 'Company Name cannot be empty.' });
        }
        const [updated] = await Model.update(req.body, { where: { id: req.params.id } });
        if (!updated) return res.status(404).json({ message: 'Not found' });
        const data = await Model.findByPk(req.params.id);
        res.json(data);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// Soft-disable: set isActive = false (history preserved)
exports.delete = async (req, res) => {
    try {
        const record = await Model.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        await record.update({ isActive: false });
        res.status(200).json({ message: 'Record disabled.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// Restore: re-enable
exports.restore = async (req, res) => {
    try {
        const record = await Model.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        await record.update({ isActive: true });
        res.status(200).json({ message: 'Record restored.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
