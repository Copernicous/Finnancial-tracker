const db = require('../models');

// Helper: get patient_notes permission for a user
function getNotesPerm(user) {
    if (!user) return { canAdd: false, canEdit: false, canDelete: false };
    // Administrators and Supervisors always have full note access
    if (user.role === 'Administrator' || user.role === 'Supervisor') {
        return { canAdd: true, canEdit: true, canDelete: true };
    }
    // Check stored granular permissions
    const perms = user.permissions || {};
    const np = perms.patient_notes || {};
    return {
        canAdd:    np.canAdd    !== undefined ? !!np.canAdd    : !!np.canEdit, // fallback for old data
        canEdit:   np.canEdit   !== undefined ? !!np.canEdit   : false,
        canDelete: np.canDelete !== undefined ? !!np.canDelete : false
    };
}

// GET /api/patients/:id/notes — list all notes for a patient
exports.getNotes = async (req, res) => {
    try {
        const notes = await db.PatientNote.findAll({
            where: { patientId: req.params.id },
            include: [{ model: db.User, as: 'Author', attributes: ['id', 'firstName', 'lastName', 'username'] }],
            order: [['createdAt', 'DESC']]
        });
        res.json(notes);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/patients/:id/notes — add a note
exports.addNote = async (req, res) => {
    try {
        const { note } = req.body;
        if (!note || !note.trim()) {
            return res.status(400).json({ error: 'Note text is required.' });
        }

        // Permission check: canAdd on patient_notes (rbac middleware already checked, but defense-in-depth)
        const np = getNotesPerm(req.user);
        if (!np.canAdd) {
            return res.status(403).json({ error: 'You do not have permission to add patient notes.' });
        }

        const patient = await db.Patient.findByPk(req.params.id);
        if (!patient) return res.status(404).json({ error: 'Patient not found.' });

        const newNote = await db.PatientNote.create({
            patientId: req.params.id,
            userId: req.user ? req.user.id : null,
            note: note.trim()
        });
        // Return with author info
        const full = await db.PatientNote.findByPk(newNote.id, {
            include: [{ model: db.User, as: 'Author', attributes: ['id', 'firstName', 'lastName', 'username'] }]
        });
        res.status(201).json(full);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// DELETE /api/patients/:id/notes/:noteId — delete a note
exports.deleteNote = async (req, res) => {
    try {
        const note = await db.PatientNote.findOne({
            where: { id: req.params.noteId, patientId: req.params.id }
        });
        if (!note) return res.status(404).json({ error: 'Note not found.' });

        const np = getNotesPerm(req.user);

        // Strictly enforce canDelete — no author bypass
        if (!np.canDelete) {
            return res.status(403).json({
                error: 'You do not have permission to delete notes.'
            });
        }

        await note.destroy();
        res.status(204).send();
    } catch (err) { res.status(500).json({ error: err.message }); }
};
