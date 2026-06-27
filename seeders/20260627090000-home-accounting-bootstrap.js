'use strict';
const bcrypt = require('bcryptjs');

const now = () => new Date();

module.exports = {
  async up(queryInterface) {
    const rbac = require('../middleware/rbac');
    const roles = ['Administrator', 'Supervisor', 'Operator', 'Read Only'];
    for (const name of roles) {
      await queryInterface.bulkInsert('Roles', [{
        name,
        description: `${name} role`,
        isSystem: true,
        permissions: JSON.stringify(rbac.BUILT_IN_DEFAULTS[name] ? rbac.BUILT_IN_DEFAULTS[name]() : {}),
        createdAt: now(),
        updatedAt: now()
      }], { ignoreDuplicates: true });
    }

    const [adminRoles] = await queryInterface.sequelize.query(`SELECT id FROM "Roles" WHERE name = 'Administrator' LIMIT 1;`);
    const adminRoleId = adminRoles[0] && adminRoles[0].id;
    if (adminRoleId) {
      const passwordHash = await bcrypt.hash('admin123', 10);
      await queryInterface.bulkInsert('Users', [{
        firstName: 'System',
        lastName: 'Administrator',
        username: 'admin',
        email: 'admin@home-accounting.local',
        passwordHash,
        roleId: adminRoleId,
        isActive: true,
        isMaster: false,
        createdAt: now(),
        updatedAt: now()
      }], { ignoreDuplicates: true });
    }

    await queryInterface.bulkInsert('FinancialInstitutions', [
      { name: 'Banco Popular', institutionType: 'bank', notes: 'Structure reference from legacy Excel tabs only.', isActive: true, createdAt: now(), updatedAt: now() },
      { name: 'ADV / Advantage', institutionType: 'credit_card', notes: 'Structure reference from legacy Excel tabs only.', isActive: true, createdAt: now(), updatedAt: now() },
      { name: 'Citi', institutionType: 'bank', notes: 'Structure reference from legacy Excel tabs only.', isActive: true, createdAt: now(), updatedAt: now() }
    ], { ignoreDuplicates: true });

    await queryInterface.bulkInsert('Categories', [
      { name: 'Income', categoryType: 'income', createdAt: now(), updatedAt: now() },
      { name: 'Housing', categoryType: 'expense', createdAt: now(), updatedAt: now() },
      { name: 'Groceries', categoryType: 'expense', createdAt: now(), updatedAt: now() },
      { name: 'Transportation', categoryType: 'expense', createdAt: now(), updatedAt: now() },
      { name: 'Transfers', categoryType: 'transfer', createdAt: now(), updatedAt: now() }
    ], { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('Categories', null, {});
    await queryInterface.bulkDelete('FinancialInstitutions', null, {});
    await queryInterface.bulkDelete('Users', { username: 'admin' }, {});
    await queryInterface.bulkDelete('Roles', null, {});
  }
};
