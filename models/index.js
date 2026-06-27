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
  require('./account.js'),
  require('./accountalias.js'),
  require('./accountbalancesnapshot.js'),
  require('./apikey.js'),
  require('./auditlog.js'),
  require('./budget.js'),
  require('./category.js'),
  require('./currencyrate.js'),
  require('./dailysnapshot.js'),
  require('./documentattachment.js'),
  require('./errorlog.js'),
  require('./financialgoal.js'),
  require('./financialinstitution.js'),
  require('./importbatch.js'),
  require('./importrow.js'),
  require('./investmentholding.js'),
  require('./proofdocument.js'),
  require('./recurringtransaction.js'),
  require('./reconciliation.js'),
  require('./role.js'),
  require('./systemsetting.js'),
  require('./transaction.js'),
  require('./user.js'),
  require('./useractivitylog.js'),
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
