'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class RXWorkflowTracking extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      RXWorkflowTracking.belongsTo(models.RXRecord, { foreignKey: 'rxRecordId' });
      RXWorkflowTracking.belongsTo(models.WorkflowAction, { foreignKey: 'workflowActionId' });
      RXWorkflowTracking.belongsTo(models.User, { foreignKey: 'userId' });
    }
  }
  RXWorkflowTracking.init({
    rxRecordId: DataTypes.INTEGER,
    workflowActionId: DataTypes.INTEGER,
    completionDate: DataTypes.DATE,
    userId: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'RXWorkflowTracking',
  });
  return RXWorkflowTracking;
};