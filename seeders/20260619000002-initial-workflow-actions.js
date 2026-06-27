'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('WorkflowActions', [
      { name: 'RX Received', description: 'Initial receipt of RX', sequenceNumber: 1, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      { name: 'Pharmacy Contacted', description: 'Pharmacy has been contacted', sequenceNumber: 2, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      { name: 'Transportation Assigned', description: 'Transportation company assigned', sequenceNumber: 3, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      { name: 'Delivery Scheduled', description: 'Delivery is scheduled', sequenceNumber: 4, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      { name: 'RX Delivered', description: 'RX has been delivered to patient', sequenceNumber: 5, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      { name: 'Driver Receipt Obtained', description: 'Signed receipt from driver obtained', sequenceNumber: 6, isActive: true, createdAt: new Date(), updatedAt: new Date() }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('WorkflowActions', null, {});
  }
};
