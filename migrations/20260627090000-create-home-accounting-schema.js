'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Roles', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING, allowNull: false, unique: true },
      description: { type: Sequelize.STRING },
      isSystem: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      permissions: { type: Sequelize.TEXT },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('Users', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      firstName: { type: Sequelize.STRING },
      lastName: { type: Sequelize.STRING },
      username: { type: Sequelize.STRING, allowNull: false, unique: true },
      email: { type: Sequelize.STRING },
      passwordHash: { type: Sequelize.STRING, allowNull: false },
      roleId: { type: Sequelize.INTEGER, references: { model: 'Roles', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: Sequelize.TEXT },
      twoFactorSecret: { type: Sequelize.TEXT },
      twoFactorEnabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      backupCodes: { type: Sequelize.TEXT },
      failedLoginCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      lockedUntil: { type: Sequelize.DATE },
      tokenVersion: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      isMaster: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      permissions: { type: Sequelize.TEXT },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('AuditLogs', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      userId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      date: { type: Sequelize.DATEONLY },
      time: { type: Sequelize.TIME },
      module: { type: Sequelize.STRING },
      action: { type: Sequelize.STRING },
      recordId: { type: Sequelize.INTEGER },
      previousValue: { type: Sequelize.JSON },
      newValue: { type: Sequelize.JSON },
      ipAddress: { type: Sequelize.STRING },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('SystemSettings', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      key: { type: Sequelize.STRING, allowNull: false, unique: true },
      value: { type: Sequelize.TEXT },
      description: { type: Sequelize.STRING },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('ApiKeys', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING, allowNull: false },
      keyPrefix: { type: Sequelize.STRING, allowNull: false },
      keyHash: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT },
      createdByUserId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      lastUsedAt: { type: Sequelize.DATE },
      expiresAt: { type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('ErrorLogs', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      message: { type: Sequelize.TEXT },
      stack: { type: Sequelize.TEXT },
      url: { type: Sequelize.TEXT },
      userId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      ipAddress: { type: Sequelize.STRING },
      severity: { type: Sequelize.STRING, allowNull: false, defaultValue: 'error' },
      resolved: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      resolvedAt: { type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('UserActivityLogs', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      userId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      usernameSnapshot: { type: Sequelize.STRING },
      roleSnapshot: { type: Sequelize.STRING },
      pageUrl: { type: Sequelize.TEXT },
      pagePath: { type: Sequelize.STRING },
      pageTitle: { type: Sequelize.STRING },
      visitedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      ipAddress: { type: Sequelize.STRING },
      userAgent: { type: Sequelize.TEXT },
      referrer: { type: Sequelize.TEXT },
      statusCode: { type: Sequelize.INTEGER },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('DailySnapshots', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      snapshotDate: { type: Sequelize.DATEONLY, allowNull: false, unique: true },
      totalAccounts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      activeAccounts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      totalTransactions: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      transactionsToday: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      draftTransactions: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      reviewedTransactions: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      reconciledTransactions: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      proofDocuments: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      openReconciliations: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      netWorth: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      netIncomeMonth: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      totalUsers: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      activeUsers: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      auditEventsToday: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      errorLogsToday: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      unresolvedErrors: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      totalFinancialInstitutions: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      totalCategories: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('FinancialInstitutions', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING, allowNull: false, unique: true },
      institutionType: { type: Sequelize.STRING, allowNull: false, defaultValue: 'bank' },
      website: { type: Sequelize.STRING },
      contactInfo: { type: Sequelize.TEXT },
      notes: { type: Sequelize.TEXT },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('Accounts', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING, allowNull: false, unique: true },
      accountCode: { type: Sequelize.STRING, unique: true },
      accountType: { type: Sequelize.STRING, allowNull: false },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'USD' },
      financialInstitutionId: { type: Sequelize.INTEGER, references: { model: 'FinancialInstitutions', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      openingBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      openingBalanceDate: { type: Sequelize.DATEONLY },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      notes: { type: Sequelize.TEXT },
      isSimulation: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('AccountAliases', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      accountId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Accounts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      alias: { type: Sequelize.STRING, allowNull: false },
      source: { type: Sequelize.STRING, allowNull: false, defaultValue: 'legacy_structure_reference' },
      notes: { type: Sequelize.TEXT },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('Categories', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING, allowNull: false, unique: true },
      categoryType: { type: Sequelize.STRING, allowNull: false },
      parentId: { type: Sequelize.INTEGER, references: { model: 'Categories', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      taxRelevant: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('Transactions', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      transactionDate: { type: Sequelize.DATEONLY, allowNull: false },
      accountId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Accounts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
      categoryId: { type: Sequelize.INTEGER, references: { model: 'Categories', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      relatedAccountId: { type: Sequelize.INTEGER, references: { model: 'Accounts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      description: { type: Sequelize.STRING, allowNull: false },
      transactionType: { type: Sequelize.STRING, allowNull: false },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'USD' },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'draft' },
      sourceType: { type: Sequelize.STRING, allowNull: false, defaultValue: 'manual' },
      referenceNumber: { type: Sequelize.STRING },
      memo: { type: Sequelize.TEXT },
      reviewedByUserId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      reviewedAt: { type: Sequelize.DATE },
      isSimulation: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('ProofDocuments', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      ownerType: { type: Sequelize.STRING, allowNull: false },
      ownerId: { type: Sequelize.INTEGER },
      originalName: { type: Sequelize.STRING, allowNull: false },
      storedName: { type: Sequelize.STRING, allowNull: false },
      mimeType: { type: Sequelize.STRING },
      sizeBytes: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      provider: { type: Sequelize.STRING, allowNull: false, defaultValue: 'local' },
      driveFileId: { type: Sequelize.STRING },
      driveWebViewLink: { type: Sequelize.TEXT },
      localPath: { type: Sequelize.TEXT },
      uploadedByUserId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      isDeleted: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      deletedAt: { type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('ImportBatches', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      importType: { type: Sequelize.STRING, allowNull: false },
      fileName: { type: Sequelize.STRING },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'draft' },
      rowCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      acceptedCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      rejectedCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      notes: { type: Sequelize.TEXT },
      createdByUserId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      isSimulation: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('Reconciliations', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      accountId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Accounts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      periodStart: { type: Sequelize.DATEONLY, allowNull: false },
      periodEnd: { type: Sequelize.DATEONLY, allowNull: false },
      statementBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      bookBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      difference: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'open' },
      reviewedByUserId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      reviewedAt: { type: Sequelize.DATE },
      notes: { type: Sequelize.TEXT },
      isSimulation: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
  },

  async down(queryInterface) {
    for (const table of [
      'Reconciliations', 'ImportBatches', 'ProofDocuments', 'Transactions',
      'Categories', 'AccountAliases', 'Accounts', 'FinancialInstitutions',
      'DailySnapshots', 'UserActivityLogs', 'ErrorLogs', 'ApiKeys',
      'SystemSettings', 'AuditLogs', 'Users', 'Roles'
    ]) {
      await queryInterface.dropTable(table);
    }
  }
};
