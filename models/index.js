'use strict';

const Sequelize = require('sequelize');
const process   = require('process');

// Static require — pkg can resolve this at compile time
const env    = process.env.NODE_ENV || 'development';
const config = require('../server/config.js')[env];

const db = {};

let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

// ── Static model registration ─────────────────────────────────────────────────
// pkg needs literal string paths to include files in the snapshot.
// Keep this list in sync whenever you add / remove a model file.
const modelFiles = [
  require('./RXHistory.js'),
  require('./apikey.js'),
  require('./auditlog.js'),
  require('./clinic.js'),
  require('./dailysnapshot.js'),
  require('./documentattachment.js'),
  require('./errorlog.js'),
  require('./medication.js'),
  require('./medicationcatalog.js'),
  require('./patient.js'),
  require('./patientlock.js'),
  require('./patientnote.js'),
  require('./patientservicedatecycle.js'),
  require('./patientservicedatehistory.js'),
  require('./patienttransportcompany.js'),
  require('./pharmacy.js'),
  require('./pharmacytransportcompany.js'),
  require('./role.js'),
  require('./rxrecord.js'),
  require('./rxworkflowtracking.js'),
  require('./systemsetting.js'),
  require('./user.js'),
  require('./useractivitylog.js'),
  require('./workflowaction.js'),
];

modelFiles.forEach(modelDef => {
  const model = modelDef(sequelize, Sequelize.DataTypes);
  db[model.name] = model;
});

// ── Associations ──────────────────────────────────────────────────────────────
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize  = Sequelize;

module.exports = db;
