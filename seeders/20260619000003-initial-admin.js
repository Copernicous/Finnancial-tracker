'use strict';
const bcrypt = require('bcryptjs');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const roles = await queryInterface.sequelize.query(
      `SELECT id from "Roles" WHERE name='Administrator';`
    );
    
    const adminRoleId = roles[0][0].id;
    const passwordHash = await bcrypt.hash('admin123', 10);

    await queryInterface.bulkInsert('Users', [{
      firstName: 'System',
      lastName: 'Administrator',
      username: 'admin',
      email: 'admin@home-accounting.local',
      passwordHash: passwordHash,
      roleId: adminRoleId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('Users', { username: 'admin' }, {});
  }
};
