'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class WorkflowAction extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      WorkflowAction.hasMany(models.RXWorkflowTracking, { foreignKey: 'workflowActionId' });
    }
  }
  WorkflowAction.init({
    name: DataTypes.STRING,
    description: DataTypes.TEXT,
    sequenceNumber: DataTypes.INTEGER,
    isActive: DataTypes.BOOLEAN
  }, {
    sequelize,
    modelName: 'WorkflowAction',
  });
  return WorkflowAction;
};