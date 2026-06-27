const db = require('../models');
const { Op } = require('sequelize');

// GET /api/search?q=term
exports.search = async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q || q.length < 2) return res.json({ patients: [], rxRecords: [], pharmacies: [] });

        const like = { [Op.like]: `%${q}%` };

        const [patients, rxRecords, pharmacies] = await Promise.all([
            db.Patient.findAll({
                where: {
                    isDeleted: false,
                    [Op.or]: [
                        { firstName:   like },
                        { lastName:    like },
                        { patientCode: like },
                        { phone:       like }
                    ]
                },
                attributes: ['id', 'patientCode', 'firstName', 'lastName', 'dob', 'phone', 'isActive'],
                limit: 6,
                order: [['lastName', 'ASC']]
            }),
            // RX search: only search by numeric ID
            isNaN(q) ? Promise.resolve([]) : db.RXRecord.findAll({
                include: [{ model: db.Patient, attributes: ['firstName', 'lastName', 'patientCode'] }],
                where: { id: { [Op.eq]: parseInt(q) } },
                limit: 4,
                order: [['id', 'DESC']]
            }),
            db.Pharmacy.findAll({
                where: { [Op.or]: [{ name: like }, { address: like }] },
                attributes: ['id', 'name', 'address'],
                limit: 4,
                order: [['name', 'ASC']]
            })
        ]);

        res.json({ patients, rxRecords, pharmacies });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
