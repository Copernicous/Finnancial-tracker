'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Category extends Model {
    static associate(models) {
      Category.belongsTo(models.Category, { foreignKey: 'parentId', as: 'Parent' });
      Category.hasMany(models.Transaction, { foreignKey: 'categoryId' });
    }
  }
  Category.init({
    name: { type: DataTypes.STRING, allowNull: false },
    categoryType: { type: DataTypes.STRING, allowNull: false },
    parentId: DataTypes.INTEGER,
    taxRelevant: { type: DataTypes.BOOLEAN, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
  }, { sequelize, modelName: 'Category' });
  return Category;
};
