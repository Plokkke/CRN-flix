#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function checkVersionConsistency() {
  const rootDir = path.join(__dirname, '..');
  const manifestPath = path.join(rootDir, 'terraform', 'versions.json');
  
  if (!fs.existsSync(manifestPath)) {
    console.log('⚠️  No version manifest found. Run "npm run version:sync" first.');
    return false;
  }
  
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const rootPackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  
  let isConsistent = true;
  
  console.log('🔍 Checking version consistency...');
  console.log(`📦 Root version: v${rootPackage.version}`);
  console.log(`📄 Manifest global: v${manifest.global}`);
  
  if (rootPackage.version !== manifest.global) {
    console.error('❌ Root package.json version does not match manifest');
    isConsistent = false;
  }
  
  // Vérifier chaque composant
  for (const [component, manifestVersion] of Object.entries(manifest.components)) {
    const componentPackagePath = path.join(rootDir, 'components', component, 'package.json');
    
    if (fs.existsSync(componentPackagePath)) {
      const componentPackage = JSON.parse(fs.readFileSync(componentPackagePath, 'utf8'));
      console.log(`   └─ ${component}: package v${componentPackage.version} | manifest v${manifestVersion}`);
      
      if (componentPackage.version !== manifestVersion) {
        console.error(`❌ Component ${component} version mismatch`);
        isConsistent = false;
      }
    } else {
      console.warn(`⚠️  Component ${component} package.json not found`);
    }
  }
  
  if (isConsistent) {
    console.log('✅ All versions are consistent');
  } else {
    console.error('❌ Version inconsistencies detected. Run "npm run version:sync" to fix.');
  }
  
  return isConsistent;
}

function checkEnvironmentVersions() {
  console.log('\n🌍 Environment versions:');
  console.log(`   Node.js: ${process.version}`);
  console.log(`   Platform: ${process.platform} ${process.arch}`);
  
  // Vérifier les versions requises
  const rootPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const engines = rootPackage.engines || {};
  
  if (engines.node) {
    console.log(`   Required Node.js: ${engines.node}`);
  }
  
  if (engines.npm) {
    console.log(`   Required npm: ${engines.npm}`);
  }
}

function main() {
  const isConsistent = checkVersionConsistency();
  checkEnvironmentVersions();
  
  if (!isConsistent) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { checkVersionConsistency, checkEnvironmentVersions };