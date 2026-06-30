'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "idx_transactions_date_status_currency"
        ON "Transactions" ("transactionDate", "status", "currency");
      CREATE INDEX IF NOT EXISTS "idx_transactions_account_date"
        ON "Transactions" ("accountId", "transactionDate");
      CREATE INDEX IF NOT EXISTS "idx_transactions_category_date"
        ON "Transactions" ("categoryId", "transactionDate");
      CREATE INDEX IF NOT EXISTS "idx_transactions_merchant_date"
        ON "Transactions" ("merchantId", "transactionDate");
      CREATE INDEX IF NOT EXISTS "idx_import_rows_posted_transaction"
        ON "ImportRows" ("postedTransactionId");
      CREATE INDEX IF NOT EXISTS "idx_balance_snapshots_account_date"
        ON "AccountBalanceSnapshots" ("accountId", "snapshotDate" DESC);
      CREATE INDEX IF NOT EXISTS "idx_import_batches_type_status"
        ON "ImportBatches" ("importType", "status");
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS "idx_import_batches_type_status";
      DROP INDEX IF EXISTS "idx_balance_snapshots_account_date";
      DROP INDEX IF EXISTS "idx_import_rows_posted_transaction";
      DROP INDEX IF EXISTS "idx_transactions_merchant_date";
      DROP INDEX IF EXISTS "idx_transactions_category_date";
      DROP INDEX IF EXISTS "idx_transactions_account_date";
      DROP INDEX IF EXISTS "idx_transactions_date_status_currency";
    `);
  }
};
