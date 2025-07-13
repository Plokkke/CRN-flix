#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getComponents() {
  const componentsDir = path.join(__dirname, '..', 'components');
  
  if (!fs.existsSync(componentsDir)) {
    return [];
  }
  
  return fs.readdirSync(componentsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .filter(component => {
      const dockerfilePath = path.join(componentsDir, component, 'Dockerfile');
      return fs.existsSync(dockerfilePath);
    });
}

function buildComponent(component, options = {}) {
  const componentsDir = path.join(__dirname, '..', 'components');
  const componentPath = path.join(componentsDir, component);
  const dockerfilePath = path.join(componentPath, 'Dockerfile');
  
  if (!fs.existsSync(dockerfilePath)) {
    console.error(`❌ No Dockerfile found for component: ${component}`);
    return false;
  }
  
  // Lire la version du composant
  const packagePath = path.join(componentPath, 'package.json');
  let version = 'latest';
  
  if (fs.existsSync(packagePath)) {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    version = packageJson.version || 'latest';
  }
  
  const imageName = `crn-flix-${component}`;
  const tags = [
    `${imageName}:${version}`,
    `${imageName}:latest`
  ];
  
  if (options.sha) {
    tags.push(`${imageName}:${options.sha}`);
  }
  
  const tagArgs = tags.map(tag => `-t ${tag}`).join(' ');
  const platformArg = options.platform ? `--platform ${options.platform}` : '';
  const targetArg = options.target ? `--target ${options.target}` : '';
  
  const buildCommand = `docker build ${platformArg} ${targetArg} ${tagArgs} ${componentPath}`;
  
  console.log(`🔨 Building ${component}...`);
  console.log(`   Image: ${imageName}:${version}`);
  console.log(`   Context: ${componentPath}`);
  
  try {
    execSync(buildCommand, { 
      stdio: 'inherit',
      cwd: componentPath
    });
    
    console.log(`✅ Successfully built ${imageName}:${version}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to build ${component}:`, error.message);
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const options = {};
  
  // Parse arguments
  let buildAll = false;
  let componentsTouild = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--all') {
      buildAll = true;
    } else if (arg === '--platform') {
      options.platform = args[++i];
    } else if (arg === '--target') {
      options.target = args[++i];
    } else if (arg === '--sha') {
      options.sha = args[++i];
    } else if (!arg.startsWith('--')) {
      componentsTouild.push(arg);
    }
  }
  
  const availableComponents = getComponents();
  
  if (availableComponents.length === 0) {
    console.log('ℹ️  No components with Dockerfile found');
    return;
  }
  
  let targetComponents;
  
  if (buildAll) {
    targetComponents = availableComponents;
    console.log('🚀 Building all components...');
  } else if (componentsTouild.length > 0) {
    targetComponents = componentsTouild.filter(comp => {
      if (availableComponents.includes(comp)) {
        return true;
      } else {
        console.warn(`⚠️  Component ${comp} not found or has no Dockerfile`);
        return false;
      }
    });
  } else {
    console.log('📦 Available components:', availableComponents.join(', '));
    console.log('Usage: npm run docker:build [component1] [component2] [--all] [--platform linux/arm64] [--target production]');
    return;
  }
  
  if (targetComponents.length === 0) {
    console.log('ℹ️  No valid components to build');
    return;
  }
  
  console.log(`🎯 Building components: ${targetComponents.join(', ')}`);
  
  let successful = 0;
  let failed = 0;
  
  for (const component of targetComponents) {
    if (buildComponent(component, options)) {
      successful++;
    } else {
      failed++;
    }
  }
  
  console.log(`\n📊 Build summary:`);
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { getComponents, buildComponent };