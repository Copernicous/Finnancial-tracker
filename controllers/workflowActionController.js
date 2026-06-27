const db = require('../models');

const Model = db.WorkflowAction;

exports.getAll = async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const where = includeInactive ? {} : { isActive: true };
        const data = await Model.findAll({ where, order: [['sequenceNumber', 'ASC']] });
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
        const data = await Model.create({ ...req.body, isActive: true });
        res.status(201).json(data);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.update = async (req, res) => {
    try {
        const [updated] = await Model.update(req.body, { where: { id: req.params.id } });
        if (!updated) return res.status(404).json({ message: 'Not found' });
        const data = await Model.findByPk(req.params.id);
        res.json(data);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// Soft-disable: set isActive = false — preserves all RXWorkflowTracking history
exports.delete = async (req, res) => {
    try {
        const record = await Model.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        // Safety: check if any active RX records are using this workflow action
        const inUse = await db.RXWorkflowTracking.count({ where: { workflowActionId: req.params.id } });
        await record.update({ isActive: false });
        const msg = inUse > 0
            ? `Workflow action disabled. It is referenced by ${inUse} completed step(s) — history is preserved.`
            : 'Workflow action disabled.';
        res.status(200).json({ message: msg });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// Restore: re-enable workflow action
exports.restore = async (req, res) => {
    try {
        const record = await Model.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        await record.update({ isActive: true });
        res.status(200).json({ message: 'Workflow action restored.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
