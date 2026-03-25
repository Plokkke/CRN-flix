#!/usr/bin/env node

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

const execAsync = promisify(exec);

// Wait for database to be ready
async function waitForDatabase() {
  const maxAttempts = 30;
  let attempts = 0;
  
  console.log('🔍 Waiting for database to be ready...');
  
  while (attempts < maxAttempts) {
    try {
      await execAsync(`pg_isready -h ${process.env.DATABASE_HOST} -p ${process.env.DATABASE_PORT} -U ${process.env.DATABASE_USER}`);
      console.log('✅ Database is ready!');
      return;
    } catch (error) {
      attempts++;
      console.log(`❌ Database not ready (attempt ${attempts}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  throw new Error('Database did not become ready in time');
}

// Run SQL migrations
async function runSQLMigrations() {
  console.log('🚀 Running SQL migrations...');
  
  const migrationsDir = path.join(__dirname, 'scripts');
  
  if (!fs.existsSync(migrationsDir)) {
    console.log('📁 No migrations directory found, skipping SQL migrations');
    return;
  }
  
  try {
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Natural sort: 00001_initial.sql, 00002_triggers.sql, etc.
    
    for (const file of files) {
      console.log(`🔧 Running migration: ${file}`);
      const migrationPath = path.join(migrationsDir, file);
      
      try {
        const { stdout } = await execAsync(`psql "${process.env.DATABASE_URL}" -f "${migrationPath}"`);
        console.log(stdout);
        console.log(`✅ Migration ${file} completed`);
      } catch (error) {
        console.error(`❌ Migration ${file} failed:`, error.message);
        throw error;
      }
    }
  } catch (error) {
    console.error('❌ SQL migrations failed:', error.message);
    throw error;
  }
}

// Run custom scripts in order
async function runCustomScripts() {
  const migrationsDir = path.join(__dirname, 'scripts');
  
  if (!fs.existsSync(migrationsDir)) {
    console.log('📁 No migrations directory found, skipping custom scripts');
    return;
  }
  
  console.log('📜 Running custom scripts...');
  
  try {
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.js'))
      .sort(); // This will sort naturally: 00001_script.js, 00002_script.js, etc.
    
    for (const file of files) {
      console.log(`🔧 Running script: ${file}`);
      const scriptPath = path.join(migrationsDir, file);
      
      try {
        // Import and execute the script
        const script = require(scriptPath);
        if (typeof script === 'function') {
          await script();
        } else if (script.default && typeof script.default === 'function') {
          await script.default();
        }
        console.log(`✅ Script ${file} completed`);
      } catch (error) {
        console.error(`❌ Script ${file} failed:`, error.message);
        throw error;
      }
    }
  } catch (error) {
    console.error('❌ Custom scripts failed:', error.message);
    throw error;
  }
}

// Main migration function
async function migrate() {
  try {
    console.log('🎯 Starting migration process...');

    await waitForDatabase();
    await runSQLMigrations();
    await runCustomScripts();

    console.log('🎉 Migration process completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('💥 Migration process failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('📛 Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📛 Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// Run migration
migrate();