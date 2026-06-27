'use strict';

async function addColumnIfMissing(queryInterface, table, column, spec) {
  const definition = await queryInterface.describeTable(table);
  if (!definition[column]) await queryInterface.addColumn(table, column, spec);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'Accounts', 'accountClass', { type: Sequelize.STRING, allowNull: false, defaultValue: 'banking' });
    await addColumnIfMissing(queryInterface, 'Accounts', 'accountSubtype', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Accounts', 'currentBalance', { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 });
    await addColumnIfMissing(queryInterface, 'Accounts', 'creditLimit', { type: Sequelize.DECIMAL(14, 2) });
    await addColumnIfMissing(queryInterface, 'Accounts', 'interestRate', { type: Sequelize.DECIMAL(8, 4) });
    await addColumnIfMissing(queryInterface, 'Accounts', 'includeInNetWorth', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });

    await addColumnIfMissing(queryInterface, 'Categories', 'groupName', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Categories', 'budgetBehavior', { type: Sequelize.STRING, allowNull: false, defaultValue: 'variable' });

    await addColumnIfMissing(queryInterface, 'Transactions', 'merchant', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Transactions', 'normalizedMerchant', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Transactions', 'originalAmount', { type: Sequelize.DECIMAL(14, 2) });
    await addColumnIfMissing(queryInterface, 'Transactions', 'originalCurrency', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Transactions', 'exchangeRate', { type: Sequelize.DECIMAL(14, 6) });
    await addColumnIfMissing(queryInterface, 'Transactions', 'tags', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Transactions', 'clearedDate', { type: Sequelize.DATEONLY });
    await addColumnIfMissing(queryInterface, 'Transactions', 'isRecurring', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });

    await queryInterface.createTable('Budgets', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING, allowNull: false },
      year: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 2026 },
      month: { type: Sequelize.INTEGER },
      categoryId: { type: Sequelize.INTEGER, references: { model: 'Categories', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      budgetType: { type: Sequelize.STRING, allowNull: false, defaultValue: 'monthly' },
      plannedAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'USD' },
      alertThresholdPct: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 90 },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: Sequelize.TEXT },
      isSimulation: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('RecurringTransactions', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING, allowNull: false },
      accountId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Accounts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      categoryId: { type: Sequelize.INTEGER, references: { model: 'Categories', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      transactionType: { type: Sequelize.STRING, allowNull: false },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'USD' },
      frequency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'monthly' },
      nextDate: { type: Sequelize.DATEONLY, allowNull: false },
      endDate: { type: Sequelize.DATEONLY },
      merchant: { type: Sequelize.STRING },
      notes: { type: Sequelize.TEXT },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      isSimulation: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('CurrencyRates', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      rateDate: { type: Sequelize.DATEONLY, allowNull: false },
      fromCurrency: { type: Sequelize.STRING, allowNull: false },
      toCurrency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'USD' },
      rate: { type: Sequelize.DECIMAL(14, 6), allowNull: false },
      source: { type: Sequelize.STRING, defaultValue: 'manual' },
      notes: { type: Sequelize.TEXT },
      isSimulation: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('FinancialGoals', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING, allowNull: false },
      goalType: { type: Sequelize.STRING, allowNull: false, defaultValue: 'savings' },
      accountId: { type: Sequelize.INTEGER, references: { model: 'Accounts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      targetAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currentAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'USD' },
      targetDate: { type: Sequelize.DATEONLY },
      priority: { type: Sequelize.INTEGER, defaultValue: 3 },
      status: { type: Sequelize.STRING, defaultValue: 'active' },
      notes: { type: Sequelize.TEXT },
      isSimulation: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('InvestmentHoldings', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      accountId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Accounts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      symbol: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING },
      assetClass: { type: Sequelize.STRING, defaultValue: 'fund' },
      quantity: { type: Sequelize.DECIMAL(18, 6), allowNull: false, defaultValue: 0 },
      costBasis: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      marketValue: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'USD' },
      priceDate: { type: Sequelize.DATEONLY },
      notes: { type: Sequelize.TEXT },
      isSimulation: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('ImportRows', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      importBatchId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'ImportBatches', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      rowNumber: { type: Sequelize.INTEGER, allowNull: false },
      rawData: { type: Sequelize.JSON, allowNull: false },
      normalizedData: { type: Sequelize.JSON },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'staged' },
      errorMessage: { type: Sequelize.TEXT },
      matchedAccountId: { type: Sequelize.INTEGER },
      matchedCategoryId: { type: Sequelize.INTEGER },
      postedTransactionId: { type: Sequelize.INTEGER },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.createTable('AccountBalanceSnapshots', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      accountId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Accounts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      snapshotDate: { type: Sequelize.DATEONLY, allowNull: false },
      balance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'USD' },
      source: { type: Sequelize.STRING, defaultValue: 'manual' },
      notes: { type: Sequelize.TEXT },
      isSimulation: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
  },

  async down(queryInterface) {
    for (const table of ['AccountBalanceSnapshots', 'ImportRows', 'InvestmentHoldings', 'FinancialGoals', 'CurrencyRates', 'RecurringTransactions', 'Budgets']) {
      await queryInterface.dropTable(table);
    }
    for (const [table, column] of [
      ['Transactions', 'isRecurring'], ['Transactions', 'clearedDate'], ['Transactions', 'tags'],
      ['Transactions', 'exchangeRate'], ['Transactions', 'originalCurrency'], ['Transactions', 'originalAmount'],
      ['Transactions', 'normalizedMerchant'], ['Transactions', 'merchant'],
      ['Categories', 'budgetBehavior'], ['Categories', 'groupName'],
      ['Accounts', 'includeInNetWorth'], ['Accounts', 'interestRate'], ['Accounts', 'creditLimit'],
      ['Accounts', 'currentBalance'], ['Accounts', 'accountSubtype'], ['Accounts', 'accountClass']
    ]) {
      await queryInterface.removeColumn(table, column).catch(() => {});
    }
  }
};
