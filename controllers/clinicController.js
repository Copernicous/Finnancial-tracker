const { Clinic } = require('../models');
const { Op } = require('sequelize');

// GET /api/clinics
exports.getAll = async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const where = includeInactive ? {} : { isActive: true };
    const clinics = await Clinic.findAll({ where, order: [['name', 'ASC']] });
    res.json(clinics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/clinics/:id
exports.getOne = async (req, res) => {
  try {
    const clinic = await Clinic.findByPk(req.params.id);
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    res.json(clinic);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/clinics
exports.create = async (req, res) => {
  try {
    const { name, address, phone, contactPerson, notes, isActive } = req.body;
    if (!name) return res.status(400).json({ error: 'Clinic name is required.' });
    const existing = await Clinic.findOne({ where: { name: { [Op.iLike]: name.trim() } } });
    if (existing) return res.status(409).json({ error: `A clinic named "${name}" already exists.` });
    const clinic = await Clinic.create({ name: name.trim(), address, phone, contactPerson, notes, isActive: isActive !== false });
    res.status(201).json(clinic);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/clinics/:id
exports.update = async (req, res) => {
  try {
    const clinic = await Clinic.findByPk(req.params.id);
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const { name, address, phone, contactPerson, notes, isActive } = req.body;
    if (name && name.trim() !== clinic.name) {
      const existing = await Clinic.findOne({ where: { name: { [Op.iLike]: name.trim() }, id: { [Op.ne]: clinic.id } } });
      if (existing) return res.status(409).json({ error: `A clinic named "${name}" already exists.` });
    }
    await clinic.update({ name: name?.trim() || clinic.name, address, phone, contactPerson, notes, isActive });
    res.json(clinic);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/clinics/:id — soft disable (history preserved)
exports.delete = async (req, res) => {
  try {
    const clinic = await Clinic.findByPk(req.params.id);
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    // Check if any patients are assigned to this clinic
    const { Patient } = require('../models');
    const patientCount = await Patient.count({ where: { clinicId: clinic.id } });
    await clinic.update({ isActive: false });
    const msg = patientCount > 0
      ? `Clinic disabled. ${patientCount} patient(s) still reference it — history preserved.`
      : 'Clinic disabled.';
    res.status(200).json({ message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/clinics/:id/restore — re-enable
exports.restore = async (req, res) => {
  try {
    const clinic = await Clinic.findByPk(req.params.id);
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    await clinic.update({ isActive: true });
    res.status(200).json({ message: 'Clinic restored.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
